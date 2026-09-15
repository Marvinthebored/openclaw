// @vitest-environment node
import { describe, expect, it } from "vitest";
import { maybeResetToolStreamRun } from "./stream-reconciliation.ts";
import { reconcilePersistedAssistantStream } from "./stream-segment-pruning.ts";

const commentary = "Now let me check how contextThreshold is used.";

function persistedAssistant(runId: string, id: string, text: string) {
  return {
    role: "assistant",
    content: [
      { type: "text", text },
      { type: "tool_use", id: `call-${id}`, name: "read", input: {} },
    ],
    timestamp: 2,
    __openclaw: { id, runId },
  };
}

function stateWith(options: {
  chatRunId: string | null;
  segments: Array<{ text: string; ts: number; runId?: string; afterBoundaryRunId?: string }>;
  messages?: unknown[];
}) {
  return {
    chatRunId: options.chatRunId,
    chatStream: null,
    chatStreamStartedAt: null,
    chatStreamSegments: options.segments,
    chatMessages: options.messages ?? [
      { role: "user", content: "Investigate", timestamp: 1, __openclaw: { id: "m1", runId: "run-a" } },
      persistedAssistant("run-a", "m2", commentary),
    ],
  } as unknown as Parameters<typeof reconcilePersistedAssistantStream>[0];
}

function persistedFlags(state: unknown) {
  const segments = (state as { chatStreamSegments?: Array<{ persisted?: true }> })
    .chatStreamSegments;
  return (segments ?? []).map((segment) => segment.persisted === true);
}

describe("reconcilePersistedAssistantStream run ownership", () => {
  it("retires the replaced segment while its run is still active", () => {
    const state = stateWith({
      chatRunId: "run-a",
      segments: [{ text: commentary, ts: 2, runId: "run-a" }],
    });
    reconcilePersistedAssistantStream(state);
    expect(persistedFlags(state)).toEqual([true]);
  });

  it("retires the replaced segment when the run was cleared before the row persisted", () => {
    const state = stateWith({
      chatRunId: null,
      segments: [{ text: commentary, ts: 2, runId: "run-a" }],
    });
    reconcilePersistedAssistantStream(state);
    expect(persistedFlags(state)).toEqual([true]);
  });

  it("leaves segments alone when a cleared run cannot be attributed unambiguously", () => {
    const state = stateWith({
      chatRunId: null,
      segments: [
        { text: commentary, ts: 2, runId: "run-a" },
        { text: "Different run output.", ts: 3, runId: "run-b" },
      ],
    });
    reconcilePersistedAssistantStream(state);
    expect(persistedFlags(state)).toEqual([false, false]);
  });

  it("leaves untagged segments alone when the run is cleared", () => {
    const state = stateWith({
      chatRunId: null,
      segments: [{ text: commentary, ts: 2 }],
    });
    reconcilePersistedAssistantStream(state);
    expect(persistedFlags(state)).toEqual([false]);
  });

  it("leaves a tagged segment alone when an untagged stray shares the cleared run", () => {
    const state = stateWith({
      chatRunId: null,
      segments: [
        { text: commentary, ts: 2, runId: "run-a" },
        { text: "Untagged live output.", ts: 3 },
      ],
    });
    reconcilePersistedAssistantStream(state);
    expect(persistedFlags(state)).toEqual([false, false]);
  });

  it("leaves a segment alone once a later turn boundary carried it forward", () => {
    const state = stateWith({
      chatRunId: null,
      segments: [{ text: commentary, ts: 2, runId: "run-a", afterBoundaryRunId: "run-next" }],
    });
    reconcilePersistedAssistantStream(state);
    expect(persistedFlags(state)).toEqual([false]);
  });

  it("keeps a segment whose text no durable row replaced", () => {
    const state = stateWith({
      chatRunId: null,
      segments: [{ text: "Text that never persisted.", ts: 2, runId: "run-a" }],
    });
    reconcilePersistedAssistantStream(state);
    expect(persistedFlags(state)).toEqual([false]);
  });

  it("borrows a run for the reconcile pass without reviving it as the active run", () => {
    const state = stateWith({
      chatRunId: null,
      segments: [{ text: commentary, ts: 2, runId: "run-a" }],
    });
    reconcilePersistedAssistantStream(state);
    // Standing in for a finished run must not make it current again; a later
    // live event would then be attributed to a run that already ended.
    expect((state as { chatRunId: string | null }).chatRunId).toBeNull();
  });

  it("retires the replaced segment exactly once across repeated reconcile passes", () => {
    const state = stateWith({
      chatRunId: null,
      segments: [{ text: commentary, ts: 2, runId: "run-a" }],
    });
    reconcilePersistedAssistantStream(state);
    const afterFirst = JSON.stringify(state.chatStreamSegments);
    reconcilePersistedAssistantStream(state);
    expect(JSON.stringify(state.chatStreamSegments)).toEqual(afterFirst);
  });
});

describe("reconcilePersistedAssistantStream live-path coverage", () => {
  // session-message-apply.ts only clears the tool-stream run when the assistant
  // row arrives with runActive === false. These two tests pin which branch the
  // fallback actually serves, so it cannot quietly widen into the other one.
  function liveHostState() {
    return {
      ...stateWith({ chatRunId: null, segments: [{ text: commentary, ts: 2, runId: "run-a" }] }),
      chatToolMessages: [],
      toolStreamById: new Map(),
      toolStreamOrder: [],
      activityEventSeqById: new Map(),
      knownAgentRunIds: new Set(["run-a"]),
      waitingApprovalStatuses: new Map(),
    } as unknown as Parameters<typeof reconcilePersistedAssistantStream>[0];
  }

  it("has nothing left to retire once the run-end reset already dropped the segments", () => {
    const state = liveHostState();
    maybeResetToolStreamRun(state, "run-a");
    expect(state.chatStreamSegments).toEqual([]);
    reconcilePersistedAssistantStream(state);
    expect(state.chatStreamSegments).toEqual([]);
  });

  it("retires the segment the run-end reset never ran for", () => {
    const state = liveHostState();
    reconcilePersistedAssistantStream(state);
    expect(persistedFlags(state)).toEqual([true]);
  });
});
