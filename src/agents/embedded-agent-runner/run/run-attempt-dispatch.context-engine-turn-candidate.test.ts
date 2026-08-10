// Dispatch-seam coverage only: this asserts which fields `dispatchEmbeddedRunAttempt`
// puts on the harness attempt params. The harness-selection module is mocked here, so
// nothing below exercises a real harness, the terminal-anchor gate, or settlement —
// `selection.test.ts` owns those contracts.
//
// The field matters because `runSelectedAgentHarnessAttempt` reads the callback from
// these params to publish a completed turn to the outer logical-turn owner. Dropping it
// leaves a plugin-harness turn with no write path at all.
import "../../test-helpers/fast-coding-tools.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEmbeddedRunnerAssistant,
  cleanupEmbeddedAgentRunnerTestWorkspace,
  createEmbeddedAgentRunnerOpenAiConfig,
  createEmbeddedAgentRunnerTestWorkspace,
  createResolvedEmbeddedRunnerModel,
  immediateEnqueue,
  makeEmbeddedRunnerAttempt,
  type EmbeddedAgentRunnerTestWorkspace,
} from "../../test-helpers/embedded-agent-runner-e2e-fixtures.js";
import {
  installEmbeddedRunnerBaseE2eMocks,
  installEmbeddedRunnerFastRunE2eMocks,
} from "../../test-helpers/embedded-agent-runner-e2e-mocks.js";

type CapturedAttemptParams = {
  onContextEngineTurnCandidate?: unknown;
  contextEngineLogicalTurnLease?: unknown;
  userTurnTranscriptRecorder?: unknown;
};

const capturedAttemptParams: CapturedAttemptParams[] = [];

let runEmbeddedAgent: typeof import("./../run.js").runEmbeddedAgent;
let workspace: EmbeddedAgentRunnerTestWorkspace | undefined;
let agentDir: string;
let workspaceDir: string;
let runCounter = 0;

beforeAll(async () => {
  vi.resetModules();
  installEmbeddedRunnerBaseE2eMocks();
  installEmbeddedRunnerFastRunE2eMocks({
    runEmbeddedAttempt: (params) => {
      capturedAttemptParams.push(params as CapturedAttemptParams);
      return Promise.resolve(
        makeEmbeddedRunnerAttempt({
          assistantTexts: ["ok"],
          lastAssistant: buildEmbeddedRunnerAssistant({
            content: [{ type: "text", text: "ok" }],
          }),
        }),
      );
    },
  });
  vi.doMock("./../model.js", async () => {
    const actual = await vi.importActual<typeof import("./../model.js")>("./../model.js");
    return {
      ...actual,
      resolveModelAsync: async (provider: string, modelId: string) =>
        createResolvedEmbeddedRunnerModel(provider, modelId),
    };
  });
  vi.doMock("../../models-config.js", async () => {
    const actual =
      await vi.importActual<typeof import("../../models-config.js")>("../../models-config.js");
    return { ...actual, ensureOpenClawModelsJson: vi.fn(async () => ({ wrote: false })) };
  });
  ({ runEmbeddedAgent } = await import("./../run.js"));
  workspace = await createEmbeddedAgentRunnerTestWorkspace("openclaw-f5-turn-candidate-");
  ({ agentDir, workspaceDir } = workspace);
}, 180_000);

afterAll(async () => {
  await cleanupEmbeddedAgentRunnerTestWorkspace(workspace);
  workspace = undefined;
});

beforeEach(() => {
  capturedAttemptParams.length = 0;
});

const runOneTurn = async (params: { onContextEngineTurnCandidate?: () => void }) => {
  runCounter += 1;
  return await runEmbeddedAgent({
    sessionId: `session:f5-turn-candidate-${runCounter}`,
    sessionKey: `agent:test:f5-turn-candidate-${runCounter}`,
    workspaceDir,
    agentDir,
    config: createEmbeddedAgentRunnerOpenAiConfig(["mock-1"]),
    prompt: "hello",
    provider: "openai",
    model: "mock-1",
    // Routing metadata only: the mocked selection module resolves this to a "codex"
    // harness id. No plugin harness runs in this file.
    agentHarnessRuntimeOverride: "codex",
    timeoutMs: 5_000,
    runId: `run:f5-turn-candidate-${runCounter}`,
    enqueue: immediateEnqueue,
    ...(params.onContextEngineTurnCandidate
      ? { onContextEngineTurnCandidate: params.onContextEngineTurnCandidate }
      : {}),
  });
};

describe("embedded run attempt dispatch — context-engine turn candidate", () => {
  it("forwards the host turn-candidate callback to the harness attempt params", async () => {
    const onContextEngineTurnCandidate = vi.fn();

    await runOneTurn({ onContextEngineTurnCandidate });

    expect(capturedAttemptParams).toHaveLength(1);
    expect(capturedAttemptParams[0]?.onContextEngineTurnCandidate).toBe(
      onContextEngineTurnCandidate,
    );
  });

  it("omits the callback when the caller owns no logical turn", async () => {
    await runOneTurn({});

    expect(capturedAttemptParams).toHaveLength(1);
    expect(capturedAttemptParams[0]).not.toHaveProperty("onContextEngineTurnCandidate");
  });

  it("does not forward the logical-turn lease", async () => {
    // The run loop already selected this lease and called begin() on it. Re-entering
    // selectContextEngineForTranscriptHost() on a started lease throws
    // "context-engine logical turn selection is already pinned" whenever the current
    // turn has no admission receipt yet, which is exactly the pre-dispatch state.
    // Callers that own the lease keep it; the attempt params must not carry it.
    const onContextEngineTurnCandidate = vi.fn();

    await runOneTurn({ onContextEngineTurnCandidate });

    expect(capturedAttemptParams[0]).not.toHaveProperty("contextEngineLogicalTurnLease");
  });
});
