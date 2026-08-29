import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildEmbeddedRunnerAssistant } from "../test-helpers/embedded-agent-runner-e2e-fixtures.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  mockedClassifyFailoverReason,
  mockedRunEmbeddedAttempt,
  overflowBaseRunParams,
  resetSharedRunIntegrationHarnessMocks,
  useOpenAIPlatformAuthFixture,
} from "./run.overflow-compaction.harness.js";
import { loadSharedRunIntegrationHarness } from "./run.shared-integration-harness.test-support.js";
import type { EmbeddedRunAttemptParams } from "./run/types.js";

let runEmbeddedAgent: Awaited<ReturnType<typeof loadSharedRunIntegrationHarness>>;

describe("runEmbeddedAgent Code Mode reconciliation", () => {
  beforeAll(async () => {
    runEmbeddedAgent = await loadSharedRunIntegrationHarness();
  });

  beforeEach(() => {
    resetSharedRunIntegrationHarnessMocks();
    mockedClassifyFailoverReason.mockReturnValue(null);
    useOpenAIPlatformAuthFixture();
  });

  it("continues work after one settled read-only reconciliation", async () => {
    const mutationAssistant = buildEmbeddedRunnerAssistant({
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          id: "code-mode-mutation",
          name: "code_mode",
          arguments: { action: "exec" },
        },
      ],
    });
    const reasoningOnlyAssistant = buildEmbeddedRunnerAssistant({
      stopReason: "stop",
      content: [{ type: "thinking", thinking: "I should continue." }],
    });
    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(
        makeAttemptResult({
          assistantTexts: [],
          lastAssistant: mutationAssistant,
          currentAttemptAssistant: mutationAssistant,
          currentAttemptCompletedAssistant: mutationAssistant,
          codeModeReconciliationCandidate: true,
          itemLifecycle: { startedCount: 1, completedCount: 1, activeCount: 0 },
        }),
      )
      .mockImplementationOnce(async (params) => {
        (params as EmbeddedRunAttemptParams).codeModeReconciliationPlan?.entries.push({
          toolName: "write",
          argumentsKey: '{"path":"done.txt"}',
          consumed: false,
        });
        return makeAttemptResult({
          assistantTexts: ["The first hunk applied."],
          toolMetas: [
            { toolName: "read", isError: false },
            { toolName: "write", isError: false },
          ],
          itemLifecycle: { startedCount: 1, completedCount: 1, activeCount: 0 },
          currentAttemptCompletedAssistant: buildEmbeddedRunnerAssistant({
            stopReason: "stop",
            content: [{ type: "text", text: "The first hunk applied." }],
          }),
        });
      })
      .mockImplementationOnce(async (params) => {
        const pending = (
          params as EmbeddedRunAttemptParams
        ).codeModeReconciliationPlan?.entries.find((entry) => !entry.consumed);
        if (pending) {
          pending.consumed = true;
        }
        return makeAttemptResult({
          assistantTexts: [],
          lastAssistant: reasoningOnlyAssistant,
          currentAttemptAssistant: reasoningOnlyAssistant,
          currentAttemptCompletedAssistant: reasoningOnlyAssistant,
        });
      })
      .mockResolvedValueOnce(makeAttemptResult({ assistantTexts: ["Task complete."] }));

    await runEmbeddedAgent({
      ...overflowBaseRunParams,
      config: {
        agents: {
          defaults: {
            models: { "openai/gpt-5.5": { agentRuntime: { id: "openclaw" } } },
          },
        },
      },
      provider: "openai",
      model: "gpt-5.5",
      runId: "run-code-mode-reconciliation",
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(4);
    expect(
      mockedRunEmbeddedAttempt.mock.calls[0]?.[0].forceCodeModeReconciliationTools,
    ).toBeFalsy();
    expect(mockedRunEmbeddedAttempt.mock.calls[1]?.[0]).toMatchObject({
      forceCodeModeReconciliationTools: true,
      prompt: expect.stringContaining("may have partially applied"),
    });
    expect(mockedRunEmbeddedAttempt.mock.calls[2]?.[0]).toMatchObject({
      codeModeOverride: false,
      forceCodeModeTools: false,
      prompt: expect.stringContaining("Execute the reconciled recovery plan"),
      codeModeReconciliationPlan: expect.objectContaining({
        entries: [expect.objectContaining({ toolName: "write" })],
      }),
    });
    expect(mockedRunEmbeddedAttempt.mock.calls[2]?.[0].prompt).toContain("rejects unplanned calls");
    expect(mockedRunEmbeddedAttempt.mock.calls[3]?.[0]).toMatchObject({
      codeModeOverride: false,
      forceCodeModeTools: false,
      prompt: expect.stringContaining("rejects unplanned calls"),
    });
    expect(
      mockedRunEmbeddedAttempt.mock.calls[2]?.[0].forceCodeModeReconciliationTools,
    ).toBeFalsy();
  });
});
