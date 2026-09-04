// Covers heartbeat delivery routes for queued events and isolated completions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InternalGetReplyOptions } from "../auto-reply/reply/get-reply.types.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveMainSessionKey } from "../config/sessions/main-session.js";
import { resetCronActiveJobs } from "../cron/active-jobs.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import {
  getFirstReplyContext,
  mockCallAt,
  readSessionStoreForTest,
  seedSessionStore,
  setupTelegramHeartbeatPluginRuntimeForTests,
  withTempHeartbeatSandbox,
} from "./heartbeat-runner.test-utils.js";
import { enqueueSystemEvent, peekSystemEvents, resetSystemEventsForTest } from "./system-events.js";

beforeEach(() => {
  setupTelegramHeartbeatPluginRuntimeForTests();
  resetSystemEventsForTest();
  resetCronActiveJobs();
});

afterEach(() => {
  resetSystemEventsForTest();
  vi.restoreAllMocks();
});

describe("Heartbeat event routing", () => {
  const createLastTargetConfig = (params: {
    tmpDir: string;
    storePath: string;
    isolatedSession?: boolean;
  }): OpenClawConfig => ({
    agents: {
      defaults: {
        workspace: params.tmpDir,
        heartbeat: {
          every: "5m",
          target: "last",
          ...(params.isolatedSession === true ? { isolatedSession: true } : {}),
        },
      },
    },
    channels: { telegram: { allowFrom: ["*"] } },
    session: { store: params.storePath },
  });

  const writeTelegramSessionStore = async (
    storePath: string,
    sessionKey: string,
    overrides: Record<string, unknown>,
  ): Promise<void> => {
    await seedSessionStore(storePath, sessionKey, {
      sessionId: "sid",
      updatedAt: Date.now(),
      lastChannel: "telegram",
      lastProvider: "telegram",
      lastTo: "-100155462274",
      ...overrides,
    });
  };

  const expectTelegramSend = (
    sendTelegram: ReturnType<typeof vi.fn>,
    params: {
      to: string;
      text: string;
      messageThreadId?: number;
    },
  ) => {
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    const [to, text, options] = mockCallAt(sendTelegram, 0, "Telegram send");
    expect(to).toBe(params.to);
    expect(text).toBe(params.text);
    expect((options as { messageThreadId?: number } | undefined)?.messageThreadId).toBe(
      params.messageThreadId,
    );
  };

  it("routes wake-triggered heartbeat replies using queued system-event delivery context", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: {
              every: "5m",
              target: "last",
            },
          },
        },
        channels: { telegram: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      const sessionKey = resolveMainSessionKey(cfg);
      await writeTelegramSessionStore(storePath, sessionKey, {});

      const sendTelegram = vi.fn().mockResolvedValue({
        messageId: "m1",
        chatId: "-100155462274",
      });
      replySpy.mockResolvedValue({ text: "Restart complete" });
      enqueueSystemEvent("Gateway restart ok", {
        sessionKey,
        deliveryContext: {
          channel: "telegram",
          to: "-100155462274",
          threadId: 42,
        },
      });

      const result = await runHeartbeatOnce({
        cfg,
        agentId: "main",
        source: "hook",
        intent: "immediate",
        reason: "wake",
        deps: {
          getReplyFromConfig: replySpy,
          telegram: sendTelegram,
        },
      });

      expect(result.status).toBe("ran");
      expectTelegramSend(sendTelegram, {
        to: "-100155462274",
        text: "Restart complete",
        messageThreadId: 42,
      });
    });
  });

  it.each([
    { name: "base route", eventThreadId: undefined, baseThreadId: 42, expectedThreadId: 42 },
    { name: "same-queue event", eventThreadId: 42, baseThreadId: 42, expectedThreadId: 42 },
    { name: "moved base route", eventThreadId: 42, baseThreadId: 88, expectedThreadId: 42 },
  ])(
    "delivers isolated exec completion using its $name",
    async ({ eventThreadId, baseThreadId, expectedThreadId }) => {
      await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
        const cfg = createLastTargetConfig({ tmpDir, storePath, isolatedSession: true });
        const baseKey = resolveMainSessionKey(cfg);
        const isolatedKey = `${baseKey}:heartbeat`;
        const target = (topic: number) => `telegram:-100155462274:topic:${topic}`;
        await writeTelegramSessionStore(storePath, baseKey, {
          sessionId: "base-conversation",
          lastTo: target(baseThreadId),
          lastThreadId: baseThreadId,
          chatType: "group",
          groupId: `-100155462274:topic:${baseThreadId}`,
          subject: "Operations",
          groupActivation: "always",
        });
        await seedSessionStore(storePath, isolatedKey, {
          sessionId: "previous-isolated-run",
          heartbeatIsolatedBaseSessionKey: baseKey,
        });
        const completion = "Exec completed (background-report, code 0) :: report is ready";
        enqueueSystemEvent(completion, {
          sessionKey: isolatedKey,
          ...(eventThreadId === undefined
            ? {}
            : {
                deliveryContext: {
                  channel: "telegram",
                  to: target(eventThreadId),
                  threadId: eventThreadId,
                },
              }),
        });
        const sendTelegram = vi
          .fn()
          .mockResolvedValue({ messageId: "completion", chatId: "-100155462274" });
        replySpy.mockResolvedValue({ text: "The report is ready." });

        const result = await runHeartbeatOnce({
          cfg,
          agentId: "main",
          sessionKey: isolatedKey,
          reason: "exec-event",
          deps: { getReplyFromConfig: replySpy, telegram: sendTelegram },
        });

        expect(result.status).toBe("ran");
        expectTelegramSend(sendTelegram, {
          to: target(expectedThreadId),
          text: "The report is ready.",
          messageThreadId: expectedThreadId,
        });
        expect(getFirstReplyContext(replySpy)).toMatchObject({
          SessionKey: isolatedKey,
          InternalTurnSource: "exec",
          MessageThreadId: expectedThreadId,
          OriginatingChannel: "telegram",
          OriginatingTo: target(expectedThreadId),
          ChatType: "group",
        });
        const options = mockCallAt(
          replySpy,
          0,
          "isolated completion",
        )[1] as InternalGetReplyOptions;
        expect(options.replyConversation?.fields).toMatchObject({
          Provider: "telegram",
          Surface: "telegram",
          ChatType: "group",
        });
        expect(options.replyConversation?.fields.GroupSubject).toBe(
          baseThreadId === expectedThreadId ? "Operations" : undefined,
        );
        expect(options.replyConversation?.activation).toBe(
          baseThreadId === expectedThreadId ? "always" : undefined,
        );
        expect(peekSystemEvents(isolatedKey)).toEqual([]);
        const rows = readSessionStoreForTest(storePath);
        expect(rows[baseKey]?.sessionId).toBe("base-conversation");
        expect(rows[isolatedKey]?.heartbeatIsolatedBaseSessionKey).toBe(baseKey);
        expect(rows[isolatedKey]?.sessionId).not.toBe("previous-isolated-run");
        expect(rows[isolatedKey]?.groupActivation).toBeUndefined();
      });
    },
  );

  it("does not reuse stale turn-source routing for isolated wake runs", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = createLastTargetConfig({ tmpDir, storePath, isolatedSession: true });
      const sessionKey = resolveMainSessionKey(cfg);
      await writeTelegramSessionStore(storePath, sessionKey, { lastTo: "-100155462274" });

      const sendTelegram = vi.fn().mockResolvedValue({
        messageId: "m1",
        chatId: "-100155462274",
      });
      replySpy.mockResolvedValue({ text: "Restart complete" });
      enqueueSystemEvent("Gateway restart ok", {
        sessionKey,
        deliveryContext: {
          channel: "telegram",
          to: "-100999999999",
          threadId: 42,
        },
      });

      const result = await runHeartbeatOnce({
        cfg,
        agentId: "main",
        source: "hook",
        intent: "immediate",
        reason: "wake",
        deps: {
          getReplyFromConfig: replySpy,
          telegram: sendTelegram,
        },
      });

      expect(result.status).toBe("ran");
      expect(getFirstReplyContext(replySpy).SessionKey).toBe(`${sessionKey}:heartbeat`);
      expectTelegramSend(sendTelegram, {
        to: "-100155462274",
        text: "Restart complete",
      });
    });
  });
  it("keeps output-bearing exec-event delivery pinned to the original Telegram topic when session route drifts", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: {
              every: "5m",
              target: "last",
            },
          },
        },
        channels: { telegram: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      const sessionKey = "agent:main:telegram:group:-1003774691294:topic:47";
      await writeTelegramSessionStore(storePath, sessionKey, {
        lastTo: "telegram:-1003774691294:topic:2175",
        lastThreadId: 2175,
      });

      const sendTelegram = vi.fn().mockResolvedValue({
        messageId: "m1",
        chatId: "-1003774691294",
      });
      const getReplySpy = vi.fn().mockResolvedValue({
        text: "The review-worker spawn finished successfully.",
      });
      enqueueSystemEvent("Exec completed (review-run, code 0) :: review-worker spawn finished", {
        sessionKey,
        deliveryContext: {
          channel: "telegram",
          to: "telegram:-1003774691294:topic:47",
          threadId: 47,
        },
      });

      const result = await runHeartbeatOnce({
        cfg,
        agentId: "main",
        sessionKey,
        reason: "exec-event",
        deps: {
          getReplyFromConfig: getReplySpy,
          telegram: sendTelegram,
        },
      });

      expect(result.status).toBe("ran");
      expectTelegramSend(sendTelegram, {
        to: "telegram:-1003774691294:topic:47",
        text: "The review-worker spawn finished successfully.",
        messageThreadId: 47,
      });
    });
  });

  it("suppresses metadata-only successful exec completions", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: {
              every: "5m",
              target: "last",
            },
          },
        },
        channels: { telegram: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      const sessionKey = "agent:main:telegram:group:-1003774691294:topic:47";
      await writeTelegramSessionStore(storePath, sessionKey, {
        lastTo: "telegram:-1003774691294:topic:2175",
        lastThreadId: 2175,
      });

      const sendTelegram = vi.fn();
      const getReplySpy = vi.fn().mockResolvedValue({
        text: "HEARTBEAT_OK",
      });
      enqueueSystemEvent("Exec completed (review-run, code 0)", {
        sessionKey,
        deliveryContext: {
          channel: "telegram",
          to: "telegram:-1003774691294:topic:47",
          threadId: 47,
        },
      });

      const result = await runHeartbeatOnce({
        cfg,
        agentId: "main",
        sessionKey,
        reason: "exec-event",
        deps: {
          getReplyFromConfig: getReplySpy,
          telegram: sendTelegram,
        },
      });

      expect(result.status).toBe("ran");
      expect(getFirstReplyContext(getReplySpy).Body).toContain("no command output was found");
      expect(sendTelegram).not.toHaveBeenCalled();
    });
  });

  it("keeps Telegram topic routing for isolated scheduled heartbeats", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = createLastTargetConfig({ tmpDir, storePath, isolatedSession: true });
      const sessionKey = resolveMainSessionKey(cfg);
      await writeTelegramSessionStore(storePath, sessionKey, {
        lastTo: "-100155462274",
        deliveryContext: {
          channel: "telegram",
          to: "-100155462274",
          threadId: 42,
        },
        chatType: "group",
      });

      const sendTelegram = vi.fn().mockResolvedValue({
        messageId: "m1",
        chatId: "-100155462274",
      });
      replySpy.mockResolvedValue({ text: "Topic heartbeat" });

      const result = await runHeartbeatOnce({
        cfg,
        agentId: "main",
        reason: "timer",
        deps: {
          getReplyFromConfig: replySpy,
          telegram: sendTelegram,
        },
      });

      expect(result.status).toBe("ran");
      const replyCtx = getFirstReplyContext(replySpy);
      expect(replyCtx.SessionKey).toBe(`${sessionKey}:heartbeat`);
      expect(replyCtx.MessageThreadId).toBe(42);
      expectTelegramSend(sendTelegram, {
        to: "-100155462274",
        text: "Topic heartbeat",
        messageThreadId: 42,
      });
    });
  });
});
