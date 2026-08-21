import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import type { ChannelIngressDispatchLifecycle } from "./ingress-drain-lifecycle.js";
import { createChannelIngressDrain, isIngressAdoptionLostError } from "./ingress-drain.js";
import {
  createTestIngressQueue,
  type IngressDrainTestPayload as Payload,
  withTempState,
} from "./ingress-drain.test-helpers.js";

describe("channel ingress drain watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    closeOpenClawStateDatabaseForTest();
  });

  it("retries pre-adoption stalls in lane order and fences late adoption", async () => {
    await withTempState(async (stateDir) => {
      let clock = 10_000;
      const queue = createTestIngressQueue(stateDir, { now: () => clock });
      await queue.enqueue("evt-stall", { text: "x" }, { laneKey: "l1" });
      await queue.enqueue("evt-next", { text: "next" }, { laneKey: "l1", receivedAt: clock + 1 });
      const dispatched: string[] = [];
      let stalledLifecycle: ChannelIngressDispatchLifecycle | undefined;

      const drain = createChannelIngressDrain<Payload>({
        queue,
        now: () => clock,
        adoptionStallTimeoutMs: 5_000,
        retryPolicy: { baseMs: 1_000, maxMs: 1_000 },
        dispatchClaimedEvent: async (event, lifecycle) => {
          dispatched.push(event.id);
          if (!stalledLifecycle) {
            stalledLifecycle = lifecycle;
            await new Promise(() => {});
          }
          await lifecycle.onAdopted();
        },
      });

      await drain.drainOnce();
      clock += 5_000;
      await vi.advanceTimersByTimeAsync(5_000);
      await drain.waitForIdle();

      expect(await queue.listFailed?.({ limit: "all" })).toEqual([]);
      expect(await queue.listPending({ limit: "all", orderBy: "received" })).toMatchObject([
        { id: "evt-stall", attempts: 1, lastError: expect.stringContaining("handler-timeout") },
        { id: "evt-next", attempts: 0 },
      ]);
      await expect(stalledLifecycle?.onAdopted()).rejects.toSatisfy(isIngressAdoptionLostError);

      expect(await drain.drainOnce()).toEqual({ started: 0 });
      clock += 1_000;
      expect(await drain.drainOnce()).toEqual({ started: 1 });
      await drain.waitForIdle();
      expect(await drain.drainOnce()).toEqual({ started: 1 });
      await drain.waitForIdle();
      expect(dispatched).toEqual(["evt-stall", "evt-stall", "evt-next"]);
      drain.dispose();
    });
  });

  it("guillotines deferred stalls", async () => {
    await withTempState(async (stateDir) => {
      let clock = 30_000;
      const queue = createTestIngressQueue(stateDir, { now: () => clock });
      await queue.enqueue("evt-def-stall", { text: "x" }, { laneKey: "l1" });

      const drain = createChannelIngressDrain<Payload>({
        queue,
        now: () => clock,
        adoptionStallTimeoutMs: 5_000,
        dispatchClaimedEvent: async (_event, lifecycle) => {
          lifecycle.onDeferred();
          // Stay deferred without adoption -- watchdog must still fire.
          await new Promise(() => {});
        },
      });

      await drain.drainOnce();
      expect(await queue.listClaims()).toHaveLength(1);
      clock += 5_000;
      await vi.advanceTimersByTimeAsync(5_000);
      await drain.waitForIdle();

      expect(await queue.listFailed?.({ limit: "all" })).toEqual([]);
      expect(await queue.listPending({ limit: "all" })).toMatchObject([
        {
          id: "evt-def-stall",
          attempts: 1,
          lastError: expect.stringContaining("handler-timeout"),
        },
      ]);
      drain.dispose();
    });
  });

  it("does not kill healthy long turns after adoption", async () => {
    await withTempState(async (stateDir) => {
      let clock = 20_000;
      const queue = createTestIngressQueue(stateDir, { now: () => clock });
      await queue.enqueue("evt-long", { text: "x" }, { laneKey: "l1" });

      let settleResolve!: () => void;
      const settleGate = new Promise<void>((resolve) => {
        settleResolve = resolve;
      });

      const drain = createChannelIngressDrain<Payload>({
        queue,
        now: () => clock,
        adoptionStallTimeoutMs: 1_000,
        dispatchClaimedEvent: async (_event, lifecycle) => {
          await lifecycle.onAdopted();
          await settleGate;
        },
      });

      await drain.drainOnce();
      await vi.waitFor(async () => {
        expect(await queue.listClaims()).toEqual([]);
      });
      clock += 60_000;
      await vi.advanceTimersByTimeAsync(60_000);
      const status = await queue.enqueue("evt-long", { text: "x" });
      expect(status.kind).toBe("completed");
      settleResolve();
      await drain.waitForIdle();
      drain.dispose();
    });
  });
  it("does not guillotine a deferred claim while its owner proves it still holds it", async () => {
    await withTempState(async (stateDir) => {
      let clock = 30_000;
      const queue = createTestIngressQueue(stateDir, { now: () => clock });
      await queue.enqueue("evt-def-live", { text: "x" }, { laneKey: "l1" });

      const ownerHoldsIt = true;
      let adopt: (() => Promise<void>) | undefined;
      const drain = createChannelIngressDrain<Payload>({
        queue,
        now: () => clock,
        adoptionStallTimeoutMs: 5_000,
        dispatchClaimedEvent: async (_event, lifecycle) => {
          // Queued behind a healthy long-running turn: the reply lane still owns
          // this event, so waiting is not stalling.
          lifecycle.onDeferred(() => ownerHoldsIt);
          adopt = async () => await lifecycle.onAdopted();
          await new Promise(() => {});
        },
      });

      await drain.drainOnce();
      expect(await queue.listClaims()).toHaveLength(1);

      // Ten stall timeouts later the claim is still there, because the owner is.
      clock += 50_000;
      await vi.advanceTimersByTimeAsync(50_000);
      expect(await queue.listFailed?.({ limit: "all" })).toEqual([]);
      expect(await queue.listClaims()).toHaveLength(1);

      await adopt?.();
      expect(await queue.listClaims()).toEqual([]);
      expect(await queue.listFailed?.({ limit: "all" })).toEqual([]);
      drain.dispose();
    });
  });

  it("guillotines a deferred claim once its owner stops holding it", async () => {
    await withTempState(async (stateDir) => {
      let clock = 40_000;
      const queue = createTestIngressQueue(stateDir, { now: () => clock });
      await queue.enqueue("evt-def-lost", { text: "x" }, { laneKey: "l1" });

      let ownerHoldsIt = true;
      const drain = createChannelIngressDrain<Payload>({
        queue,
        now: () => clock,
        adoptionStallTimeoutMs: 5_000,
        dispatchClaimedEvent: async (_event, lifecycle) => {
          lifecycle.onDeferred(() => ownerHoldsIt);
          await new Promise(() => {});
        },
      });

      await drain.drainOnce();
      clock += 5_000;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await queue.listFailed?.({ limit: "all" })).toEqual([]);

      // The owner vanished without settling. Recovery must still happen: the
      // claim and its lane cannot be held by nobody.
      ownerHoldsIt = false;
      clock += 5_000;
      await vi.advanceTimersByTimeAsync(5_000);
      await drain.waitForIdle();

      expect(await queue.listClaims()).toEqual([]);
      expect(await queue.listFailed?.({ limit: "all" })).toMatchObject([
        { id: "evt-def-lost", reason: "handler-timeout" },
      ]);
      expect(drain.activeLaneKeys().has("l1")).toBe(false);
      drain.dispose();
    });
  });
  it("accepts owner proof that arrives after the claim already deferred", async () => {
    await withTempState(async (stateDir) => {
      let clock = 60_000;
      const queue = createTestIngressQueue(stateDir, { now: () => clock });
      await queue.enqueue("evt-late-proof", { text: "x" }, { laneKey: "l1" });

      // The channel defers at dispatch, before anything knows who will own the
      // turn. The reply queue only learns it holds the turn afterwards, and
      // offers its proof then. Dropping that late proof puts an owned message
      // back under the guillotine.
      const drain = createChannelIngressDrain<Payload>({
        queue,
        now: () => clock,
        adoptionStallTimeoutMs: 5_000,
        dispatchClaimedEvent: async (_event, lifecycle) => {
          lifecycle.onDeferred();
          lifecycle.onDeferred(() => true);
          await new Promise(() => {});
        },
      });

      await drain.drainOnce();
      expect(await queue.listClaims()).toHaveLength(1);

      clock += 50_000;
      await vi.advanceTimersByTimeAsync(50_000);

      expect(await queue.listFailed?.({ limit: "all" })).toEqual([]);
      expect(await queue.listClaims()).toHaveLength(1);
      drain.dispose();
    });
  });
  it("guillotines a deferred claim when the owner proof throws", async () => {
    await withTempState(async (stateDir) => {
      let clock = 80_000;
      const queue = createTestIngressQueue(stateDir, { now: () => clock });
      await queue.enqueue("evt-def-throws", { text: "x" }, { laneKey: "l1" });

      const logged: string[] = [];
      const drain = createChannelIngressDrain<Payload>({
        queue,
        now: () => clock,
        adoptionStallTimeoutMs: 5_000,
        onLog: (message) => logged.push(message),
        dispatchClaimedEvent: async (_event, lifecycle) => {
          // Foreign code running inside the watchdog timer. A throw must not
          // escape and leave the claim neither held nor dead-lettered.
          lifecycle.onDeferred(() => {
            throw new Error("owner probe exploded");
          });
          await new Promise(() => {});
        },
      });

      await drain.drainOnce();
      clock += 5_000;
      await vi.advanceTimersByTimeAsync(5_000);
      await drain.waitForIdle();

      expect(await queue.listClaims()).toEqual([]);
      expect(await queue.listFailed?.({ limit: "all" })).toMatchObject([
        { id: "evt-def-throws", reason: "handler-timeout" },
      ]);
      expect(drain.activeLaneKeys().has("l1")).toBe(false);
      expect(logged.some((line) => line.includes("owner liveness check threw"))).toBe(true);
      drain.dispose();
    });
  });
});
