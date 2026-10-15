import fs from "node:fs/promises";
import path from "node:path";
import type { AgentMessage } from "openclaw/plugin-sdk/agent-core";
import type { EmbeddedRunAttemptParamsV2 as EmbeddedRunAttemptParams } from "openclaw/plugin-sdk/agent-harness";
import type { HarnessContextEngine as ContextEngine } from "openclaw/plugin-sdk/agent-harness-runtime";
import { openFileBackedSessionManagerForTest } from "openclaw/plugin-sdk/agent-runtime-test-contracts";
import { describe, expect, it } from "vitest";
import {
  assistantMessage,
  setupRunAttemptTestHooks,
  tempDir,
  userMessage,
} from "./run-attempt-test-harness.js";
import {
  createContextEngine,
  createParams,
  createStartedThreadHarness,
  makeThreadBootstrapBinding,
  runCodexAppServerAttempt,
  writeCodexAppServerBinding,
} from "./run-attempt.context-engine.test-support.js";

type MockCallReader = { mock: { calls: unknown[][] } };

function requireFirstCallArg(mock: unknown, label: string): unknown {
  const call = (mock as MockCallReader).mock.calls[0];
  if (!call) {
    throw new Error(`expected ${label} to be called`);
  }
  return call[0];
}

setupRunAttemptTestHooks();

describe("runCodexAppServerAttempt context budget for native-owned models", () => {
  it("gives the context engine the operator cap when core resolved no budget for a native-owned model", async () => {
    const sessionFile = path.join(tempDir, "session-native-owned-budget.jsonl");
    const workspaceDir = path.join(tempDir, "workspace-native-owned-budget");
    const sessionManager = openFileBackedSessionManagerForTest(sessionFile, {
      sessionId: "session-1",
    });
    const summary = "The durable code is summary-only-engine-code-8516.";
    const retainedId = sessionManager.appendMessage(
      assistantMessage("ACK: existing context", Date.now()),
    );
    sessionManager.appendCompaction(summary, retainedId, 1_000);
    const contextEngine = createContextEngine();
    const harness = createStartedThreadHarness();
    const params = createParams(sessionFile, workspaceDir);
    params.prompt =
      "Recall the durable code using $current-skill and [@current](plugin://current@market).";
    const admittedMessage = {
      ...userMessage(params.prompt, Date.now()),
      idempotencyKey: "current-request:user",
      __openclaw: {
        senderId: "bea-id",
        senderName: "$deploy",
        senderUsername: "[@probe] (plugin://probe@market)",
      },
    } as AgentMessage;
    params.userTurnTranscriptRecorder = {
      message: admittedMessage,
      resolveMessage: async () => admittedMessage,
      markRuntimePersisted() {},
      getAdmissionReceipt: () => undefined,
    } as EmbeddedRunAttemptParams["userTurnTranscriptRecorder"];
    params.currentInboundContext = { text: "Current inbound reply context" };
    params.contextEngine = contextEngine;
    params.sandboxSessionKey = "agent:main:telegram:default:direct:12345";
    // Core resolves no budget for a native-owned model; only the operator's cap arrives.
    params.contextTokenBudget = undefined;
    params.authoredContextTokenCap = 500_000;

    const run = runCodexAppServerAttempt(params);
    await harness.waitForMethod("turn/start");

    const assembleParams = requireFirstCallArg(contextEngine["assemble"], "assemble") as Parameters<
      ContextEngine["assemble"]
    >[0];
    expect(assembleParams.tokenBudget).toBe(500_000);
    expect(assembleParams.runtimeSettings?.limits?.promptTokenBudget).toBe(500_000);

    await harness.completeTurn();
    await run;
  });

  it.each([
    ["the thread's model", "gpt-5.4-codex", false, undefined, 258_400],
    ["the thread's model, provider-qualified", "openai/gpt-5.4-codex", false, undefined, 258_400],
    ["a thread bound to a different model", "gpt-5.4-codex-mini", false, undefined, undefined],
    // The binding already names the running model, but that newer turn never reported.
    ["a newer turn that reported nothing", "gpt-5.4-codex", true, undefined, undefined],
    // The operator lowered the cap after the thread reported its window.
    ["the thread's model, capped below the window", "gpt-5.4-codex", false, 32_000, 32_000],
  ] as const)(
    "uses the thread's reported window as the budget only for %s",
    async (_case, bindingModel, newerUnreportedTurn, authoredCap, expectedBudget) => {
      const sessionFile = path.join(tempDir, "session.jsonl");
      const workspaceDir = path.join(tempDir, "workspace");
      const agentDir = path.join(tempDir, "agent");
      await writeCodexAppServerBinding(sessionFile, {
        ...makeThreadBootstrapBinding({
          threadId: "thread-reported-window",
          cwd: workspaceDir,
          policyFingerprint:
            '{"schemaVersion":1,"engineId":"lossless-claw","ownsCompaction":true,"projectionMaxChars":24000}',
          epoch: "epoch-1",
        }),
        model: bindingModel,
        modelProvider: "openai",
      });
      const rolloutDir = path.join(agentDir, "codex-home", "sessions");
      await fs.mkdir(rolloutDir, { recursive: true });
      await fs.writeFile(
        path.join(rolloutDir, "rollout-thread-reported-window.jsonl"),
        [
          { type: "turn_context", payload: { model: "gpt-5.4-codex" } },
          {
            type: "event_msg",
            payload: {
              type: "token_count",
              info: { last_token_usage: { total_tokens: 20_000 }, model_context_window: 258_400 },
            },
          },
          ...(newerUnreportedTurn
            ? [{ type: "turn_context", payload: { model: "gpt-5.4-codex" } }]
            : []),
        ]
          .map((line) => `${JSON.stringify(line)}\n`)
          .join(""),
      );
      const contextEngine = createContextEngine();
      const params = createParams(sessionFile, workspaceDir);
      params.agentDir = agentDir;
      params.contextEngine = contextEngine;
      // Core resolves no budget for a native-owned model, so only the thread's window and the operator cap apply.
      params.contextTokenBudget = undefined;
      params.authoredContextTokenCap = authoredCap;
      const harness = createStartedThreadHarness();

      const run = runCodexAppServerAttempt(params);
      await harness.waitForMethod("turn/start");

      const assembleParams = requireFirstCallArg(
        contextEngine["assemble"],
        "assemble",
      ) as Parameters<ContextEngine["assemble"]>[0];
      expect(assembleParams.tokenBudget).toBe(expectedBudget);

      await harness.completeTurn();
      await run;
    },
  );
});
