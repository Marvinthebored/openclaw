/** Resolves the effective reply route from current context and persisted session route. */
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { normalizeChatType, type ChatType } from "../../channels/chat-type.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import {
  stripOutboundTargetKindPrefix,
  stripTargetProviderPrefix,
} from "../../infra/outbound/channel-target-prefix.js";
import { stringifyRouteThreadId } from "../../plugin-sdk/channel-route.js";
import { normalizeOptionalAccountId } from "../../routing/account-id.js";
import type { InputProvenance } from "../../sessions/input-provenance.js";
import {
  deliveryContextFromSession,
  sessionDeliveryOrigin,
  sessionDeliveryRoute,
} from "../../utils/delivery-context.shared.js";
import { INTERNAL_MESSAGE_CHANNEL, normalizeMessageChannel } from "../../utils/message-channel.js";
import type { FinalizedMsgContext } from "../templating.js";

/** Current finalized context fields used for reply route resolution. */
type EffectiveReplyRouteContext = Pick<
  FinalizedMsgContext,
  | "Provider"
  | "Surface"
  | "OriginatingChannel"
  | "OriginatingTo"
  | "AccountId"
  | "InputProvenance"
  | "InternalTurnSource"
  | "ChatType"
>;

/** Persisted session fields used as route fallback/inheritance. */
type EffectiveReplyRouteEntry = Pick<SessionEntry, "delivery" | "chatType">;

/** Effective channel target selected for source reply delivery. */
export type EffectiveReplyRoute = {
  channel?: string;
  to?: string;
  accountId?: string;
  threadId?: string | number;
  chatType?: ChatType;
  inheritedExternalRoute?: boolean;
};

/** Normalizes an external target without collapsing provider-owned topic suffixes. */
export function normalizeEffectiveReplyTarget(
  raw: string | undefined,
  channel: string | null | undefined,
): string | undefined {
  const target = normalizeOptionalString(raw);
  return target
    ? normalizeOptionalString(
        stripOutboundTargetKindPrefix(stripTargetProviderPrefix(target, channel ?? "")),
      )
    : undefined;
}

/** Matches the full channel, target, and account tuple before persisted prompt state is reused. */
export function effectiveReplyRouteMatchesSessionDelivery(params: {
  route: EffectiveReplyRoute;
  entry: EffectiveReplyRouteEntry;
  fallbackTo?: string;
}): boolean {
  const persisted = deliveryContextFromSession(params.entry);
  const channel = normalizeMessageChannel(params.route.channel);
  const persistedChannel = normalizeMessageChannel(persisted?.channel);
  return (
    channel !== undefined &&
    channel === persistedChannel &&
    normalizeEffectiveReplyTarget(params.route.to, channel) ===
      normalizeEffectiveReplyTarget(persisted?.to ?? params.fallbackTo, channel) &&
    normalizeOptionalAccountId(params.route.accountId) ===
      normalizeOptionalAccountId(persisted?.accountId)
  );
}

function isSessionsSendInterSessionHandoff(inputProvenance: InputProvenance | undefined): boolean {
  return (
    inputProvenance?.kind === "inter_session" &&
    inputProvenance.sourceTool?.toLowerCase() === "sessions_send"
  );
}

function resolveTrustedInheritedThreadId(
  entry: EffectiveReplyRouteEntry | undefined,
): string | number | undefined {
  const deliveryThreadId = deliveryContextFromSession(entry)?.threadId;
  if (deliveryThreadId == null) {
    return undefined;
  }
  const routeThread = sessionDeliveryRoute(entry)?.thread;
  if (
    routeThread?.id != null &&
    (routeThread.source === "explicit" ||
      routeThread.source === "target" ||
      routeThread.source === "turn") &&
    stringifyRouteThreadId(routeThread.id) === stringifyRouteThreadId(deliveryThreadId)
  ) {
    return deliveryThreadId;
  }
  return undefined;
}

/** Resolves current, inherited, or persisted reply route for a session turn. */
export function resolveEffectiveReplyRoute(params: {
  ctx: EffectiveReplyRouteContext;
  entry?: EffectiveReplyRouteEntry;
}): EffectiveReplyRoute {
  const currentSurface =
    normalizeMessageChannel(params.ctx.Provider) ??
    normalizeMessageChannel(params.ctx.Surface) ??
    normalizeMessageChannel(params.ctx.OriginatingChannel);
  const persistedDeliveryContext = deliveryContextFromSession(params.entry);
  const persistedRoute = sessionDeliveryRoute(params.entry);
  const persistedOrigin = sessionDeliveryOrigin(params.entry);
  const persistedDeliveryChannel = normalizeMessageChannel(persistedDeliveryContext?.channel);
  const liveChatType = normalizeChatType(params.ctx.ChatType);
  const persistedChatType =
    persistedRoute?.target?.chatType ??
    params.entry?.chatType ??
    normalizeChatType(persistedOrigin?.chatType);
  if (
    isSessionsSendInterSessionHandoff(params.ctx.InputProvenance) &&
    currentSurface === INTERNAL_MESSAGE_CHANNEL &&
    persistedDeliveryChannel &&
    persistedDeliveryChannel !== INTERNAL_MESSAGE_CHANNEL &&
    persistedDeliveryContext?.to
  ) {
    const inheritedThreadId = resolveTrustedInheritedThreadId(params.entry);
    return {
      channel: persistedDeliveryChannel,
      to: persistedDeliveryContext.to,
      accountId: persistedDeliveryContext.accountId,
      ...(inheritedThreadId !== undefined ? { threadId: inheritedThreadId } : {}),
      ...(persistedChatType ? { chatType: persistedChatType } : {}),
      inheritedExternalRoute: true,
    };
  }
  if (params.ctx.InternalTurnSource === undefined) {
    return {
      channel: params.ctx.OriginatingChannel,
      to: params.ctx.OriginatingTo,
      accountId: params.ctx.AccountId,
      ...(liveChatType ? { chatType: liveChatType } : {}),
    };
  }
  const persistedChannel = persistedDeliveryContext?.channel;
  const liveChannel = params.ctx.OriginatingChannel;
  const canInheritPersistedTuple =
    !liveChannel ||
    normalizeMessageChannel(liveChannel) === normalizeMessageChannel(persistedChannel);
  const chatType = liveChatType ?? (canInheritPersistedTuple ? persistedChatType : undefined);
  return {
    channel: liveChannel ?? persistedChannel,
    to:
      params.ctx.OriginatingTo ??
      (canInheritPersistedTuple ? persistedDeliveryContext?.to : undefined),
    accountId:
      params.ctx.AccountId ??
      (canInheritPersistedTuple ? persistedDeliveryContext?.accountId : undefined),
    ...(chatType ? { chatType } : {}),
  };
}
