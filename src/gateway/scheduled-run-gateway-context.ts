/**
 * Supplies a Gateway request context to scheduler-owned agent runs.
 *
 * Timer ticks, hook dispatch queues, and heartbeat wakeups have no Gateway
 * request of their own, so trusted built-in tools (terminal, dashboard) resolve
 * no context and fail mid-run. RPC-triggered runs already inherit a scope from
 * their caller and must keep it.
 */
import { withPluginRuntimeGatewayContextResolver } from "../plugins/runtime/gateway-request-scope.js";
import type { GatewayRequestContext } from "./server-methods/types.js";
import { getInProcessGatewayRequestContext } from "./server-plugin-in-process-dispatch.js";

type ScheduledGatewayContextResolver = () => GatewayRequestContext | undefined;

/**
 * Fences a raw context reference behind the owning Gateway instance lifecycle.
 *
 * The process-wide holder is not cleared on shutdown, so a queued run could
 * otherwise resolve a retired context. The context's own `resolveGatewayContext`
 * returns undefined once its instance is unavailable; prefer no context over a
 * retired one, because a missing context fails visibly.
 */
export function fenceScheduledGatewayContextResolver(
  resolveGatewayContext: ScheduledGatewayContextResolver | undefined,
): ScheduledGatewayContextResolver | undefined {
  if (!resolveGatewayContext) {
    return undefined;
  }
  return () => {
    const context = resolveGatewayContext();
    return context?.resolveGatewayContext?.() ?? undefined;
  };
}

/**
 * Runs scheduler-owned work with a Gateway context.
 *
 * Timer/startup work replaces any request scope inherited while its timer was
 * armed. Caller-owned work preserves a resolvable context; registry-only and
 * plugin-identity scopes still receive the scheduler resolver.
 */
export async function runWithScheduledGatewayContext<T>(params: {
  resolveGatewayContext?: ScheduledGatewayContextResolver;
  replaceExistingContext?: boolean;
  run: () => Promise<T>;
}): Promise<T> {
  const resolveGatewayContext = params.resolveGatewayContext;
  if (
    !resolveGatewayContext ||
    (!params.replaceExistingContext && getInProcessGatewayRequestContext())
  ) {
    return await params.run();
  }
  return await withPluginRuntimeGatewayContextResolver(resolveGatewayContext, params.run, {
    inheritRequestScope: !params.replaceExistingContext,
  });
}
