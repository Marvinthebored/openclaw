import { describe, expect, it } from "vitest";
import { resolveReplyDirectiveRouting } from "./get-reply-directives-routing.js";
import { buildTestCtx } from "./test-ctx.js";

describe("sender-owned directive projection", () => {
  it.each([
    {
      name: "preserves forwarded status text beside an ordinary caption",
      commandText: "Please summarize",
      rawText: "Please summarize",
      agentText: "Please summarize\n[Forwarded message]\n/status marker",
      expected: "Please summarize\n[Forwarded message]\n/status marker",
      inlineStatus: false,
    },
    {
      name: "removes sender status while preserving forwarded status",
      commandText: "Please /status summarize",
      rawText: "Please /status summarize",
      agentText: "Please /status summarize\n[Forwarded message]\n/status marker",
      expected: "Please summarize\n[Forwarded message]\n/status marker",
      inlineStatus: true,
    },
    {
      name: "preserves forwarded session directives beside a caption",
      commandText: "Please summarize",
      rawText: "Please summarize",
      agentText: "Please summarize\n[Forwarded message]\n/think high\n  code()",
      expected: "Please summarize\n[Forwarded message]\n/think high\n  code()",
      inlineStatus: false,
    },
    {
      name: "keeps an empty sender projection distinct from forwarded content",
      commandText: "",
      rawText: "",
      agentText: "[Forwarded message]\n/status marker",
      expected: "[Forwarded message]\n/status marker",
      inlineStatus: false,
    },
    {
      name: "strips repeated sender status without changing remaining whitespace",
      commandText: "Please /status summarize /status\n  code()",
      rawText: "Please /status summarize /status\n  code()",
      agentText: "Please /status summarize /status\n  code()",
      expected: "Please summarize\n  code()",
      inlineStatus: true,
    },
    {
      name: "keeps flat history opaque to command cleanup",
      commandText: "hello",
      rawText: "hello",
      agentText:
        "[Chat messages since your last reply - for context]\nOther: /think high\n[Current message - respond to this]\nOwner: hello /status",
      expected:
        "[Chat messages since your last reply - for context]\nOther: /think high\n[Current message - respond to this]\nOwner: hello /status",
      inlineStatus: false,
    },
    {
      name: "removes sender status after MS Teams thread context",
      commandText: "Please /status summarize",
      rawText: "Please /status summarize",
      agentText:
        "[Thread history]\nAlice: earlier context\n[/Thread history]\n\nPlease /status summarize",
      expected: "[Thread history]\nAlice: earlier context\n[/Thread history]\n\nPlease summarize",
      inlineStatus: true,
    },
    {
      name: "does not resurrect a consumed reset body",
      commandText: "new session",
      rawText: "new session",
      agentText: "",
      expected: "",
      inlineStatus: false,
      resetTriggered: true,
    },
    {
      name: "keeps normalized command tails",
      commandText: "/status",
      rawText: "/status:\n/think high\n  code()",
      agentText: "/status:\n/think high\n  code()",
      expected: "/think high\n  code()",
      inlineStatus: false,
    },
    {
      name: "keeps tails after leading blanks",
      commandText: "/status",
      rawText: "\n\n/status:\n/think high\n  code()",
      agentText: "\n\n/status:\n/think high\n  code()",
      expected: "/think high\n  code()",
      inlineStatus: false,
    },
  ])("$name", ({ commandText, rawText, agentText, expected, inlineStatus, resetTriggered }) => {
    const ctx = buildTestCtx({
      CommandBody: commandText,
      RawBody: rawText,
      BodyForAgent: agentText,
      CommandAuthorized: true,
    });
    const result = resolveReplyDirectiveRouting({
      commandText: ctx.commandText,
      agentText: ctx.agentText,
      modelAliases: [],
      canInterpretTextDirectives: true,
      isAuthorizedSender: true,
      isGroup: false,
      wasMentioned: false,
      ctx,
      cfg: { commands: { text: true } },
      agentId: "main",
      resetTriggered: resetTriggered === true,
    });
    expect(result.cleanedBody).toBe(expected);
    expect(result.hasInlineStatus).toBe(inlineStatus);
    expect(result.directives.hasThinkDirective).toBe(false);
  });
});
