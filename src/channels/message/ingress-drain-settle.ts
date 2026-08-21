/** Single settle owner for one claimed event: complete / fail / release / guillotine. */
import type { ActiveHandlerState } from "./ingress-drain-state.js";

/**
 * Builds the one function allowed to settle a claim. It runs at most one write,
 * and only marks the claim settled once that write commits: a failed write must
 * keep the heartbeat and in-memory ownership, because a wedged claim is better
 * than a duplicated dispatch.
 */
export function createIngressSettleOwner<TPayload, TMetadata>(params: {
  state: ActiveHandlerState<TPayload, TMetadata>;
  removeActive: (state: ActiveHandlerState<TPayload, TMetadata>) => void;
}): (fn: () => Promise<void>) => Promise<void> {
  const { state, removeActive } = params;
  let settlePromise: Promise<void> | undefined;
  let settled = false;
  return async (fn) => {
    if (settled) {
      return;
    }
    if (settlePromise) {
      await settlePromise;
      return;
    }
    settlePromise = (async () => {
      await fn();
      settled = true;
      state.phase = "settled";
      removeActive(state);
    })();
    try {
      await settlePromise;
    } catch (err) {
      settlePromise = undefined;
      throw err;
    }
  };
}
