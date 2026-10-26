import path from "node:path";
import { afterAll, afterEach, expect, it, onTestFinished, vi } from "vitest";
import * as transcriptAccessor from "../../config/sessions/session-accessor.js";
import { loadTranscriptEvents } from "../../config/sessions/session-accessor.js";
import { applyAssistantDeliveryDirectives } from "../../config/sessions/transcript-assistant-delivery.js";
import { sanitizeChatHistoryMessages } from "../../gateway/chat-display-projection.sanitize.js";
import { mergeImportedChatHistoryMessages } from "../../gateway/cli-session-history.test-support.js";
import type { AssistantMessage } from "../../llm/types.js";
import { upsertSessionEntry } from "../../plugin-sdk/session-store-runtime.js";
import {
  initializeGlobalHookRunner,
  resetGlobalHookRunner,
} from "../../plugins/hook-runner-global.js";
import type { PluginHookBeforeMessageWriteEvent } from "../../plugins/hook-types.js";
import { createEmptyPluginRegistry } from "../../plugins/registry-empty.js";
import {
  onInternalSessionTranscriptUpdate,
  readSessionTranscriptRunId,
  type InternalSessionTranscriptUpdate,
} from "../../sessions/transcript-events.js";
import { useSessionStoreTempDirs } from "../../test-utils/session-state-cleanup.js";
import { parseCliOutput } from "../cli-output.js";
import { isIntermediateAssistantTranscriptMessage } from "../embedded-agent-runner/message-visibility.js";
import { persistCliAssistantTranscript } from "./cli-run-transcript.js";

const sessionDirs = useSessionStoreTempDirs(afterAll, "openclaw-cli-coordination-transcript-");
afterEach(() => resetGlobalHookRunner());

async function transcriptFixture(name: string) {
  const sessionId = `cli-${name}-session`;
  const sessionKey = `agent:main:cli-${name}`;
  const root = sessionDirs.make();
  const target = {
    agentId: "main",
    sessionId,
    sessionKey,
    storePath: path.join(root, "agents", "main", "agent", "openclaw-agent.sqlite"),
  };
  await upsertSessionEntry({ ...target, entry: { sessionId, updatedAt: Date.now() } });
  const runParams = {
    ...target,
    provider: "claude-cli",
    runId: `cli-${name}-run`,
    config: {},
    sessionFile: `sqlite://agents/main/${sessionId}`,
    workspaceDir: root,
    prompt: "hi",
    timeoutMs: 1_000,
    persistAssistantTranscript: true,
  };
  const updates: InternalSessionTranscriptUpdate[] = [];
  onTestFinished(onInternalSessionTranscriptUpdate((update) => updates.push(update)));
  return {
    target,
    runParams,
    updates,
    persist: (overrides: Partial<Parameters<typeof persistCliAssistantTranscript>[0]>) =>
      persistCliAssistantTranscript({
        runParams,
        text: "reply",
        modelId: "claude-sonnet-4-6",
        stopReason: "stop",
        ...overrides,
      }),
  };
}

async function transcriptMessages(target: Parameters<typeof loadTranscriptEvents>[0]) {
  return (await loadTranscriptEvents(target)).flatMap((event) =>
    typeof event === "object" && event !== null && "message" in event ? [event.message] : [],
  );
}

it.each([
  { sourceTool: "sessions_send", hidden: true },
  { sourceTool: "subagent_announce", hidden: false },
  { sourceTool: "subagent_announce", privateCompletion: true as const, hidden: true },
  { sourceTool: "subagent_settle", privateCompletion: true as const, hidden: true },
])(
  "preserves CLI $sourceTool output with its display policy after hooks (private=$privateCompletion)",
  async ({ sourceTool, hidden, privateCompletion }) => {
    const { target, runParams, persist, updates } = await transcriptFixture("coordination");
    const registry = createEmptyPluginRegistry();
    registry.typedHooks.push({
      pluginId: "rewrite-output",
      hookName: "before_message_write",
      source: "test",
      handler: ({ message }: PluginHookBeforeMessageWriteEvent) => ({
        message: { ...message, display: true },
      }),
    });
    initializeGlobalHookRunner(registry);
    const text = "The worker result passed validation";
    const result = await persist({
      runParams: {
        ...runParams,
        privateCompletion,
        inputProvenance: { kind: "inter_session", sourceTool, sourceRole: "subagent" },
      },
      text,
    });
    expect(result.owned).toBe(true);
    const messages = await transcriptMessages(target);
    expect(messages).toMatchObject([{ role: "assistant", content: [{ type: "text", text }] }]);
    expect(Reflect.get(messages[0]!, "display") === false).toBe(hidden);
    expect(updates).toHaveLength(1);
    expect(Reflect.get(updates[0]!.message!, "display") === false).toBe(hidden);
    expect(readSessionTranscriptRunId(updates[0]!.message)).toBe("cli-coordination-run");
  },
);

it.each([false, true])("persists CLI usage with separate turn total=%s", async (turnTotal) => {
  const { target, runParams, persist } = await transcriptFixture("usage");
  const cacheUsage = { input: 4418, output: 5, cacheWrite: 36955, cacheWrite1h: 36955 };
  await persist({
    runParams: { ...runParams, provider: turnTotal ? "claude-cli" : "codex-cli" },
    modelId: turnTotal ? "claude-opus-4-8" : "gpt-5.4",
    usage: turnTotal ? cacheUsage : { input: 10, output: 5, cacheRead: 100 },
    ...(turnTotal ? { turnUsage: { ...cacheUsage, output: 534 } } : {}),
  });
  const messages = await transcriptMessages(target);
  expect(messages).toHaveLength(1);
  expect((messages[0] as AssistantMessage).usage).toEqual(
    turnTotal
      ? expect.objectContaining({ output: 534, cacheWrite: 36955, cacheWrite1h: 36955 })
      : expect.objectContaining({ input: 10, output: 5, cacheRead: 100, cacheWrite: 0 }),
  );
});

it.each([
  { kind: "completed", yielded: undefined, stopReason: "stop" },
  { kind: "yielded", yielded: true, stopReason: "stop" },
  { kind: "interrupted after yielding", yielded: true, stopReason: "aborted" },
] as const)(
  "prepares the $kind CLI assistant before its first transcript publication",
  async ({ yielded, stopReason }) => {
    const { target, runParams, persist, updates } = await transcriptFixture("media");
    const sourceText = "Artifacts ready\nMEDIA:./artifact.json";
    const completed = !yielded;
    const order: string[] = [];
    if (completed) {
      const append = transcriptAccessor.appendTranscriptMessages;
      const spy = vi
        .spyOn(transcriptAccessor, "appendTranscriptMessages")
        .mockImplementation(async (scope, options) => {
          let observedCommit = false;
          return append(scope, {
            ...options,
            onMessageCommitted: (...args) => {
              if (!observedCommit) {
                order.push("commit");
                observedCommit = true;
              }
              options.onMessageCommitted?.(...args);
            },
          });
        });
      onTestFinished(() => spy.mockRestore());
    }
    onTestFinished(
      onInternalSessionTranscriptUpdate(() => {
        order.push("publish");
      }),
    );
    const prepareAssistantTranscriptMessage = vi.fn((message: AssistantMessage) => {
      order.push("prepare");
      expect(updates).toHaveLength(0);
      return applyAssistantDeliveryDirectives(message, { managedMediaUrls: ["./artifact.json"] });
    });
    const result = await persist({
      runParams: {
        ...runParams,
        prepareAssistantTranscriptMessage,
      },
      text: sourceText,
      ...(completed
        ? {
            nativeMessages: [
              { uuid: "progress", text: "Working", cliSessionId: "native" },
              { uuid: "final", text: sourceText, cliSessionId: "native" },
            ],
          }
        : {}),
      stopReason,
      yielded,
    });
    expect(result).toMatchObject({ owned: true, idempotencyKey: "cli-assistant:cli-media-run" });
    expect(prepareAssistantTranscriptMessage).toHaveBeenCalledTimes(completed ? 2 : 1);
    expect(order).toEqual(
      completed ? ["prepare", "prepare", "commit", "publish", "publish"] : ["prepare", "publish"],
    );
    expect(prepareAssistantTranscriptMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: [{ type: "text", text: sourceText }] }),
      sourceText,
    );
    expect(updates).toHaveLength(completed ? 2 : 1);
    expect(updates.at(-1)?.message).toMatchObject({
      content: [{ type: "text", text: sourceText }],
      idempotencyKey: result.idempotencyKey,
      openclawDelivery: { mediaUrls: ["./artifact.json"] },
    });
    const messages = await transcriptMessages(target);
    expect(messages).toHaveLength(completed ? 2 : 1);
    if (completed) {
      expect(updates.map((update) => update.messageId)).toEqual(
        expect.arrayContaining([expect.any(String), expect.any(String)]),
      );
      expect(new Set(updates.map((update) => update.messageSeq)).size).toBe(2);
      expect(messages[0]).toMatchObject({ content: [{ type: "text", text: "Working" }] });
      messages.shift();
    }
    expect(isIntermediateAssistantTranscriptMessage(messages[0])).toBe(
      yielded === true && stopReason === "stop",
    );
    expect(messages[0]).toMatchObject({ stopReason });
    if (yielded && stopReason === "stop") {
      expect(messages[0]).toMatchObject({
        openclawStreamFallback: {
          replacementText: sourceText,
          source: "segment",
          itemId: "cli-media-run",
        },
      });
    } else {
      expect(messages[0]).not.toHaveProperty("openclawStreamFallback");
    }
    expect(sanitizeChatHistoryMessages(messages)).toMatchObject([
      { content: [{ type: "text", text: "Artifacts ready" }] },
    ]);
  },
);

it("replays a native group without duplicates and rolls back blocked groups without publication", async () => {
  const { target, persist, runParams, updates } = await transcriptFixture("atomic");
  const nativeMessages = [
    { uuid: "one", text: "Progress", cliSessionId: "native" },
    { uuid: "last", text: "Final", cliSessionId: "native" },
  ];
  const prepare = vi.fn((message: AssistantMessage) => message);
  const first = await persist({
    nativeMessages,
    runParams: { ...runParams, prepareAssistantTranscriptMessage: prepare },
    usage: { input: 10, output: 5 },
    turnUsage: { input: 20, output: 30 },
  });
  const replay = await persist({
    nativeMessages,
    runParams: { ...runParams, prepareAssistantTranscriptMessage: prepare },
  });
  expect(replay.terminalAnchor).toEqual(first.terminalAnchor);
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(await transcriptMessages(target)).toHaveLength(2);
  expect(updates).toHaveLength(2);
  const messages = (await transcriptMessages(target)) as AssistantMessage[];
  expect(messages[0].usage.output).toBe(0);
  expect(messages[1].usage.output).toBe(30);
  const registry = createEmptyPluginRegistry();
  registry.typedHooks.push({
    pluginId: "block",
    hookName: "before_message_write",
    source: "test",
    handler: ({ message }: PluginHookBeforeMessageWriteEvent) => ({
      block: JSON.stringify(message).includes("Final"),
    }),
  });
  initializeGlobalHookRunner(registry);
  expect(
    await persist({ nativeMessages, runParams: { ...runParams, runId: "blocked" } }),
  ).toMatchObject({ owned: true });
  expect(await transcriptMessages(target)).toHaveLength(2);
  expect(updates).toHaveLength(2);
});

it("persists only text-bearing native messages and preserves imported tool calls", async () => {
  const { target, persist } = await transcriptFixture("tool-only");
  const toolContent = [
    { type: "tool_use", id: "read-1", name: "Read", input: { path: "README.md" } },
  ];
  const output = parseCliOutput({
    providerId: "claude-cli",
    backend: { command: "claude", output: "jsonl" },
    outputMode: "jsonl",
    raw: [
      { type: "system", subtype: "init", session_id: "native" },
      ...[
        { uuid: "one", content: [{ type: "text", text: "One" }] },
        { uuid: "tool", content: toolContent },
        { uuid: "two", content: [{ type: "text", text: "Two" }] },
        { uuid: "final", content: [{ type: "text", text: "Final" }] },
      ].map(({ uuid, content }) => ({
        type: "assistant",
        uuid,
        message: { role: "assistant", content },
      })),
      { type: "result", result: "Final" },
    ]
      .map((frame) => JSON.stringify(frame))
      .join("\n"),
  });
  const result = await persist({
    text: output.text,
    nativeMessages: output.assistantMessages?.map(({ uuid, text }) => ({
      uuid,
      text,
      cliSessionId: "native",
    })),
  });
  expect(result).toMatchObject({ owned: true, idempotencyKey: "cli-assistant:cli-tool-only-run" });
  expect(result.terminalAnchor).toBeDefined();
  const messages = await transcriptMessages(target);
  expect(messages).toMatchObject([
    { content: [{ type: "text", text: "One" }], __openclaw: { externalId: "one" } },
    { content: [{ type: "text", text: "Two" }], __openclaw: { externalId: "two" } },
    { content: [{ type: "text", text: "Final" }], __openclaw: { externalId: "final" } },
  ]);
  expect(messages).toHaveLength(3);
  const tool = {
    role: "assistant",
    content: [{ type: "toolcall", id: "read-1", name: "Read", arguments: { path: "README.md" } }],
    __openclaw: { importedFrom: "claude-cli", cliSessionId: "native", externalId: "tool" },
  };
  const merged = mergeImportedChatHistoryMessages({
    localMessages: messages,
    importedMessages: [tool],
  });
  expect(merged).toHaveLength(4);
  expect(merged).toContainEqual(tool);
});
