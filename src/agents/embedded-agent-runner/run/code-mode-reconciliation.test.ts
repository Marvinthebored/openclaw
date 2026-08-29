import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { fakeTool, pluginToolWithExecute } from "../../code-mode.test-support.js";
import { attachInternalToolExecutionPreparer } from "../../runtime/internal-hooks.js";
import {
  buildEmbeddedRunnerAssistant,
  makeEmbeddedRunnerAttempt,
} from "../../test-helpers/embedded-agent-runner-e2e-fixtures.js";
import { jsonResult } from "../../tools/common.js";
import {
  activateCodeModeReconciliation,
  applyCodeModeReconciliationPlan,
  commitCodeModeReconciliationCalls,
  type CodeModeReconciliationPlan,
  isCodeModeReconciliationTool,
  validateCodeModeReconciliationCalls,
} from "./code-mode-reconciliation.js";
import { createEmbeddedRunTerminalRetryState } from "./terminal-retry-state.js";

function eligibleAttempt() {
  return makeEmbeddedRunnerAttempt({
    codeModeReconciliationCandidate: true,
    itemLifecycle: { startedCount: 2, completedCount: 2, activeCount: 0 },
  });
}

function activates(overrides = {}, hostOwnsToolSurface = true) {
  return activateCodeModeReconciliation({
    attempt: { ...eligibleAttempt(), ...overrides } as ReturnType<typeof eligibleAttempt>,
    hostOwnsToolSurface,
    retryState: createEmbeddedRunTerminalRetryState(),
    activateInternalPrompt: () => undefined,
  });
}

describe("Code Mode reconciliation", () => {
  it("admits one quiescent candidate", () => {
    expect(activates()).toBe(true);
  });

  it("continues with Code Mode disabled after a successful read and report", () => {
    const retryState = createEmbeddedRunTerminalRetryState();
    expect(
      activateCodeModeReconciliation({
        attempt: eligibleAttempt(),
        hostOwnsToolSurface: true,
        retryState,
        activateInternalPrompt: () => undefined,
      }),
    ).toBe(true);
    retryState.codeModeReconciliationPlan?.entries.push({
      toolName: "write",
      argumentsKey: '{"path":"done.txt"}',
      consumed: false,
    });

    let prompt = "";
    expect(
      activateCodeModeReconciliation({
        attempt: makeEmbeddedRunnerAttempt({
          itemLifecycle: { startedCount: 1, completedCount: 1, activeCount: 0 },
          toolMetas: [{ toolName: "read", isError: false }],
          currentAttemptCompletedAssistant: buildEmbeddedRunnerAssistant({
            stopReason: "stop",
            content: [{ type: "text", text: "The first hunk applied." }],
          }),
        }),
        hostOwnsToolSurface: true,
        retryState,
        activateInternalPrompt: (value) => {
          prompt = value;
        },
      }),
    ).toBe(true);
    expect(retryState).toMatchObject({
      forceCodeModeReconciliationTools: false,
      disableCodeModeForReconciledContinuation: true,
    });
    expect(prompt).toContain("Execute the reconciled recovery plan");
  });

  it("continues after inspection finds no pending work", () => {
    const retryState = createEmbeddedRunTerminalRetryState();
    expect(
      activateCodeModeReconciliation({
        attempt: eligibleAttempt(),
        hostOwnsToolSurface: true,
        retryState,
        activateInternalPrompt: () => undefined,
      }),
    ).toBe(true);

    expect(
      activateCodeModeReconciliation({
        attempt: makeEmbeddedRunnerAttempt({
          itemLifecycle: { startedCount: 1, completedCount: 1, activeCount: 0 },
          toolMetas: [{ toolName: "read", isError: false }],
          currentAttemptCompletedAssistant: buildEmbeddedRunnerAssistant({
            stopReason: "stop",
            content: [{ type: "text", text: "No work remains." }],
          }),
        }),
        hostOwnsToolSurface: true,
        retryState,
        activateInternalPrompt: () => undefined,
      }),
    ).toBe(true);
    expect(retryState).toMatchObject({
      forceCodeModeReconciliationTools: false,
      disableCodeModeForReconciledContinuation: true,
      codeModeReconciliationPlan: { entries: [] },
    });
  });

  it("continues immediately after a terminal recovery proposal", () => {
    const retryState = createEmbeddedRunTerminalRetryState();
    retryState.forceCodeModeReconciliationTools = true;
    retryState.codeModeReconciliationPlan = {
      entries: [{ toolName: "write", argumentsKey: "{}", consumed: false }],
      readObserved: true,
    };

    expect(
      activateCodeModeReconciliation({
        attempt: makeEmbeddedRunnerAttempt({
          itemLifecycle: { startedCount: 2, completedCount: 2, activeCount: 0 },
          toolMetas: [
            { toolName: "read", isError: false },
            { toolName: "recovery_propose", terminate: true },
          ],
        }),
        hostOwnsToolSurface: true,
        retryState,
        activateInternalPrompt: () => undefined,
      }),
    ).toBe(true);
    expect(retryState).toMatchObject({
      forceCodeModeReconciliationTools: false,
      disableCodeModeForReconciledContinuation: true,
    });
  });

  it("advances after a corrected recovery proposal", () => {
    const retryState = createEmbeddedRunTerminalRetryState();
    retryState.forceCodeModeReconciliationTools = true;
    retryState.codeModeReconciliationPlan = {
      entries: [{ toolName: "write", argumentsKey: "{}", consumed: false }],
      readObserved: true,
    };

    expect(
      activateCodeModeReconciliation({
        attempt: makeEmbeddedRunnerAttempt({
          itemLifecycle: { startedCount: 3, completedCount: 3, activeCount: 0 },
          lastToolError: { toolName: "recovery_propose", error: "first proposal was invalid" },
          toolMetas: [
            { toolName: "read", isError: false },
            { toolName: "recovery_propose", isError: true },
            { toolName: "recovery_propose", isError: false, terminate: true },
          ],
        }),
        hostOwnsToolSurface: true,
        retryState,
        activateInternalPrompt: () => undefined,
      }),
    ).toBe(true);
    expect(retryState).toMatchObject({
      forceCodeModeReconciliationTools: false,
      disableCodeModeForReconciledContinuation: true,
    });
  });

  it("rejects proposals before read has been observed", async () => {
    const plan: CodeModeReconciliationPlan = { entries: [], readObserved: false };
    const propose = applyCodeModeReconciliationPlan({
      tools: [fakeTool("write", "Write a file")],
      plan,
      capture: true,
    })[0];

    await expect(
      propose?.execute("proposal", {
        calls: [{ tool: "write", arguments: { path: "done.txt" } }],
      }),
    ).rejects.toThrow("wait for its result");
  });

  it("records ordered calls without executing them", async () => {
    const plan: CodeModeReconciliationPlan = { entries: [], readObserved: true };
    const read = fakeTool("read", "Read a file");
    const executeWrite = vi.fn(async () => jsonResult({}));
    const write = pluginToolWithExecute("write", "Write a file", executeWrite);
    const message = pluginToolWithExecute("message", "Send a message", async () => jsonResult({}));
    const captureTools = applyCodeModeReconciliationPlan({
      tools: [read, write, message],
      plan,
      capture: true,
    });

    expect(captureTools.map((tool) => tool.name)).toEqual(["read", "recovery_propose"]);
    const propose = captureTools.find((tool) => tool.name === "recovery_propose");
    const result = await propose?.execute("proposal", {
      calls: [
        { tool: "write", arguments: { path: "done.txt", content: "done" } },
        { tool: "write", arguments: { path: "done.txt", content: "done" } },
      ],
    });
    expect(result).toMatchObject({ terminate: true });
    expect(executeWrite).not.toHaveBeenCalled();
    expect(plan.entries).toHaveLength(2);

    const executeTools = applyCodeModeReconciliationPlan({
      tools: [read, write, message],
      plan,
      capture: false,
    });
    expect(executeTools.map((tool) => [tool.name, tool.executionMode])).toEqual([
      ["write", "sequential"],
    ]);
  });

  it("rejects invalid planned arguments without persisting them", async () => {
    const plan: CodeModeReconciliationPlan = { entries: [], readObserved: true };
    const write = fakeTool("write", "Write a file");
    write.parameters = Type.Object({ path: Type.String(), content: Type.String() });
    const propose = applyCodeModeReconciliationPlan({
      tools: [write],
      plan,
      capture: true,
    })[0];

    await expect(
      propose?.execute("proposal", {
        calls: [{ tool: "write", arguments: { path: "done.txt" } }],
      }),
    ).rejects.toThrow('Validation failed for tool "write"');
    expect(plan.entries).toEqual([]);
  });

  it("keeps capture bounded while accepting authorized catalogued names", async () => {
    const plan: CodeModeReconciliationPlan = { entries: [], readObserved: true };
    const tools = Array.from({ length: 500 }, (_, index) =>
      fakeTool(`plugin_${index}`, `Plugin ${index}`),
    );
    const captureTools = applyCodeModeReconciliationPlan({
      tools,
      clientTools: [
        {
          name: "client_probe",
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
        },
      ],
      plan,
      capture: true,
    });

    expect(captureTools.map((tool) => tool.name)).toEqual(["recovery_propose"]);
    await captureTools[0]?.execute("client", {
      calls: [
        { tool: "plugin_499", arguments: { value: "first" } },
        { tool: "client_probe", arguments: { value: "ok" } },
      ],
    });
    expect(plan.entries.map((entry) => entry.toolName)).toEqual(["plugin_499", "client_probe"]);
  });

  it("requires direct turn-ending calls to be final", async () => {
    const plan: CodeModeReconciliationPlan = { entries: [], readObserved: true };
    const propose = applyCodeModeReconciliationPlan({
      tools: [fakeTool("sessions_yield", "Yield"), fakeTool("write", "Write")],
      plan,
      capture: true,
    })[0];

    await expect(
      propose?.execute("proposal", {
        calls: [
          { tool: "sessions_yield", arguments: {} },
          { tool: "write", arguments: {} },
        ],
      }),
    ).rejects.toThrow("turn-ending recovery call");
    expect(plan.entries).toEqual([]);
  });

  it("retries one incomplete continuation, then fails visibly", () => {
    const retryState = createEmbeddedRunTerminalRetryState();
    retryState.codeModeReconciliationAttempts = 1;
    retryState.disableCodeModeForReconciledContinuation = true;
    retryState.codeModeReconciliationPlan = {
      entries: [{ toolName: "write", argumentsKey: "{}", consumed: false }],
      readObserved: true,
    };
    let prompt = "";
    expect(
      activateCodeModeReconciliation({
        attempt: makeEmbeddedRunnerAttempt({}),
        hostOwnsToolSurface: true,
        retryState,
        activateInternalPrompt: (value) => {
          prompt = value;
        },
      }),
    ).toBe(true);
    expect(prompt).toContain("calls pending");
    expect(() =>
      activateCodeModeReconciliation({
        attempt: makeEmbeddedRunnerAttempt({}),
        hostOwnsToolSurface: true,
        retryState,
        activateInternalPrompt: () => undefined,
      }),
    ).toThrow("pending planned calls");
  });

  it("returns a client handoff instead of retrying pending recovery calls", () => {
    const retryState = createEmbeddedRunTerminalRetryState();
    retryState.codeModeReconciliationAttempts = 1;
    retryState.disableCodeModeForReconciledContinuation = true;
    retryState.codeModeReconciliationPlan = {
      entries: [{ toolName: "write", argumentsKey: "{}", consumed: false }],
      readObserved: true,
    };

    expect(
      activateCodeModeReconciliation({
        attempt: makeEmbeddedRunnerAttempt({ clientToolCalls: [{ name: "client", params: {} }] }),
        hostOwnsToolSurface: true,
        retryState,
        activateInternalPrompt: () => undefined,
      }),
    ).toBe(false);
    expect(retryState.codeModeReconciliationAttempts).toBe(1);
  });

  it("does not retry a planned call after preflight denial", () => {
    const retryState = createEmbeddedRunTerminalRetryState();
    retryState.codeModeReconciliationAttempts = 1;
    retryState.disableCodeModeForReconciledContinuation = true;
    retryState.codeModeReconciliationPlan = {
      entries: [{ toolName: "write", argumentsKey: "{}", consumed: false }],
      readObserved: true,
    };

    expect(
      activateCodeModeReconciliation({
        attempt: makeEmbeddedRunnerAttempt({
          itemLifecycle: { startedCount: 1, completedCount: 1, activeCount: 0 },
          toolMetas: [{ toolName: "write", isError: true }],
        }),
        hostOwnsToolSurface: true,
        retryState,
        activateInternalPrompt: () => undefined,
      }),
    ).toBe(false);
    expect(retryState.codeModeReconciliationAttempts).toBe(1);
  });

  it("does not prepare or approve source tools while capturing", async () => {
    const plan: CodeModeReconciliationPlan = { entries: [], readObserved: true };
    const executeWrite = vi.fn(async () => jsonResult({}));
    const write = pluginToolWithExecute("write", "Write a file", executeWrite);
    write.prepareArguments = (args) => ({
      ...(args as Record<string, unknown>),
      compatibility: true,
    });
    const prepare = vi.fn(
      async ({ toolCallId, args }) =>
        ({
          kind: "ready",
          args,
          execute: (onImplementationStart?: () => void) => {
            onImplementationStart?.();
            return write.execute(toolCallId, args);
          },
          dispose: () => {},
        }) as const,
    );
    attachInternalToolExecutionPreparer(write, prepare);
    const proposed = applyCodeModeReconciliationPlan({ tools: [write], plan, capture: true })[0];
    await proposed?.execute("proposal", {
      calls: [{ tool: "write", arguments: { path: "done.txt" } }],
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(executeWrite).not.toHaveBeenCalled();
    expect(plan.entries[0]?.argumentsKey).toBe('{"compatibility":true,"path":"done.txt"}');
  });

  it("admits and consumes only the exact ordered calls", () => {
    const plan: CodeModeReconciliationPlan = {
      entries: [
        { toolName: "write", argumentsKey: '{"path":"a"}', consumed: false },
        { toolName: "write", argumentsKey: '{"path":"a"}', consumed: false },
      ],
      readObserved: true,
    };
    expect(() =>
      validateCodeModeReconciliationCalls(plan, [
        { toolCall: { id: "wrong", name: "write" }, args: { path: "b" } },
      ]),
    ).toThrow("next pending operation");
    const admitted = validateCodeModeReconciliationCalls(plan, [
      { toolCall: { id: "first", name: "write" }, args: { path: "a" } },
      { toolCall: { id: "second", name: "write" }, args: { path: "a" } },
    ]);
    commitCodeModeReconciliationCalls(plan, admitted, [
      { toolCallId: "first", args: { path: "a" } },
    ]);
    expect(plan.entries.map((entry) => entry.consumed)).toEqual([true, false]);
    commitCodeModeReconciliationCalls(plan, admitted, [
      { toolCallId: "second", args: { path: "policy-normalized" } },
    ]);
    expect(plan.entries[1]).toMatchObject({
      argumentsKey: '{"path":"policy-normalized"}',
      consumed: true,
    });
    expect(() =>
      commitCodeModeReconciliationCalls(plan, admitted, [
        { toolCallId: "first", args: { path: "a" } },
      ]),
    ).toThrow("order changed");
    expect(plan.entries.every((entry) => entry.consumed)).toBe(true);
  });

  it.each([
    ["no read", []],
    ["failed read", [{ toolName: "read", isError: true }]],
    ["terminal read", [{ toolName: "read", terminate: true }]],
  ])("keeps recovery restricted after %s", (_label, toolMetas) => {
    const retryState = createEmbeddedRunTerminalRetryState();
    retryState.forceCodeModeReconciliationTools = true;
    expect(
      activateCodeModeReconciliation({
        attempt: makeEmbeddedRunnerAttempt({
          itemLifecycle: { startedCount: 1, completedCount: 1, activeCount: 0 },
          toolMetas,
          currentAttemptCompletedAssistant: buildEmbeddedRunnerAssistant({
            stopReason: "stop",
            content: [{ type: "text", text: "Inspection report" }],
          }),
        }),
        hostOwnsToolSurface: true,
        retryState,
        activateInternalPrompt: () => undefined,
      }),
    ).toBe(false);
    expect(retryState).toMatchObject({
      forceCodeModeReconciliationTools: true,
      disableCodeModeForReconciledContinuation: false,
    });
  });

  it.each([
    ["active tool", { itemLifecycle: { startedCount: 2, completedCount: 1, activeCount: 1 } }],
    ["async work", { toolMetas: [{ toolName: "exec", asyncStarted: true }] }],
    ["message delivery", { didSendViaMessagingTool: true }],
    ["child session", { acceptedSessionSpawns: [{ runId: "child" }] }],
    ["approval", { didSendDeterministicApprovalPrompt: true }],
    ["yield", { yieldDetected: true }],
    [
      "recovered tool timeout",
      { terminal: { kind: "timeout", phase: "tool_execution", source: "observation" } },
    ],
    ["failed terminal", { terminal: { kind: "failed", source: "prompt", error: "failed" } }],
    ["plugin-owned transport", {}, false],
  ])("rejects a candidate with %s", (_label, overrides, hostOwnsToolSurface = true) => {
    expect(activates(overrides, hostOwnsToolSurface)).toBe(false);
  });

  it("exposes only the audited core observation tool", () => {
    expect(
      [
        "read",
        "find",
        "glob",
        "grep",
        "ls",
        "search",
        "exec",
        "write",
        "apply_patch",
        "message",
        "sessions_spawn",
        "web_fetch",
      ].filter((name) => isCodeModeReconciliationTool({ name })),
    ).toEqual(["read"]);
  });
});
