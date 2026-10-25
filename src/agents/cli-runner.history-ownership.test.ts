import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { loadTranscriptEvents } from "../config/sessions/session-accessor.js";
import { MemoryCliSessionHistoryIndex } from "../gateway/cli-session-history-index-memory.js";
import { upsertSessionEntry } from "../plugin-sdk/session-store-runtime.js";
import { useSessionStoreTempDirs } from "../test-utils/session-state-cleanup.js";
import { runPreparedCliAgent } from "./cli-runner.js";
import { buildPreparedCliRunContext } from "./cli-runner.test-helpers.js";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
// mock-isolation: supply parsed output without spawning a backend.
vi.mock("./cli-runner/execute.runtime.js", () => ({ executePreparedCliRun: execute }));
const dirs = useSessionStoreTempDirs(afterAll, "cli-history-owner-");

it.each([false, true])(
  "publishes Claude narration and final once (transformed=%s)",
  async (transformed) => {
    const root = dirs.make();
    const target = {
      agentId: "main",
      sessionId: "ownership",
      sessionKey: "agent:main:ownership",
      storePath: path.join(root, "agents/main/agent/openclaw-agent.sqlite"),
    };
    await upsertSessionEntry({
      ...target,
      entry: { sessionId: target.sessionId, updatedAt: Date.now() },
    });
    execute.mockResolvedValue({
      text: "Checking now\nChecking inputs\nDone",
      rawFinalText: "Done",
      sessionId: "native-session",
      resumeCheckpointId: "final-uuid",
    });
    const context = buildPreparedCliRunContext({
      sessionTarget: target,
      workspaceDir: root,
      runId: "owner-run",
    });
    Object.assign(context.params, {
      config: {},
      storePath: target.storePath,
      persistAssistantTranscript: true,
      provider: "claude-cli",
    });
    if (transformed) {
      context.backendResolved.textTransforms = { output: [{ from: "Done", to: "Finished" }] };
    }
    await runPreparedCliAgent(context);
    const local = (await loadTranscriptEvents(target)).flatMap((event) =>
      typeof event === "object" && event !== null && "message" in event ? [event.message] : [],
    );
    expect(local).toHaveLength(1);
    expect(local[0]).toMatchObject({
      content: [{ type: "text", text: transformed ? "Finished" : "Done" }],
      __openclaw: {
        importedFrom: "claude-cli",
        cliSessionId: "native-session",
        externalId: "final-uuid",
      },
    });
    const index = new MemoryCliSessionHistoryIndex();
    index.appendLocal(local.map((message, i) => ({ message, seq: i + 1 })));
    for (const [uuid, text] of [
      ["progress-uuid", "Checking now"],
      ["second-progress-uuid", "Checking inputs"],
      ["final-uuid", "Done"],
    ]) {
      index.appendImported({
        role: "assistant",
        content: [{ type: "text", text }],
        __openclaw: {
          importedFrom: "claude-cli",
          cliSessionId: "native-session",
          externalId: uuid,
        },
      });
    }
    index.finish();
    expect(index.count).toBe(3);
    index.close();
  },
);
