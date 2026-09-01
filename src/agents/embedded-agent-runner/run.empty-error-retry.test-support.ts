// Full-entry coverage for retrying empty errored assistant turns.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context, Model } from "../../../packages/ai/src/types.js";
import type { OpenClawTestState } from "../../test-utils/openclaw-test-state.js";
import { makeAssistantMessageFixture } from "../test-helpers/assistant-message-fixtures.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  mockedClassifyAssistantFailoverReason,
  mockedClassifyFailoverReason,
  mockedGlobalHookRunner,
  mockedRunEmbeddedAttempt,
  createOverflowRunParams,
  resetSharedRunIntegrationHarnessMocks,
} from "./run.overflow-compaction.harness.js";
import { loadSharedRunIntegrationHarness } from "./run.shared-integration-harness.test-support.js";
import type { EmbeddedRunAttemptResult } from "./run/types.js";

let state: OpenClawTestState;
let runEmbeddedAgent: Awaited<ReturnType<typeof loadSharedRunIntegrationHarness>>;

type AssistantContent = NonNullable<EmbeddedRunAttemptResult["lastAssistant"]>["content"];

function emptyErrorAttempt(
  provider: string,
  model: string,
  outputTokens = 0,
  content: AssistantContent = [],
  errorMessage?: string,
): EmbeddedRunAttemptResult {
  // Models can report stopReason=error with no output after tool activity; that
  // is replay-safe only when the attempt metadata records no side effects.
  const assistant = {
    role: "assistant",
    stopReason: "error",
    provider,
    model,
    content,
    usage: { input: 100, output: outputTokens, totalTokens: 100 + outputTokens },
    ...(errorMessage ? { errorMessage } : {}),
  } as unknown as NonNullable<EmbeddedRunAttemptResult["lastAssistant"]>;
  return makeAttemptResult({
    assistantTexts: [],
    lastAssistant: assistant,
    currentAttemptAssistant: assistant,
  });
}

function successAttempt(provider: string, model: string): EmbeddedRunAttemptResult {
  const assistant = {
    role: "assistant",
    stopReason: "stop",
    provider,
    model,
    content: [{ type: "text", text: "Done." }],
    usage: { input: 100, output: 5, totalTokens: 105 },
  } as unknown as NonNullable<EmbeddedRunAttemptResult["lastAssistant"]>;
  return makeAttemptResult({
    assistantTexts: ["Done."],
    lastAssistant: assistant,
    currentAttemptAssistant: assistant,
  });
}

describe("runEmbeddedAgent silent-error retry", () => {
  beforeAll(async () => {
    runEmbeddedAgent = await loadSharedRunIntegrationHarness();
  });

  beforeEach(async () => {
    resetSharedRunIntegrationHarnessMocks();
    const { createOpenClawTestState } = await import("../../test-utils/openclaw-test-state.js");
    state = await createOpenClawTestState({ label: "run.empty-error-retry" });
    mockedGlobalHookRunner.hasHooks.mockImplementation(() => false);
    mockedClassifyFailoverReason.mockReturnValue(null);
  });

  afterEach(async () => {
    await state?.cleanup();
  });

  it("retries when a turn ends with stopReason=error and zero output tokens", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(emptyErrorAttempt("ollama", "glm-5.1:cloud"));
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(successAttempt("ollama", "glm-5.1:cloud"));

    const result = await runEmbeddedAgent({
      ...createOverflowRunParams(state),
      provider: "ollama",
      model: "glm-5.1:cloud",
      runId: "run-empty-error-retry-basic",
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
    expect(result.payloads).toBeUndefined();
  });

  it("retries server_error when the attempt is otherwise silent and side-effect-free", async () => {
    mockedClassifyAssistantFailoverReason.mockReturnValue("server_error");
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      emptyErrorAttempt("anthropic", "claude-opus-4-8", 0, [], "Internal server error"),
    );
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(successAttempt("anthropic", "claude-opus-4-8"));

    const result = await runEmbeddedAgent({
      ...createOverflowRunParams(state),
      provider: "anthropic",
      model: "claude-opus-4-8",
      runId: "run-empty-error-retry-server-error",
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
    expect(result.payloads).toBeUndefined();
  });

  it.each(["This request is not allowed.", "This request is refused; prompt is too long."])(
    "surfaces a loopback Anthropic transport refusal without retrying: %s",
    async (explanation) => {
      let providerRequests = 0;
      const server = http.createServer((request, response) => {
        providerRequests += 1;
        request.resume();
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(
          [
            { type: "message_start", message: { id: "msg_refusal", usage: {} } },
            {
              type: "message_delta",
              delta: {
                stop_reason: "refusal",
                stop_details: {
                  type: "refusal",
                  category: "reasoning_extraction",
                  explanation,
                },
              },
              usage: { input_tokens: 3, output_tokens: 0 },
            },
            { type: "message_stop" },
          ]
            .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            .join(""),
        );
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const { port } = server.address() as AddressInfo;
      const model = {
        id: "claude-opus-5",
        name: "Claude Opus 5 refusal proof",
        api: "anthropic-messages",
        provider: "anthropic",
        baseUrl: `http://127.0.0.1:${port}`,
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 4_096,
      } satisfies Model<"anthropic-messages">;
      const context = {
        messages: [{ role: "user", content: "hello", timestamp: 1 }],
      } satisfies Context;

      try {
        mockedRunEmbeddedAttempt.mockImplementation(async () => {
          const { streamAnthropic } =
            await import("../../../packages/ai/src/providers/anthropic.js");
          const stream = streamAnthropic(model, context, { apiKey: "redacted-fixture-token" });
          for await (const event of stream) {
            void event;
          }
          const assistant = await stream.result();
          return makeAttemptResult({
            assistantTexts: [],
            lastAssistant: assistant,
            currentAttemptAssistant: assistant,
          });
        });

        const result = await runEmbeddedAgent({
          ...createOverflowRunParams(state),
          provider: "anthropic",
          model: "claude-opus-5",
          runId: "run-anthropic-refusal",
        });

        expect(providerRequests).toBe(1);
        expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(1);
        expect(result.payloads?.[0]).toMatchObject({
          isError: true,
          text: "The provider refused this request (category: reasoning_extraction).",
        });
        expect(result.meta.error).toMatchObject({
          message: "The provider refused this request (category: reasoning_extraction).",
        });
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    },
  );

  it("also treats Bedrock Anthropic refusal diagnostics as terminal", async () => {
    const refusal = emptyErrorAttempt("amazon-bedrock", "claude-opus-5");
    const diagnostics = [
      {
        type: "provider_refusal",
        timestamp: 0,
        details: { provider: "amazon-bedrock", category: "cyber" },
      },
    ];
    refusal.lastAssistant!.diagnostics = diagnostics;
    refusal.currentAttemptAssistant!.diagnostics = diagnostics;
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(refusal);
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      successAttempt("amazon-bedrock", "claude-opus-5"),
    );

    const result = await runEmbeddedAgent({
      ...createOverflowRunParams(state),
      provider: "amazon-bedrock",
      model: "claude-opus-5",
      runId: "run-bedrock-refusal",
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(1);
    expect(result.payloads?.[0]).toMatchObject({
      isError: true,
      text: "The provider refused this request (category: cyber).",
    });
    expect(result.meta.error).toMatchObject({
      message: "The provider refused this request (category: cyber).",
    });
  });

  it("does not intercept concrete non-transient failover errors", async () => {
    mockedClassifyFailoverReason.mockReturnValue("model_not_found");
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      emptyErrorAttempt(
        "anthropic",
        "missing-model",
        1120,
        [
          {
            type: "thinking",
            thinking: "internal reasoning before provider error",
            thinkingSignature: JSON.stringify({ id: "rs_missing_model", type: "reasoning" }),
          },
        ],
        "model not found",
      ),
    );

    await runEmbeddedAgent({
      ...createOverflowRunParams(state),
      provider: "anthropic",
      model: "missing-model",
      runId: "run-empty-error-retry-non-transient",
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(1);
  });

  it("caps retries at MAX_EMPTY_ERROR_RETRIES and surfaces incomplete-turn error", async () => {
    // 1 initial + 3 retries = 4 attempts, all returning empty-error.
    for (let i = 0; i < 4; i += 1) {
      mockedRunEmbeddedAttempt.mockResolvedValueOnce(emptyErrorAttempt("ollama", "glm-5.1:cloud"));
    }

    const result = await runEmbeddedAgent({
      ...createOverflowRunParams(state),
      provider: "ollama",
      model: "glm-5.1:cloud",
      runId: "run-empty-error-retry-exhausted",
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(4);
    expect(result.payloads?.[0]?.isError).toBe(true);
  });

  it("does not mark incomplete turns fallback-safe after a terminal heartbeat response", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        ...emptyErrorAttempt("anthropic", "claude-opus-4-8", 1120, [
          {
            type: "thinking",
            thinking: "internal reasoning before provider error",
            thinkingSignature: JSON.stringify({ id: "rs_heartbeat_error", type: "reasoning" }),
          },
        ]),
        heartbeatToolResponse: {
          outcome: "progress",
          notify: false,
          summary: "Still working",
        },
      }),
    );

    const result = await runEmbeddedAgent({
      ...createOverflowRunParams(state),
      provider: "anthropic",
      model: "claude-opus-4-8",
      runId: "run-terminal-heartbeat-not-fallback-safe",
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(1);
    expect(result.meta.error).toMatchObject({
      kind: "incomplete_turn",
      fallbackSafe: false,
    });
  });
  describe("current-assistant provenance", () => {
    it.each([0, 1])(
      "ignores a historical refusal when a later empty attempt reports %s compactions",
      async (compactionCount) => {
        const refusal = makeAssistantMessageFixture({
          api: "anthropic-messages",
          provider: "anthropic",
          model: "claude-opus-5",
          stopReason: "error",
          content: [],
          errorMessage: "historical refusal",
          diagnostics: [{ type: "provider_refusal", timestamp: 1, details: { category: "cyber" } }],
        });
        mockedRunEmbeddedAttempt
          .mockResolvedValueOnce(
            makeAttemptResult({
              assistantTexts: [],
              lastAssistant: refusal,
              currentAttemptAssistant: undefined,
              currentAttemptCompletedAssistant: undefined,
              compactionCount,
            }),
          )
          .mockResolvedValueOnce(successAttempt("anthropic", "claude-opus-5"));

        const result = await runEmbeddedAgent({
          ...createOverflowRunParams(state),
          provider: "anthropic",
          model: "claude-opus-5",
          runId: `run-historical-refusal-empty-${compactionCount}`,
        });

        expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
        expect(result.meta.error).toBeUndefined();
        expect(result.payloads?.some((payload) => payload.text?.includes("refused"))).not.toBe(
          true,
        );
      },
    );

    it("preserves a completed current refusal after transcript projection removes its slice", async () => {
      const refusal = makeAssistantMessageFixture({
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-opus-5",
        stopReason: "error",
        content: [],
        errorMessage: "current refusal",
        diagnostics: [{ type: "provider_refusal", timestamp: 2, details: { category: "cyber" } }],
      });
      mockedRunEmbeddedAttempt
        .mockResolvedValueOnce(
          makeAttemptResult({
            assistantTexts: [],
            lastAssistant: undefined,
            currentAttemptAssistant: undefined,
            currentAttemptCompletedAssistant: refusal,
            compactionCount: 1,
          }),
        )
        .mockResolvedValueOnce(successAttempt("anthropic", "claude-opus-5"));

      const result = await runEmbeddedAgent({
        ...createOverflowRunParams(state),
        provider: "anthropic",
        model: "claude-opus-5",
        runId: "run-completed-refusal-without-transcript-slice",
      });

      expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(1);
      expect(result.payloads?.[0]).toMatchObject({
        isError: true,
        text: "The provider refused this request (category: cyber).",
      });
    });
  });
});
