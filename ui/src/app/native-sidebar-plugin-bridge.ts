import { isRecord } from "@openclaw/normalization-core/record-coerce";
import { z } from "zod";
import type { SessionRowObservation } from "../lib/sessions/session-capability.ts";
import {
  pluginSessionMenuActions,
  runControlUiNavigationAction,
  runControlUiPluginAction,
} from "../plugins/control-ui-actions.ts";
import type {
  ControlUiContributions,
  ControlUiRegistration,
} from "../plugins/control-ui-capability.ts";
import type { ApplicationContext } from "./context.ts";
import { nativeEmbedHost } from "./native-web-chrome.ts";

const COMMAND_EVENT = "openclaw:native-sidebar-plugin-command";
const commandSchema = z
  .object({
    contract: z.literal(1),
    documentId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128),
    revision: z.number().int().nonnegative(),
    type: z.enum(["open", "run", "session-run"]),
    key: z.string().min(1).max(4096),
    actionId: z.string().min(1).max(4096).optional(),
  })
  .strict();

const sessionTargetSchema = z
  .object({
    key: z.string().min(1).max(4096),
    sessionId: z.string().min(1).max(4096),
    agentId: z.string().min(1).max(4096),
  })
  .strict();

type NativeWindow = Window & {
  __OPENCLAW_NATIVE_SIDEBAR_PLUGINS__?: unknown;
  webkit?: {
    messageHandlers?: {
      openclawSidebarPlugins?: {
        postMessage: (message: unknown) => Promise<unknown>;
      };
    };
  };
};

/** Project registrations; never serialize closures or invent a second plugin executor. */
export function startNativeSidebarPluginBridge(
  context: ApplicationContext,
): (() => void) | undefined {
  const host = window as NativeWindow;
  const marker = host.__OPENCLAW_NATIVE_SIDEBAR_PLUGINS__;
  const handler = host.webkit?.messageHandlers?.openclawSidebarPlugins;
  if (
    !nativeEmbedHost() ||
    !isRecord(marker) ||
    marker.contract !== 1 ||
    typeof handler?.postMessage !== "function"
  ) {
    return undefined;
  }
  const documentId = crypto.randomUUID();
  const lifetime = new AbortController();
  let revision = 0;
  let publishedConnection = context.gateway.connectionRevision;
  let published = new Map<string, ControlUiRegistration<ControlUiContributions["navigation"]>>();
  let pending = false;
  const parsedSession = sessionTargetSchema.safeParse(marker.session);
  const sessionTarget = parsedSession.success ? parsedSession.data : undefined;
  let sessionObservation: SessionRowObservation | undefined;
  let readingSession: Promise<void> | undefined;
  let sessionConnection: number | undefined;
  let readGeneration = 0;
  let sessionError: string | undefined;
  const currentSession = () => {
    const row = sessionObservation?.row;
    if (
      !sessionTarget ||
      !row ||
      !sessionObservation?.isCurrent() ||
      row.key !== sessionTarget.key ||
      row.sessionId !== sessionTarget.sessionId
    ) {
      return undefined;
    }
    return row;
  };
  const post = (message: Record<string, unknown>) => {
    if (!lifetime.signal.aborted) {
      void handler.postMessage({ contract: 1, documentId, ...message }).catch(() => undefined);
    }
  };
  const publish = () => {
    publishedConnection = context.gateway.connectionRevision;
    published = new Map(
      context.plugins
        .registrations("navigation")
        .filter((entry) => !entry.signal.aborted)
        .slice(0, 256)
        .map((entry) => [entry.key, entry]),
    );
    post({
      type: "snapshot",
      revision: ++revision,
      connected: context.gateway.snapshot.phase === "connected",
      ...(sessionError ? { sessionError } : {}),
      sessionActions: currentSession()
        ? pluginSessionMenuActions(context.plugins, currentSession()!).map((action) => ({
            ...action,
            disabled: action.disabled === true,
          }))
        : [],
      entries: [...published.values()].map((entry) => ({
        key: entry.key,
        pluginId: entry.pluginId,
        label: entry.value.label,
        parent: entry.value.parent ?? null,
        defaultVisible: entry.value.defaultVisible !== false,
        pageHref: entry.host.navigation.pageHref(entry.value.page),
        icon: entry.value.icon ?? null,
        actions: (entry.value.actions ?? []).slice(0, 64).map((action) => ({
          id: action.id,
          label: action.label,
          destructive: action.destructive === true,
          icon: action.icon ?? null,
        })),
      })),
    });
  };
  const onCommand = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }
    const parsed = commandSchema.safeParse(event.detail);
    if (!parsed.success || parsed.data.documentId !== documentId || lifetime.signal.aborted) {
      return;
    }
    const command = parsed.data;
    const respond = (ok: boolean, error?: string) =>
      post({
        type: "result",
        requestId: command.requestId,
        ok,
        ...(error ? { error } : {}),
      });
    const entry = published.get(command.key);
    const isSession = command.type === "session-run";
    if (
      pending ||
      command.revision !== revision ||
      (!isSession && (!entry || entry.signal.aborted)) ||
      context.gateway.snapshot.phase !== "connected" ||
      context.gateway.connectionRevision !== publishedConnection ||
      (!isSession &&
        !context.plugins
          .registrations("navigation")
          .some((current) => current.key === entry!.key && current.signal === entry!.signal)) ||
      (isSession && (command.key !== sessionTarget?.key || !currentSession()))
    ) {
      respond(false, "The plugin menu changed. Reopen it and try again.");
      return;
    }
    const connection = publishedConnection;
    pending = true;
    void (async () => {
      try {
        switch (command.type) {
          case "open":
            entry!.host.navigation.openPage(entry!.value.page);
            break;
          case "run":
            if (!command.actionId) {
              throw new Error("Choose a plugin action.");
            }
            await runControlUiNavigationAction(entry!, command.actionId, lifetime.signal);
            break;
          case "session-run":
            if (!command.actionId || !sessionTarget) {
              throw new Error("Choose a session action.");
            }
            await runControlUiPluginAction({
              runtime: context.plugins,
              id: command.actionId,
              placement: "session",
              sessionKey: sessionTarget.key,
              agentId: sessionTarget.agentId,
              session: currentSession(),
              signal: lifetime.signal,
            });
            break;
        }
        if (
          lifetime.signal.aborted ||
          entry?.signal.aborted ||
          context.gateway.connectionRevision !== connection
        ) {
          throw new Error("The connection changed while the plugin action was running.");
        }
        respond(true);
      } catch (error) {
        if (entry && !entry.signal.aborted) {
          context.plugins.reportError(entry.pluginId, error);
        }
        respond(false, error instanceof Error ? error.message : String(error));
      } finally {
        pending = false;
        if (!lifetime.signal.aborted) {
          publish();
        }
      }
    })();
  };
  const refreshSession = () => {
    if (
      !sessionTarget ||
      !sessionObservation?.isCurrent() ||
      readingSession ||
      lifetime.signal.aborted
    ) {
      return;
    }
    const observation = sessionObservation;
    const reconcile = observation.captureReconcile();
    const generation = ++readGeneration;
    readingSession = context.sessions
      .describe({ key: sessionTarget.key, agentId: sessionTarget.agentId })
      .then((result) => {
        if (lifetime.signal.aborted || sessionObservation !== observation) {
          return;
        }
        reconcile(result.session ?? undefined);
        sessionError = currentSession() ? undefined : "This session changed. Reopen its menu.";
        publish();
      })
      .catch((error: unknown) => {
        if (!lifetime.signal.aborted) {
          sessionError = error instanceof Error ? error.message : String(error);
          publish();
        }
      })
      .finally(() => {
        if (generation === readGeneration) {
          readingSession = undefined;
        }
      });
  };
  const synchronizeSession = () => {
    if (!sessionTarget) {
      return;
    }
    if (context.gateway.snapshot.phase !== "connected") {
      sessionObservation?.dispose();
      sessionObservation = undefined;
      sessionConnection = undefined;
      readGeneration++;
      readingSession = undefined;
      return;
    }
    if (
      sessionConnection === context.gateway.connectionRevision &&
      sessionObservation?.isCurrent()
    ) {
      return;
    }
    sessionObservation?.dispose();
    sessionConnection = context.gateway.connectionRevision;
    readGeneration++;
    readingSession = undefined;
    sessionObservation = context.sessions.observeRow(
      { key: sessionTarget.key, agentId: sessionTarget.agentId },
      publish,
      { onInvalidate: refreshSession },
    );
    refreshSession();
  };
  window.addEventListener(COMMAND_EVENT, onCommand);
  const stopPlugins = context.plugins.subscribe(publish);
  const stopGateway = context.gateway.subscribe(() => {
    synchronizeSession();
    publish();
  });
  synchronizeSession();
  publish();
  return () => {
    lifetime.abort();
    stopPlugins();
    stopGateway();
    sessionObservation?.dispose();
    window.removeEventListener(COMMAND_EVENT, onCommand);
    published.clear();
  };
}
