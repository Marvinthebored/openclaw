// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupMessages } from "./chat-thread-grouping.ts";
import { collapseCompletedTurnWork } from "./chat-turn-presentation.ts";
import {
  chunkContiguousWork,
  splitMixedWorkGroup,
  type WorkChunkPart,
} from "./chat-work-chunks.ts";

const fixture = JSON.parse(
  readFileSync(new URL("../../../../test/fixtures/chat-work-chunks.json", import.meta.url), "utf8"),
) as {
  cases: {
    name: string;
    live?: boolean;
    parts: Omit<WorkChunkPart<undefined>, "value">[];
    expected: { kind: string; ids: string[] }[];
  }[];
};
describe("shared contiguous-work fixtures", () => {
  it.each(fixture.cases)("$name", ({ parts, live, expected }) => {
    expect(
      chunkContiguousWork(
        parts.map((part) => ({ ...part, value: undefined })),
        live,
      ).map((chunk) => ({ kind: chunk.kind, ids: chunk.parts.map((part) => part.id) })),
    ).toEqual(expected);
  });
});

const sessionKey = "agent:main:dashboard:work-chunks";
const message = (id: string, role: string, content: unknown, extra = {}) => ({
  role,
  content,
  timestamp: 1000,
  runId: "run",
  __openclaw: { id, runId: "run" },
  ...extra,
});
function groups(messages: unknown[]) {
  return groupMessages(
    messages.map((entry, index) => ({ kind: "message", key: "source-" + index, message: entry })),
    {},
    undefined,
    true,
  );
}
const tool = (id: string) => ({
  type: "tool_use",
  id,
  name: "read",
  input: { path: "synthetic.txt" },
});
const text = (value: string) => ({ type: "text", text: value });

describe("completed work preserves source order", () => {
  it.each([false, true])("keeps every Anthropic narration in place (bubble=%s)", (bubbleMode) => {
    const messages = [
      message("prompt", "user", "Inspect synthetic inputs"),
      message("first", "assistant", [text("First visible narration"), tool("one")], {
        stopReason: "toolUse",
      }),
      message("one-result", "toolResult", "read one", { toolCallId: "one", toolName: "read" }),
      message("second", "assistant", [text("Second visible narration"), tool("two")], {
        stopReason: "toolUse",
      }),
      message("two-result", "toolResult", "read two", { toolCallId: "two", toolName: "read" }),
      message("final", "assistant", [text("Final visible answer")], { stopReason: "stop" }),
    ];
    const original = structuredClone(messages);
    const items = collapseCompletedTurnWork(groups(messages), {
      sessionKey,
      runWorking: false,
      bubbleMode,
    });
    expect(items.map((item) => item.kind)).toEqual([
      "group",
      "group",
      "work-group",
      "group",
      "work-group",
      "group",
    ]);
    const work = items.filter((item) => item.kind === "work-group");
    expect(work.map((item) => item.groups.flatMap((group) => group.messages).length)).toEqual([
      2, 2,
    ]);
    expect(work.every((item) => item.durationMs === null)).toBe(true);
    expect(messages).toEqual(original);
    const visible = items.filter((item) => item.kind === "group");
    expect(visible[1]?.messages[0]).toMatchObject({
      actionKey: "source-1",
      message: { __openclaw: { id: "first" } },
    });
  });

  it("retains the first visible part's DOM key when work is appended to its envelope", () => {
    const initial = groups([
      message("evolving", "assistant", [text("Already visible")], { stopReason: "toolUse" }),
    ])[0];
    const enriched = groups([
      message("evolving", "assistant", [text("Already visible"), tool("later")], {
        stopReason: "toolUse",
      }),
    ])[0];
    if (initial?.kind !== "group" || enriched?.kind !== "group") {
      throw new Error("Missing source group");
    }
    const first = splitMixedWorkGroup(enriched)[0]!;
    expect(first.key).toBe(initial.key);
    expect(first.messages[0]?.key).toBe(initial.messages[0]?.key);
  });

  it("splits text thinking tool text within one envelope with stable source action IDs", () => {
    const source = message(
      "mixed",
      "assistant",
      [text("Before"), { type: "thinking", thinking: "Reason" }, tool("call"), text("After")],
      { stopReason: "stop" },
    );
    const group = groups([source])[0];
    if (group?.kind !== "group") {
      throw new Error("Missing group");
    }
    const parts = splitMixedWorkGroup(group);
    expect(parts.map((part) => part.visibleContent)).toEqual(["text", "none", "text"]);
    expect(parts.flatMap((part) => part.messages).map((part) => part.actionKey)).toEqual([
      "source-0",
      "source-0",
      "source-0",
    ]);
    expect(parts.map((part) => part.key)).toEqual(
      splitMixedWorkGroup(group).map((part) => part.key),
    );
    expect(
      parts
        .flatMap((part) => part.messages)
        .map((part) => (part.message as typeof source)["__openclaw"].id),
    ).toEqual(["mixed", "mixed", "mixed"]);
  });

  it.each(["toolUse", "error", "aborted"])(
    "does not fold incomplete/failed %s output",
    (stopReason) => {
      const items = groups([
        message("mixed", "assistant", [text("Visible"), tool("call")], { stopReason }),
        message("result", "toolResult", "failed", {
          toolCallId: "call",
          toolName: "read",
          isError: true,
        }),
      ]);
      const output = collapseCompletedTurnWork(items, { sessionKey, runWorking: false });
      expect(output.some((item) => item.kind === "work-group")).toBe(false);
    },
  );

  it("keeps live chunks expanded and preserves their part IDs on completion", () => {
    const input = groups([
      message("mixed", "assistant", [text("Visible"), tool("call")], { stopReason: "toolUse" }),
      message("final", "assistant", "Done", { stopReason: "stop" }),
    ]);
    const live = collapseCompletedTurnWork(input, { sessionKey, runWorking: true });
    const done = collapseCompletedTurnWork(input, { sessionKey, runWorking: false });
    expect(live.some((item) => item.kind === "work-group")).toBe(false);
    const keys = (items: typeof done) =>
      items.flatMap((item) =>
        item.kind === "work-group" ? item.groups.map((group) => group.key) : [item.key],
      );
    expect(keys(live)).toEqual(keys(done));
  });
});

it("does not treat a final-phase toolUse slice as a completed answer", () => {
  const input = groups([
    message(
      "mixed",
      "assistant",
      [
        { type: "thinking", thinking: "Work before text" },
        {
          ...text("Still working"),
          textSignature: JSON.stringify({ v: 1, id: "text", phase: "final_answer" }),
        },
        tool("pending"),
      ],
      { stopReason: "toolUse" },
    ),
  ]);
  const output = collapseCompletedTurnWork(input, { sessionKey, runWorking: false });
  expect(output.some((item) => item.kind === "work-group")).toBe(false);
});

it.each(["final_answer", undefined])(
  "keeps typed thinking-only work with phase %s collapsible",
  (phase) => {
    const output = collapseCompletedTurnWork(
      groups([
        message("thinking", "assistant", [{ type: "thinking", thinking: "Reasoning" }], { phase }),
        message("final", "assistant", "Done", { stopReason: "stop" }),
      ]),
      { sessionKey, runWorking: false },
    );
    expect(output.map((item) => item.kind)).toEqual(["work-group", "group"]);
  },
);

it.each(["", "   ", "<think>filtered private text</think>"])(
  "does not split contiguous work at invisible text %j",
  (hidden) => {
    const output = collapseCompletedTurnWork(
      groups([
        message(
          "mixed",
          "assistant",
          [tool("first"), text(hidden), tool("second"), text("Visible answer")],
          { stopReason: "stop" },
        ),
      ]),
      { sessionKey, runWorking: false },
    );
    expect(output.map((item) => item.kind)).toEqual(["work-group", "group"]);
    const work = output[0];
    expect(
      work?.kind === "work-group" && work.groups.flatMap((group) => group.messages),
    ).toHaveLength(1);
  },
);
