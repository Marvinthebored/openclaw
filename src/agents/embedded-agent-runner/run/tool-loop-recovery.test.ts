import type { InternalToolBatchCall } from "@openclaw/agent-core";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { markCodeModeControlTool } from "../../code-mode-control-tools.js";
import type { AgentTool } from "../../runtime/index.js";

const mocks = vi.hoisted(() => ({
  attachedLifecycles: [] as Array<{
    commitReadyCalls: (calls: readonly { toolCallId: string; args: unknown }[]) => void;
    releaseSkippedCalls: (ids: readonly string[]) => void;
  }>,
  committedArgs: [] as unknown[],
  releasedIds: [] as string[][],
  admitToolCallBatch: vi.fn(async (_calls: InternalToolBatchCall[]) => ({
    commitReadyCalls(readyCalls: readonly { toolCallId: string; args: unknown }[]) {
      mocks.committedArgs.push(...readyCalls.map((call) => call.args));
    },
    releaseSkippedCalls(ids: readonly string[]) {
      mocks.releasedIds.push([...ids]);
    },
  })),
}));

vi.mock("../../tool-loop-admission.js", () => ({
  admitToolCallBatch: mocks.admitToolCallBatch,
}));
vi.mock("../../runtime/internal-hooks.js", () => ({
  attachInternalToolBatchLifecycle: (
    result: object,
    lifecycle: (typeof mocks.attachedLifecycles)[number],
  ) => {
    mocks.attachedLifecycles.push(lifecycle);
    return result;
  },
}));

import { createToolLoopBatchAdmission } from "./tool-loop-recovery.js";

function codeModeExecTool(): AgentTool {
  return markCodeModeControlTool({
    name: "exec",
    label: "exec",
    description: "code mode exec",
    parameters: Type.Object({}),
    execute: async () => ({ content: [], details: {} }),
  });
}

function batchCall(id: string, args: Record<string, unknown>): InternalToolBatchCall {
  return {
    toolCall: { type: "toolCall", id, name: "exec", arguments: args },
    args,
    tool: codeModeExecTool(),
  };
}

describe("tool-loop recovery batch admission", () => {
  it("requires proposals to be authored after an earlier read batch", async () => {
    mocks.attachedLifecycles.length = 0;
    const plan = { entries: [], readObserved: false };
    const admission = createToolLoopBatchAdmission(
      { runId: "capture", loopDetection: { enabled: false } },
      plan,
      true,
    );
    if (!admission) {
      throw new Error("Expected capture admission hook");
    }
    const assistantMessage = {
      role: "assistant" as const,
      content: [],
      api: "openai-responses",
      provider: "test",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse" as const,
      timestamp: 1,
    };
    const readCall = {
      toolCall: { type: "toolCall" as const, id: "read", name: "read", arguments: {} },
      args: {},
    };
    const proposalCall = {
      toolCall: {
        type: "toolCall" as const,
        id: "proposal",
        name: "recovery_propose",
        arguments: {},
      },
      args: {},
    };

    await expect(
      admission({
        assistantMessage,
        calls: [readCall, proposalCall],
        context: { systemPrompt: "", messages: [] },
      }),
    ).rejects.toThrow("wait for its result");
    await admission({
      assistantMessage,
      calls: [readCall],
      context: { systemPrompt: "", messages: [] },
    });
    mocks.attachedLifecycles[0]?.commitReadyCalls([{ toolCallId: "read", args: {} }]);
    expect(plan.readObserved).toBe(true);
    await expect(
      admission({
        assistantMessage,
        calls: [proposalCall],
        context: { systemPrompt: "", messages: [] },
      }),
    ).resolves.toEqual({});
  });

  it("enforces and consumes a recovery plan at source start", async () => {
    mocks.attachedLifecycles.length = 0;
    const plan = {
      entries: [
        { toolName: "write", argumentsKey: '{"path":"a"}', consumed: false },
        { toolName: "write", argumentsKey: '{"path":"b"}', consumed: false },
      ],
      readObserved: true,
    };
    const admission = createToolLoopBatchAdmission(
      { runId: "recovery", loopDetection: { enabled: false } },
      plan,
    );
    if (!admission) {
      throw new Error("Expected recovery admission hook");
    }
    const calls = [
      {
        toolCall: { type: "toolCall" as const, id: "first", name: "write", arguments: {} },
        args: { path: "a" },
      },
      {
        toolCall: { type: "toolCall" as const, id: "second", name: "write", arguments: {} },
        args: { path: "b" },
      },
    ];
    await admission({
      assistantMessage: {
        role: "assistant",
        content: [],
        api: "openai-responses",
        provider: "test",
        model: "test",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: 1,
      },
      calls,
      context: { systemPrompt: "", messages: [] },
    });
    const lifecycle = mocks.attachedLifecycles[0];
    lifecycle?.commitReadyCalls([{ toolCallId: "first", args: { path: "a" } }]);
    expect(plan.entries.map((entry) => entry.consumed)).toEqual([true, false]);
    lifecycle?.commitReadyCalls([
      { toolCallId: "second", args: { path: "b", policyNormalized: true } },
    ]);
    expect(plan.entries.every((entry) => entry.consumed)).toBe(true);
    expect(plan.entries[1]?.argumentsKey).toBe('{"path":"b","policyNormalized":true}');

    plan.entries.forEach((entry) => {
      entry.consumed = false;
    });
    await expect(
      admission({
        assistantMessage: {
          role: "assistant",
          content: [],
          api: "openai-responses",
          provider: "test",
          model: "test",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "toolUse",
          timestamp: 2,
        },
        calls: [calls[1]!],
        context: { systemPrompt: "", messages: [] },
      }),
    ).rejects.toThrow("next pending operation");
  });

  it("canonicalizes equivalent Code Mode exec aliases before loop detection", async () => {
    mocks.committedArgs.length = 0;
    mocks.releasedIds.length = 0;
    mocks.attachedLifecycles.length = 0;
    const admission = createToolLoopBatchAdmission({
      sessionId: "session-1",
      sessionKey: "agent:main:session-1",
      runId: "run-1",
      loopDetection: { enabled: true },
    });
    if (!admission) {
      throw new Error("Expected batch admission hook");
    }

    const first = await admission({
      assistantMessage: {
        role: "assistant",
        content: [],
        api: "openai-responses",
        provider: "test",
        model: "test",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: 1,
      },
      calls: [batchCall("code-alias", { code: "return 1;" })],
      context: { systemPrompt: "", messages: [] },
    });
    const firstLifecycle = mocks.attachedLifecycles[0];
    firstLifecycle?.commitReadyCalls([
      { toolCallId: "code-alias", args: { code: "return 1;", command: "return 1;" } },
    ]);
    firstLifecycle?.releaseSkippedCalls([]);
    const second = await admission({
      assistantMessage: {
        role: "assistant",
        content: [],
        api: "openai-responses",
        provider: "test",
        model: "test",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: 2,
      },
      calls: [batchCall("command-alias", { command: "return 1;" })],
      context: { systemPrompt: "", messages: [] },
    });
    const secondLifecycle = mocks.attachedLifecycles[1];
    secondLifecycle?.commitReadyCalls([
      { toolCallId: "command-alias", args: { command: "return 1;", code: "return 1;" } },
    ]);
    secondLifecycle?.releaseSkippedCalls([]);

    const admittedArgs = mocks.admitToolCallBatch.mock.calls.map(([calls]) => calls[0]?.args);
    expect(admittedArgs).toEqual([
      { code: "return 1;", command: "return 1;" },
      { command: "return 1;", code: "return 1;" },
    ]);
    expect(mocks.committedArgs).toEqual(admittedArgs);
    expect(mocks.releasedIds).toEqual([[], []]);
    expect(first).toEqual({});
    expect(second).toEqual({});
    expect(firstLifecycle?.commitReadyCalls).not.toBe(secondLifecycle?.commitReadyCalls);
    expect(mocks.attachedLifecycles).toHaveLength(2);
  });
});
