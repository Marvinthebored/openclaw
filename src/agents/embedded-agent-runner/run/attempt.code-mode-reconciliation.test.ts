import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
} from "openclaw/plugin-sdk/llm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readNestedToolActivity } from "../../../sessions/nested-tool-activity.js";
import {
  fakeTool,
  pluginToolWithExecute,
  resetCodeModeTestState,
} from "../../code-mode.test-support.js";
import { Agent, type AgentTool } from "../../runtime/index.js";
import { setInternalBeforeToolBatch } from "../../runtime/internal-hooks.js";
import { SessionManager } from "../../sessions/session-manager.js";
import { jsonResult } from "../../tools/common.js";
import {
  cleanupTempPaths,
  createContextEngineAttemptRunner,
  createContextEngineBootstrapAndAssemble,
  createDefaultEmbeddedSession,
  getHoisted,
  preloadRunEmbeddedAttemptForTests,
  resetEmbeddedAttemptHarness,
} from "./attempt-spawn-workspace.test-support.js";
import { activateCodeModeReconciliation } from "./code-mode-reconciliation.js";
import { createEmbeddedRunTerminalRetryState } from "./terminal-retry-state.js";
import { createToolLoopBatchAdmission } from "./tool-loop-recovery.js";

const hoisted = getHoisted();
const tempPaths: string[] = [];
const model: Model = {
  id: "test-model",
  name: "Test Model",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 8_192,
};

function buildAssistant(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((entry) => entry.type === "toolCall") ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
}

function streamAssistant(content: AssistantMessage["content"]) {
  const message = buildAssistant(content);
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({
      type: "done",
      reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
      message,
    });
    stream.end();
  });
  return stream;
}

describe("runEmbeddedAttempt Code Mode reconciliation boundary", () => {
  beforeAll(async () => {
    await preloadRunEmbeddedAttemptForTests();
  });

  beforeEach(() => {
    resetEmbeddedAttemptHarness();
  });

  afterEach(async () => {
    resetCodeModeTestState();
    await cleanupTempPaths(tempPaths);
  });

  it("resumes with direct tools after settling a partial mutation", async () => {
    const sessionManager = SessionManager.inMemory();
    const appliedChanges: string[] = [];
    const read = fakeTool("read", "Inspect current file contents");
    const applyPatch = pluginToolWithExecute("apply_patch", "Apply a patch", async () => {
      appliedChanges.push("first hunk applied");
      throw new Error("second hunk is ambiguous");
    });
    const write = pluginToolWithExecute("write", "Write a file", async () => jsonResult({}));
    const message = pluginToolWithExecute("message", "Send a message", async () => jsonResult({}));
    const shell = pluginToolWithExecute("shell_command", "Run a shell", async () => jsonResult({}));
    hoisted.createOpenClawCodingToolsMock.mockReturnValue([
      read,
      applyPatch,
      write,
      message,
      shell,
    ]);

    const providerContexts: Context[] = [];
    const retryState = createEmbeddedRunTerminalRetryState();
    let attemptPhase: "mutation" | "reconciliation" | "continuation" = "mutation";
    const baseSubscribe = hoisted.subscribeEmbeddedAgentSessionMock.getMockImplementation();
    if (!baseSubscribe) {
      throw new Error("missing embedded subscription test implementation");
    }
    hoisted.subscribeEmbeddedAgentSessionMock.mockImplementation((params) => {
      const subscription = baseSubscribe(params);
      if (attemptPhase === "reconciliation") {
        subscription.toolMetas.push({ toolName: "read", isError: false });
        subscription.getCurrentAttemptAssistant = () =>
          buildAssistant([{ type: "text", text: "first hunk applied" }]);
      }
      return subscription;
    });
    const createSession = () => {
      const session = createDefaultEmbeddedSession();
      const options = hoisted.createAgentSessionMock.mock.calls.at(-1)?.[0] as {
        customTools: AgentTool[];
      };
      const allTools = options.customTools;
      const proposedWrite = allTools.find((tool) => tool.name === "recovery_propose");
      let assistantTurn = 0;
      const agent = new Agent({
        initialState: { model, tools: allTools },
        streamFn: (_activeModel, context) => {
          providerContexts.push(context);
          const turn = assistantTurn++;
          if (attemptPhase === "reconciliation") {
            if (turn === 0) {
              return streamAssistant([
                { type: "toolCall", id: "observe", name: "read", arguments: { value: "file" } },
              ]);
            }
            if (turn === 1) {
              return streamAssistant([
                {
                  type: "toolCall",
                  id: "propose",
                  name: proposedWrite?.name ?? "missing_recovery_proposal",
                  arguments: { calls: [{ tool: "write", arguments: {} }] },
                },
              ]);
            }
            throw new Error("reconciliation continued after terminal recovery proposal");
          }
          if (turn > 0) {
            return streamAssistant([{ type: "text", text: "first hunk applied" }]);
          }
          return streamAssistant(
            attemptPhase === "continuation"
              ? [{ type: "toolCall", id: "continue", name: "write", arguments: {} }]
              : [
                  {
                    type: "toolCall",
                    id: "mutate",
                    name: "exec",
                    arguments: { code: "return await apply_patch({});" },
                  },
                ],
          );
        },
      });
      if (retryState.codeModeReconciliationPlan) {
        setInternalBeforeToolBatch(
          agent,
          createToolLoopBatchAdmission(
            { runId: "run", loopDetection: { enabled: false } },
            retryState.codeModeReconciliationPlan,
            attemptPhase === "reconciliation",
          ),
        );
      }
      session.agent = agent as typeof session.agent;
      Object.defineProperty(session, "messages", {
        get: () => agent.state.messages,
        set: (messages) => {
          agent.state.messages = messages;
        },
      });
      session.setActiveToolsByName = (toolNames) => {
        agent.state.tools = allTools.filter((tool) => toolNames.includes(tool.name));
      };
      session.getActiveToolNames = () => agent.state.tools.map((tool) => tool.name);
      session.prompt = async (prompt, promptOptions) => {
        promptOptions?.preflightResult?.(true);
        await agent.prompt(prompt);
      };
      return session;
    };

    const firstAttempt = await createContextEngineAttemptRunner({
      contextEngine: createContextEngineBootstrapAndAssemble(),
      createSession,
      sessionKey: "agent:main:main",
      tempPaths,
      attemptOverrides: {
        config: { tools: { codeMode: true, toolSearch: { enabled: true } } },
        sessionManager,
        disableMessageTool: false,
        disableTools: false,
        model,
      },
    });

    expect(firstAttempt.codeModeReconciliationCandidate).toBe(true);
    expect(appliedChanges).toEqual(["first hunk applied"]);
    expect(applyPatch.execute).toHaveBeenCalledOnce();
    const activities = sessionManager.getEntries().flatMap((entry) => {
      const activity = entry.type === "message" && readNestedToolActivity(entry.message);
      return activity ? [activity.details] : [];
    });
    expect(activities).toMatchObject([
      {
        parentToolCallId: "mutate",
        toolName: "apply_patch",
        isError: true,
        result: {
          content: [{ type: "text", text: "second hunk is ambiguous" }],
          details: { status: "error", error: "second hunk is ambiguous" },
        },
      },
    ]);

    let recoveryPrompt: string | undefined;
    expect(
      activateCodeModeReconciliation({
        attempt: firstAttempt,
        hostOwnsToolSurface: true,
        retryState,
        activateInternalPrompt: (prompt) => {
          recoveryPrompt = prompt;
        },
      }),
    ).toBe(true);
    expect(recoveryPrompt).toContain("may have partially applied");

    attemptPhase = "reconciliation";
    const reconciliationAttempt = await createContextEngineAttemptRunner({
      contextEngine: createContextEngineBootstrapAndAssemble(),
      createSession,
      sessionKey: "agent:main:main",
      tempPaths,
      attemptOverrides: {
        config: { tools: { codeMode: true, toolSearch: { enabled: true } } },
        sessionManager,
        disableMessageTool: false,
        disableTools: false,
        forceCodeModeReconciliationTools: retryState.forceCodeModeReconciliationTools,
        codeModeReconciliationPlan: retryState.codeModeReconciliationPlan,
        toolsAllow: ["write"],
        model,
        prompt: recoveryPrompt,
      },
    });

    expect(providerContexts).toHaveLength(3);
    const recoveryTools = providerContexts[1]?.tools?.map((tool) => tool.name) ?? [];
    expect(recoveryTools).toContain("read");
    expect(recoveryTools).toContain("recovery_propose");
    expect(recoveryTools).not.toContain("exec");
    expect(read.execute).toHaveBeenCalledOnce();
    expect(applyPatch.execute).toHaveBeenCalledOnce();
    expect(write.execute).not.toHaveBeenCalled();
    expect(message.execute).not.toHaveBeenCalled();
    expect(shell.execute).not.toHaveBeenCalled();
    expect(appliedChanges).toEqual(["first hunk applied"]);
    expect(retryState.codeModeReconciliationPlan?.entries).toEqual([
      { toolName: "write", argumentsKey: "{}", consumed: false },
    ]);

    let continuationPrompt: string | undefined;
    expect(
      activateCodeModeReconciliation({
        attempt: reconciliationAttempt,
        hostOwnsToolSurface: true,
        retryState,
        activateInternalPrompt: (prompt) => {
          continuationPrompt = prompt;
        },
      }),
    ).toBe(true);
    expect(retryState).toMatchObject({
      forceCodeModeReconciliationTools: false,
      disableCodeModeForReconciledContinuation: true,
    });

    attemptPhase = "continuation";
    await createContextEngineAttemptRunner({
      contextEngine: createContextEngineBootstrapAndAssemble(),
      createSession,
      sessionKey: "agent:main:main",
      tempPaths,
      attemptOverrides: {
        config: { tools: { codeMode: true, toolSearch: { enabled: true } } },
        sessionManager,
        disableMessageTool: false,
        disableTools: false,
        codeModeOverride: false,
        codeModeReconciliationPlan: retryState.codeModeReconciliationPlan,
        model,
        prompt: continuationPrompt,
      },
    });

    expect(providerContexts).toHaveLength(5);
    const resumedTools = providerContexts[3]?.tools?.map((tool) => tool.name) ?? [];
    expect(resumedTools).toContain("write");
    expect(resumedTools).not.toContain("exec");
    expect(write.execute).toHaveBeenCalledOnce();
    expect(applyPatch.execute).toHaveBeenCalledOnce();
    expect(retryState.codeModeReconciliationPlan?.entries[0]?.consumed).toBe(true);
  });
});
