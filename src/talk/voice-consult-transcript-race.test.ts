import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { SessionManager } from "../agents/sessions/session-manager.js";
import {
  appendTranscriptMessage,
  loadTranscriptEventsSync,
} from "../config/sessions/session-accessor.js";
import { runWithSessionTranscriptReadFence } from "../config/sessions/session-transcript-read-fence.js";
import { closeOpenClawAgentDatabasesForTest } from "../state/openclaw-agent-db.js";
import { captureEnv, setTestEnvValue } from "../test-utils/env.js";
import { consultRealtimeVoiceAgent } from "./agent-consult-runtime.js";
import {
  appendClientVoiceTranscript,
  appendRelayVoiceTranscript,
  createOrResumeClientVoiceSession,
  ensureClientVoiceAgentSessionEntry,
} from "./client-voice-session.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const envSnapshot = captureEnv(["OPENCLAW_STATE_DIR"]);
const agentId = "main";
const CONSULT_REPLY = "Two meetings tomorrow.";
// Mirrors the marker src/talk/client-voice-session.ts stamps on spoken rows.
const REALTIME_VOICE_KIND = "realtime_voice";
const REALTIME_VOICE_CHANNEL = "talk";

function buildAssistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "messages" as const,
    provider: "anthropic" as const,
    model: "sonnet-4.6" as const,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: 5,
  };
}

function readMessageTexts(scope: {
  agentId: string;
  sessionId: string;
  sessionKey: string;
  storePath: string;
}): string[] {
  return loadTranscriptEventsSync(scope).flatMap((event) => {
    const message = (event as { message?: { content?: unknown } } | null)?.message;
    const content = message?.content;
    if (typeof content === "string") {
      return [content];
    }
    if (!Array.isArray(content)) {
      return [];
    }
    return content.flatMap((block) =>
      block && typeof block === "object" && "text" in block
        ? [String((block as { text: unknown }).text)]
        : [],
    );
  });
}

/**
 * Stand up one Talk session whose canonical agent session already holds the
 * consult's keyed user turn, and hand back the fence that turn was admitted on.
 */
async function prepareConsultTurn(label: string) {
  const dir = tempDirs.make(`openclaw-${label}-`);
  setTestEnvValue("OPENCLAW_STATE_DIR", dir);
  const storePath = path.join(dir, "sessions.sqlite");
  const sessionKey = `agent:${agentId}:${label}`;
  const sessionId = await ensureClientVoiceAgentSessionEntry({ agentId, sessionKey, storePath });
  const scope = { agentId, sessionId, sessionKey, storePath };
  const manager = SessionManager.open(scope, dir);
  manager.appendMessage({ role: "user", content: "earlier question", timestamp: 1 });
  const admission = manager.appendMessageWithTranscriptAnchor({
    role: "user",
    content: "what is on the calendar tomorrow?",
    timestamp: 2,
  });
  // Narrowing on a property access is discarded inside the closure below, so
  // bind the anchor to a local the checker can keep narrowed.
  const anchor = admission.anchor;
  if (!anchor) {
    throw new Error("missing current-turn anchor");
  }
  const appendConsultReply = () =>
    runWithSessionTranscriptReadFence({ ...anchor, logicalTurnId: label, role: "user" }, () =>
      SessionManager.openBounded(scope, {
        cwd: dir,
        maxBytes: 8192,
        maxEvents: 16,
      }).appendMessage(buildAssistantMessage(CONSULT_REPLY)),
    );
  return { appendConsultReply, manager, scope, sessionKey, storePath };
}

beforeEach(() => {
  envSnapshot.restore();
});

afterEach(() => {
  closeOpenClawAgentDatabasesForTest();
  envSnapshot.restore();
});

// openclaw#150204 family: the live call keeps transcribing while the consult runs.
it.each(["relay", "client"] as const)(
  "keeps the %s voice transcript from failing an in-flight agent consult",
  async (origin) => {
    const { appendConsultReply, scope, sessionKey, storePath } = await prepareConsultTurn(
      `voice-consult-${origin}`,
    );
    const voiceSessionId = createOrResumeClientVoiceSession({
      agentId,
      sessionKey,
      origin,
      provider: "realtime",
    });
    const appendVoiceTranscript =
      origin === "relay" ? appendRelayVoiceTranscript : appendClientVoiceTranscript;
    // The realtime model transcribes the caller and speaks its filler while the
    // consult run is still in flight; both land in the same canonical session.
    await appendVoiceTranscript({
      agentId,
      sessionKey,
      sessionTarget: { sessionKey, storePath },
      voiceSessionId,
      entryId: "utterance-1",
      role: "user",
      text: "what is on the calendar tomorrow?",
    });
    await appendVoiceTranscript({
      agentId,
      sessionKey,
      sessionTarget: { sessionKey, storePath },
      voiceSessionId,
      entryId: "filler-1",
      role: "assistant",
      text: "I'll check that request.",
    });

    expect(() => appendConsultReply()).not.toThrow();

    // The caller keeps every spoken row, and the consult answer lands after them.
    expect(readMessageTexts(scope)).toEqual([
      "earlier question",
      "what is on the calendar tomorrow?",
      "what is on the calendar tomorrow?",
      "I'll check that request.",
      CONSULT_REPLY,
    ]);
  },
);

// Transport-level proof: the answer is not constructed by the test. It is whatever
// consultRealtimeVoiceAgent hands back to the Talk bridge after a run persisted it
// through the changed SQLite append owner while the caller was still speaking.
it("returns the spoken answer from a consult whose caller kept talking", async () => {
  const { appendConsultReply, scope, sessionKey, storePath } =
    await prepareConsultTurn("voice-consult-transport");
  const voiceSessionId = createOrResumeClientVoiceSession({
    agentId,
    sessionKey,
    origin: "relay",
    provider: "realtime",
  });
  const agentDir = path.dirname(storePath);
  // The consult resumes the canonical session the spoken turn already lives in.
  const sessionStore: Record<string, Record<string, unknown>> = {
    [sessionKey]: { sessionId: scope.sessionId, sessionFile: storePath, updatedAt: 2 },
  };
  // Stands in for the model only. The run persists its answer exactly where the real
  // embedded runner does, after the live call appended newer spoken rows.
  const runEmbeddedAgent = async () => {
    for (const row of [
      { entryId: "utterance-1", role: "user" as const, text: "what is on the calendar tomorrow?" },
      { entryId: "filler-1", role: "assistant" as const, text: "I'll check that request." },
    ]) {
      await appendRelayVoiceTranscript({
        agentId,
        sessionKey,
        sessionTarget: { sessionKey, storePath },
        voiceSessionId,
        ...row,
      });
    }
    appendConsultReply();
    // Speak back what survived persistence, so a silently dropped append cannot
    // still satisfy the transport assertion below.
    const persisted = readMessageTexts(scope).at(-1);
    return { payloads: persisted ? [{ text: persisted }] : [], meta: {} };
  };

  const result = await consultRealtimeVoiceAgent({
    cfg: {} as never,
    agentRuntime: {
      resolveAgentDir: () => agentDir,
      resolveAgentWorkspaceDir: () => agentDir,
      ensureAgentWorkspace: async () => {},
      resolveAgentTimeoutMs: () => 30_000,
      session: {
        resolveStorePath: () => storePath,
        loadSessionStore: () => sessionStore,
        saveSessionStore: async () => {},
        updateSessionStore: async (
          _storePath: string,
          mutate: (store: typeof sessionStore) => unknown,
        ) => mutate(sessionStore),
        getSessionEntry: (params: { sessionKey: string }) => sessionStore[params.sessionKey],
        patchSessionEntry: async (params: {
          sessionKey: string;
          fallbackEntry?: Record<string, unknown>;
          update: (
            entry: Record<string, unknown>,
          ) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
        }) => {
          const existing = sessionStore[params.sessionKey] ?? params.fallbackEntry;
          if (!existing) {
            return null;
          }
          const patch = await params.update({ ...existing });
          const next = patch ? { ...existing, ...patch } : existing;
          sessionStore[params.sessionKey] = next;
          return next;
        },
        upsertSessionEntry: async (params: {
          sessionKey: string;
          entry: Record<string, unknown>;
        }) => {
          sessionStore[params.sessionKey] = { ...params.entry };
        },
        resolveSessionFilePath: () => storePath,
      },
      runEmbeddedAgent,
    } as never,
    logger: { warn: () => {} },
    agentId,
    sessionKey,
    storePath,
    messageProvider: "talk",
    lane: "talk",
    runIdPrefix: "talk-realtime-consult",
    args: { question: "what is on the calendar tomorrow?" },
    transcript: [],
    surface: "a live voice session",
    userLabel: "User",
  });

  // The bridge speaks the agent's answer, not the "need a moment" fallback.
  expect(result.text).toBe(CONSULT_REPLY);
  expect(readMessageTexts(scope)).toContain(CONSULT_REPLY);
});

it("still rejects a consult reply that a real newer user turn has superseded", async () => {
  const { appendConsultReply, manager, scope } = await prepareConsultTurn("voice-consult-control");
  manager.appendMessage({ role: "user", content: "different question", timestamp: 3 });

  expect(() => appendConsultReply()).toThrow("SQLite transcript changed while preparing rewrite");
  expect(readMessageTexts(scope)).not.toContain(CONSULT_REPLY);
});

// The exemption keys on the marker the voice writer stamps, not on the kind alone.
it.each([
  { label: "no-channel", provenance: { kind: REALTIME_VOICE_KIND } },
  {
    label: "foreign-channel",
    provenance: { kind: REALTIME_VOICE_KIND, sourceChannel: "discord" },
  },
  {
    label: "foreign-kind",
    provenance: { kind: "typed_chat", sourceChannel: REALTIME_VOICE_CHANNEL },
  },
])(
  "still rejects a consult reply superseded by a $label user row",
  async ({ label, provenance }) => {
    const { appendConsultReply, scope } = await prepareConsultTurn(`voice-consult-${label}`);
    await appendTranscriptMessage(scope, {
      eventId: `forged:${label}`,
      message: {
        role: "user",
        content: [{ type: "text", text: "different question" }],
        timestamp: 3,
        provenance,
      },
      now: 3,
    });

    expect(() => appendConsultReply()).toThrow("SQLite transcript changed while preparing rewrite");
    expect(readMessageTexts(scope)).not.toContain(CONSULT_REPLY);
  },
);
