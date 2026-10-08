import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveExecNotificationDefaults } from "../agents/bash-tools.exec-request-preparation.js";
import { createHeartbeatToolResponsePayload } from "../auto-reply/heartbeat-tool-response.js";
import { finalizeInboundContext } from "../auto-reply/reply/inbound-context.js";
import { drainFormattedSystemEvents } from "../auto-reply/reply/session-system-events.js";
import { initSessionState } from "../auto-reply/reply/session.js";
import { getReplySystemEventContext } from "../auto-reply/reply/system-event-session-key.js";
import type { OpenClawConfig } from "../config/config.js";
import { loadTranscriptEvents } from "../config/sessions/session-accessor.js";
import { readTranscriptEventMessage } from "../config/sessions/session-accessor.sqlite-read.js";
import { setTestEnvValue } from "../test-utils/env.js";
import { resetHeartbeatEventsForTest } from "./heartbeat-events.js";
import type { HeartbeatDeps } from "./heartbeat-runner-execution.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import {
  readSessionStoreForTest,
  seedMainSessionStore,
  seedSessionStore,
  setupTelegramHeartbeatPluginRuntimeForTests,
  withTempHeartbeatSandbox,
} from "./heartbeat-runner.test-utils.js";
import * as sessionPublication from "./heartbeat-session-publication.js";
import {
  enqueueSystemEvent,
  peekSystemEventEntries,
  resetSystemEventsForTest,
} from "./system-events.js";

// A command started from an internal (WebChat) session belongs to that session. An
// explicit heartbeat target (a channel for heartbeat chatter, cadence disabled) must
// not capture the session-owned completion reply, and ordinary heartbeat output and
// mixed batches must keep using that target.
describe("exec completion from a WebChat session with an explicit heartbeat target", () => {
  beforeEach(() => setupTelegramHeartbeatPluginRuntimeForTests());
  afterEach(() => {
    vi.restoreAllMocks();
    resetSystemEventsForTest();
    resetHeartbeatEventsForTest();
  });

  it("publishes into the WebChat session and does not send to the heartbeat channel", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
      setTestEnvValue("OPENCLAW_STATE_DIR", tmpDir);
      const marker = "WEBCHAT_EXEC_COMPLETION_STAYS_HOME";
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "0m", target: "telegram", to: "-100999000111" },
          },
        },
        channels: { telegram: { allowFrom: ["*"] } },
        messages: { visibleReplies: "message_tool" },
        session: { store: storePath },
      };
      const sessionKey = await seedMainSessionStore(storePath, cfg, {
        lastChannel: "webchat",
        lastProvider: "",
        lastTo: "",
        sessionId: "webchat-exec-session",
        lifecycleRevision: "webchat-exec-generation",
        createdVia: "operator",
      });
      enqueueSystemEvent("Exec completed (bg-cmd, code 0) :: " + marker, { sessionKey });
      const sendTelegram = vi
        .fn()
        .mockResolvedValue({ messageId: "leaked", chatId: "-100999000111" });
      const reply = vi.fn().mockResolvedValue(
        createHeartbeatToolResponsePayload({
          outcome: "done",
          notify: true,
          summary: "private",
          notificationText: marker,
        }),
      );
      const result = await runHeartbeatOnce({
        cfg,
        agentId: "main",
        source: "exec-event",
        intent: "event",
        reason: "exec-event",
        deps: { getReplyFromConfig: reply, telegram: sendTelegram },
      });
      expect(result.status).toBe("ran");
      expect(reply).toHaveBeenCalledOnce();
      expect(
        sendTelegram,
        "session-owned completion leaked to the heartbeat channel",
      ).not.toHaveBeenCalled();
      const entry = readSessionStoreForTest(storePath)[sessionKey];
      const events = await loadTranscriptEvents({
        agentId: "main",
        sessionKey,
        sessionId: entry!.sessionId!,
        storePath,
      });
      const published = events
        .map(readTranscriptEventMessage)
        .filter((m) => m?.role === "assistant" && JSON.stringify(m.content).includes(marker));
      expect(published).toHaveLength(1);
    });
  });

  it.each([1, 2])("keeps a chain of %i completions in its dashboard session", async (count) => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
      setTestEnvValue("OPENCLAW_STATE_DIR", tmpDir);
      const marker = "CHAINED_WEBCHAT_COMPLETION_STAYS_HOME";
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "0m", target: "telegram", to: "-100999000111" },
          },
        },
        channels: { telegram: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      const sessionKey = "agent:main:dashboard:chained-exec";
      await seedSessionStore(storePath, sessionKey, {
        lastChannel: "webchat",
        sessionId: "chained-webchat-session",
        lifecycleRevision: "chained-webchat-generation",
        createdVia: "operator",
      });
      enqueueSystemEvent("Exec completed (first, code 0) :: first result", {
        sessionKey,
        deliveryContext: { channel: "webchat" },
        fromConversationTurn: true,
      });
      const sendTelegram = vi
        .fn()
        .mockResolvedValue({ messageId: "leaked", chatId: "-100999000111" });
      const reply = vi
        .fn<NonNullable<HeartbeatDeps["getReplyFromConfig"]>>()
        .mockImplementation(async (ctx, options) => {
          // Exercise the real initializer, which getReplyFromConfig normally calls.
          // A stubbed model alone misses the persisted delivery change between turns.
          await initSessionState({
            cfg,
            ctx: finalizeInboundContext(ctx),
            commandAuthorized: true,
          });
          if (reply.mock.calls.length === 1) {
            const defaults = resolveExecNotificationDefaults({
              trigger: "heartbeat",
              continuesConversation: options?.continuesConversation,
              messageProvider: ctx.OriginatingChannel,
              currentChannelId: ctx.OriginatingTo ?? ctx.To,
            });
            for (let index = 0; index < count; index++) {
              enqueueSystemEvent(`Exec completed (chained-${index}, code 0) :: next result`, {
                sessionKey,
                deliveryContext: defaults.notifyDeliveryContext,
                fromConversationTurn: defaults.notifyFromConversationTurn,
              });
            }
            return { text: "First completed; started the next command." };
          }
          return { text: marker };
        });
      const run = () =>
        runHeartbeatOnce({
          cfg,
          agentId: "main",
          sessionKey,
          source: "exec-event",
          intent: "event",
          reason: "exec-event",
          deps: { getReplyFromConfig: reply, telegram: sendTelegram },
        });
      await expect(run()).resolves.toMatchObject({ status: "ran" });
      expect(sendTelegram).not.toHaveBeenCalled();
      expect(peekSystemEventEntries(sessionKey)).toHaveLength(count);
      await expect(run()).resolves.toMatchObject({ status: "ran" });
      expect(
        sendTelegram,
        "chained completion leaked to the heartbeat channel",
      ).not.toHaveBeenCalled();
      expect(await publishedAssistantTexts(storePath, sessionKey, marker)).toHaveLength(1);
      expect(peekSystemEventEntries(sessionKey)).toEqual([]);
    });
  });

  it.each(["user", "heartbeat", "cron"] as const)(
    "keeps a Telegram DM command chain with its %s owner",
    async (trigger) => {
      await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
        setTestEnvValue("OPENCLAW_STATE_DIR", tmpDir);
        const dm = "12345";
        const heartbeatTo = "-100999000111";
        const cfg: OpenClawConfig = {
          agents: {
            defaults: {
              workspace: tmpDir,
              heartbeat: { every: "0m", target: "telegram", to: heartbeatTo },
            },
          },
          channels: { telegram: { allowFrom: ["*"] } },
          session: { store: storePath },
        };
        const sessionKey = "agent:main:telegram:direct:12345";
        await seedSessionStore(storePath, sessionKey, {
          lastChannel: "telegram",
          lastTo: dm,
          chatType: "direct",
          createdVia: "operator",
          sessionId: "dm-chain-session",
          lifecycleRevision: "dm-chain-generation",
        });
        const first = resolveExecNotificationDefaults({
          trigger,
          messageProvider: "telegram",
          currentChannelId: dm,
        });
        enqueueSystemEvent("Exec completed (first, code 0) :: first result", {
          sessionKey,
          deliveryContext: first.notifyDeliveryContext,
          fromConversationTurn: first.notifyFromConversationTurn,
        });
        const sendTelegram = vi.fn().mockResolvedValue({ messageId: "sent", chatId: dm });
        const reply = vi
          .fn<NonNullable<HeartbeatDeps["getReplyFromConfig"]>>()
          .mockImplementation(async (ctx, options) => {
            await initSessionState({
              cfg,
              ctx: finalizeInboundContext(ctx),
              commandAuthorized: true,
            });
            if (reply.mock.calls.length === 1) {
              const next = resolveExecNotificationDefaults({
                trigger: "heartbeat",
                continuesConversation: options?.continuesConversation,
                messageProvider: ctx.OriginatingChannel,
                currentChannelId: ctx.OriginatingTo ?? ctx.To,
              });
              enqueueSystemEvent("Exec completed (next, code 0) :: next result", {
                sessionKey,
                deliveryContext: next.notifyDeliveryContext,
                fromConversationTurn: next.notifyFromConversationTurn,
              });
            }
            return { text: `Command result ${reply.mock.calls.length}.` };
          });
        const run = () =>
          runHeartbeatOnce({
            cfg,
            agentId: "main",
            sessionKey,
            source: "exec-event",
            intent: "event",
            reason: "exec-event",
            deps: { getReplyFromConfig: reply, telegram: sendTelegram },
          });
        await expect(run()).resolves.toMatchObject({ status: "ran" });
        await expect(run()).resolves.toMatchObject({ status: "ran" });
        const target = trigger === "user" ? dm : heartbeatTo;
        expect(sendTelegram.mock.calls.map((call) => call.slice(0, 2))).toEqual([
          [target, "Command result 1."],
          [target, "Command result 2."],
        ]);
        expect(peekSystemEventEntries(sessionKey)).toEqual([]);
      });
    },
  );

  it("still sends a genuine heartbeat poll to the explicit heartbeat channel", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
      setTestEnvValue("OPENCLAW_STATE_DIR", tmpDir);
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "5m", target: "telegram", to: "-100999000111" },
          },
        },
        channels: { telegram: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      const sessionKey = await seedMainSessionStore(storePath, cfg, {
        lastChannel: "webchat",
        lastProvider: "",
        lastTo: "",
        createdVia: "operator",
      });
      const sendTelegram = vi.fn().mockResolvedValue({ messageId: "hb", chatId: "-100999000111" });
      const reply = vi.fn().mockResolvedValue({ text: "Heartbeat alert: disk 95%" });
      await runHeartbeatOnce({
        cfg,
        agentId: "main",
        source: "manual",
        intent: "immediate",
        reason: "wake",
        deps: { getReplyFromConfig: reply, telegram: sendTelegram },
      });
      expect(sendTelegram).toHaveBeenCalledTimes(1);
      expect(await publishedAssistantTexts(storePath, sessionKey, "Heartbeat alert")).toHaveLength(
        0,
      );
    });
  });

  it("keeps the explicit target for a batch that mixes an exec completion with another event", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
      setTestEnvValue("OPENCLAW_STATE_DIR", tmpDir);
      const marker = "MIXED_BATCH_USES_HEARTBEAT_TARGET";
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "0m", target: "telegram", to: "-100999000111" },
          },
        },
        channels: { telegram: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      const sessionKey = await seedMainSessionStore(storePath, cfg, {
        lastChannel: "webchat",
        lastProvider: "",
        lastTo: "",
        createdVia: "operator",
      });
      enqueueSystemEvent("Exec completed (bg-cmd, code 0) :: done", { sessionKey });
      enqueueSystemEvent("Reminder: rotate the backup disk", { sessionKey });
      const sendTelegram = vi
        .fn()
        .mockResolvedValue({ messageId: "mixed", chatId: "-100999000111" });
      const reply = vi.fn().mockResolvedValue({ text: marker });
      await runHeartbeatOnce({
        cfg,
        agentId: "main",
        source: "exec-event",
        intent: "event",
        reason: "exec-event",
        deps: { getReplyFromConfig: reply, telegram: sendTelegram },
      });
      expect(sendTelegram).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(sendTelegram.mock.calls[0])).toContain(marker);
    });
  });

  it("publishes a restart continuation into the WebChat session, not the heartbeat channel", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
      setTestEnvValue("OPENCLAW_STATE_DIR", tmpDir);
      const marker = "RESTART_CONTINUATION_STAYS_HOME";
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "0m", target: "telegram", to: "-100999000111" },
          },
        },
        channels: { telegram: { allowFrom: ["*"] } },
        messages: { visibleReplies: "message_tool" },
        session: { store: storePath },
      };
      const sessionKey = await seedMainSessionStore(storePath, cfg, {
        lastChannel: "webchat",
        lastProvider: "",
        lastTo: "",
        sessionId: "webchat-restart-session",
        lifecycleRevision: "webchat-restart-generation",
        createdVia: "operator",
      });
      enqueueSystemEvent("Gateway restarted. Continue the interrupted turn.", {
        sessionKey,
        contextKey: "task:restart-sentinel:queue-1",
      });
      const sendTelegram = vi
        .fn()
        .mockResolvedValue({ messageId: "leaked", chatId: "-100999000111" });
      const reply = vi.fn().mockResolvedValue(
        createHeartbeatToolResponsePayload({
          outcome: "done",
          notify: true,
          summary: "private",
          notificationText: marker,
        }),
      );
      const result = await runHeartbeatOnce({
        cfg,
        agentId: "main",
        sessionKey,
        source: "restart-sentinel",
        intent: "immediate",
        reason: "wake",
        deps: { getReplyFromConfig: reply, telegram: sendTelegram },
      });
      expect(result.status).toBe("ran");
      expect(reply).toHaveBeenCalledOnce();
      expect(
        sendTelegram,
        "restart continuation leaked to the heartbeat channel",
      ).not.toHaveBeenCalled();
      expect(await publishedAssistantTexts(storePath, sessionKey, marker)).toHaveLength(1);
    });
  });

  it.each(["rejected write", "thrown write", "failed model"] as const)(
    "retains a restart occurrence after %s and settles only the successful retry",
    async (failure) => {
      await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
        setTestEnvValue("OPENCLAW_STATE_DIR", tmpDir);
        const marker = "RESTART_RETRY_COMMITTED";
        const cfg: OpenClawConfig = {
          agents: {
            defaults: {
              workspace: tmpDir,
              heartbeat: { every: "0m", target: "telegram", to: "-100999000111" },
            },
          },
          channels: { telegram: { allowFrom: ["*"] } },
          session: { store: storePath },
        };
        const sessionKey = await seedMainSessionStore(storePath, cfg, {
          lastChannel: "webchat",
          lastProvider: "",
          lastTo: "",
          sessionId: "restart-retry-session",
          lifecycleRevision: "restart-retry-generation",
          createdVia: "operator",
        });
        const continuation = "Gateway restarted. Continue the interrupted turn.";
        enqueueSystemEvent(continuation, {
          sessionKey,
          contextKey: "task:restart-sentinel:retry-1",
        });
        const captured = peekSystemEventEntries(sessionKey);
        const sendTelegram = vi
          .fn()
          .mockResolvedValue({ messageId: "leaked", chatId: "-100999000111" });
        const publish = vi.spyOn(sessionPublication, "publishHeartbeatSessionReply");
        if (failure === "rejected write") {
          publish.mockResolvedValueOnce({ ok: false, reason: "injected write rejection" });
        } else if (failure === "thrown write") {
          publish.mockRejectedValueOnce(new Error("injected write failure"));
        }
        const reply = vi.fn().mockImplementation(async (_ctx, options) => {
          const context = getReplySystemEventContext(options);
          // Exercise real admission: previous tests injected a reply without formatting
          // generic events, which hid the pre-publication drain.
          const block = await drainFormattedSystemEvents({
            cfg,
            agentId: "main",
            sessionKey,
            isMainSession: false,
            isNewSession: false,
            events: context?.events ?? [],
            deferredEventIds: context?.deferredEventIds,
          });
          expect(block).toContain(continuation);
          if (failure === "failed model" && reply.mock.calls.length === 1) {
            throw new Error("injected model failure after admission");
          }
          return createHeartbeatToolResponsePayload({
            outcome: "done",
            notify: true,
            summary: "private",
            notificationText: marker,
          });
        });
        const run = () =>
          runHeartbeatOnce({
            cfg,
            agentId: "main",
            sessionKey,
            source: "restart-sentinel",
            intent: "immediate",
            reason: "wake",
            deps: { getReplyFromConfig: reply, telegram: sendTelegram },
          });
        await run();
        expect(publish).toHaveBeenCalledTimes(failure === "failed model" ? 0 : 1);
        expect(peekSystemEventEntries(sessionKey).map((event) => event.id)).toEqual(
          captured.map((event) => event.id),
        );
        expect(await publishedAssistantTexts(storePath, sessionKey, marker)).toHaveLength(0);
        expect(sendTelegram).not.toHaveBeenCalled();
        await run();
        expect(reply).toHaveBeenCalledTimes(2);
        expect(publish).toHaveBeenCalledTimes(failure === "failed model" ? 1 : 2);
        expect(await publishedAssistantTexts(storePath, sessionKey, marker)).toHaveLength(1);
        expect(peekSystemEventEntries(sessionKey)).toEqual([]);
        expect(sendTelegram).not.toHaveBeenCalled();
      });
    },
  );

  it("keeps the explicit target when a restart wake carries an untagged event", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
      setTestEnvValue("OPENCLAW_STATE_DIR", tmpDir);
      const marker = "UNTAGGED_WAKE_USES_HEARTBEAT_TARGET";
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "0m", target: "telegram", to: "-100999000111" },
          },
        },
        channels: { telegram: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      const sessionKey = await seedMainSessionStore(storePath, cfg, {
        lastChannel: "webchat",
        lastProvider: "",
        lastTo: "",
        createdVia: "operator",
      });
      enqueueSystemEvent("Reminder: rotate the backup disk", { sessionKey });
      const sendTelegram = vi.fn().mockResolvedValue({ messageId: "hb", chatId: "-100999000111" });
      const reply = vi.fn().mockResolvedValue({ text: marker });
      await runHeartbeatOnce({
        cfg,
        agentId: "main",
        sessionKey,
        source: "restart-sentinel",
        intent: "immediate",
        reason: "wake",
        deps: { getReplyFromConfig: reply, telegram: sendTelegram },
      });
      expect(sendTelegram).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(sendTelegram.mock.calls[0])).toContain(marker);
    });
  });
});

async function publishedAssistantTexts(storePath: string, sessionKey: string, needle: string) {
  const entry = readSessionStoreForTest(storePath)[sessionKey];
  if (!entry?.sessionId) {
    return [];
  }
  const events = await loadTranscriptEvents({
    agentId: "main",
    sessionKey,
    sessionId: entry.sessionId,
    storePath,
  });
  return events
    .map(readTranscriptEventMessage)
    .filter((m) => m?.role === "assistant" && JSON.stringify(m.content).includes(needle));
}
