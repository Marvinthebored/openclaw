import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ControlUiHost,
  ControlUiNavigationItem,
  ControlUiSession,
} from "../../../src/plugin-sdk/control-ui.js";
import { createDeferred } from "../../../test/helpers/promise.js";
import type {
  ControlUiContributions,
  ControlUiRegistration,
} from "../plugins/control-ui-capability.ts";
import type { ApplicationContext } from "./context.ts";
import { startNativeSidebarPluginBridge } from "./native-sidebar-plugin-bridge.ts";

type WireMessage = {
  type: string;
  documentId: string;
  revision: number;
  ok?: boolean;
  error?: string;
  entries?: unknown[];
  sessionActions?: unknown[];
};
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
});

function fixture(sessionId?: string) {
  const run = vi.fn();
  const openPage = vi.fn();
  const abort = new AbortController();
  const registration: ControlUiRegistration<ControlUiNavigationItem> = {
    key: "example/board",
    pluginId: "example",
    signal: abort.signal,
    host: {
      signal: abort.signal,
      sessions: {},
      agents: {},
      ui: {},
      components: {},
      navigation: { openPage, pageHref: () => "/boards" },
    } as unknown as ControlUiHost,
    value: {
      id: "board",
      label: "Boards",
      page: { id: "board" },
      defaultVisible: false,
      actions: [{ id: "delete", label: "Delete board", icon: "trash", destructive: true, run }],
    },
  };
  let entries = [registration];
  let revision = 1;
  let listener = () => {};
  let row = {
    key: "agent:main:example",
    agentId: "main",
    sessionId: "original",
  } as ControlUiSession;
  let rowListener = () => {};
  const sessionRun = vi.fn();
  const sessionResolve = vi.fn(() => ({ disabled: false }));
  const sessionEntry: ControlUiRegistration<ControlUiContributions["actions"]> = {
    key: "example/session",
    pluginId: "example",
    signal: abort.signal,
    host: registration.host,
    value: {
      id: "session",
      label: "Inspect session",
      placement: "session",
      run: sessionRun,
      resolve: sessionResolve,
    },
  };
  const disposeRow = vi.fn();
  const messages: WireMessage[] = [];
  let response = createDeferred<WireMessage>();
  const post = vi.fn(async (message: WireMessage) => {
    messages.push(message);
    if (message.type === "result") {
      response.resolve(message);
    }
  });
  vi.stubGlobal("__OPENCLAW_NATIVE_EMBED__", { platform: "ios", formFactor: "phone" });
  vi.stubGlobal("__OPENCLAW_NATIVE_SIDEBAR_PLUGINS__", {
    contract: 1,
    ...(sessionId ? { session: { key: row.key, agentId: "main", sessionId } } : {}),
  });
  vi.stubGlobal("webkit", { messageHandlers: { openclawSidebarPlugins: { postMessage: post } } });
  const context = {
    gateway: {
      snapshot: { phase: "connected" },
      get connectionRevision() {
        return revision;
      },
      subscribe: () => () => {},
    },
    plugins: {
      registrations: (kind: string) => (kind === "actions" ? [sessionEntry] : entries),
      subscribe: (callback: () => void) => {
        listener = callback;
        return () => {};
      },
      reportError: vi.fn(),
    },
    sessions: {
      describe: vi.fn(async () => ({ session: row })),
      observeRow: (_target: unknown, callback: () => void) => {
        rowListener = callback;
        return {
          get row() {
            return row;
          },
          isCurrent: () => true,
          captureReconcile: () => () => ({ status: "current", row }),
          dispose: disposeRow,
        };
      },
    },
  } as unknown as ApplicationContext;
  stop = startNativeSidebarPluginBridge(context);
  const snapshot = () => messages.filter((message) => message.type === "snapshot").at(-1)!;
  const command = (type = "run", extra: Record<string, unknown> = {}) => {
    const held = snapshot();
    response = createDeferred<WireMessage>();
    window.dispatchEvent(
      new CustomEvent("openclaw:native-sidebar-plugin-command", {
        detail: {
          contract: 1,
          documentId: held.documentId,
          requestId: crypto.randomUUID(),
          revision: held.revision,
          type,
          key: registration.key,
          actionId: "delete",
          ...extra,
        },
      }),
    );
    return response.promise;
  };
  return {
    run,
    openPage,
    abort,
    snapshot,
    command,
    listener: () => listener(),
    post,
    context,
    replace: () => {
      entries = [{ ...registration }];
    },
    reconnect: () => {
      revision++;
    },
    sessionRun,
    sessionResolve,
    disposeRow,
    updateRow: (id: string) => {
      row = { ...row, sessionId: id };
      rowListener();
    },
  };
}

describe("native sidebar plugin bridge", () => {
  it("projects optional navigation metadata and executes its registered action, not a guessed page", async () => {
    const test = fixture();
    expect(test.snapshot().entries).toEqual([
      expect.objectContaining({
        key: "example/board",
        defaultVisible: false,
        pageHref: "/boards",
        actions: [{ id: "delete", label: "Delete board", icon: "trash", destructive: true }],
      }),
    ]);
    expect(await test.command()).toMatchObject({ ok: true });
    expect(test.run).toHaveBeenCalledOnce();
    expect(test.openPage).not.toHaveBeenCalled();
    expect(await test.command("open")).toMatchObject({ ok: true });
    expect(test.openPage).toHaveBeenCalledWith({ id: "board" });
  });

  it.each(["replace", "reconnect", "abort", "revision"])(
    "rejects a held menu after %s",
    async (change) => {
      const test = fixture();
      const heldRevision = test.snapshot().revision;
      if (change === "replace") {
        test.replace();
      }
      if (change === "reconnect") {
        test.reconnect();
      }
      if (change === "abort") {
        test.abort.abort();
      }
      if (change === "revision") {
        test.listener();
      }
      expect(await test.command("run", { revision: heldRevision })).toMatchObject({ ok: false });
      expect(test.run).not.toHaveBeenCalled();
    },
  );

  it("does not acknowledge success after connection retirement during an action", async () => {
    const test = fixture();
    const action = createDeferred<void>();
    test.run.mockReturnValueOnce(action.promise);
    const result = test.command();
    test.reconnect();
    action.resolve();
    expect(await result).toMatchObject({
      ok: false,
      error: expect.stringContaining("connection changed"),
    });
  });

  it("resolves and runs session actions with the captured key and durable ID", async () => {
    const test = fixture("original");
    expect(test.snapshot().sessionActions).toEqual([
      { id: "example/session", label: "Inspect session", disabled: false },
    ]);
    expect(
      await test.command("session-run", { key: "agent:main:example", actionId: "example/session" }),
    ).toMatchObject({ ok: true });
    expect(test.sessionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:example",
        session: expect.objectContaining({ sessionId: "original" }),
        signal: expect.any(AbortSignal),
      }),
    );
    test.updateRow("replacement");
    expect(test.snapshot().sessionActions).toEqual([]);
    expect(
      await test.command("session-run", { key: "agent:main:example", actionId: "example/session" }),
    ).toMatchObject({ ok: false });
    expect(test.sessionRun).toHaveBeenCalledOnce();
  });

  it("rechecks session action availability at dispatch and retires its row observer", async () => {
    const test = fixture("original");
    test.sessionResolve.mockReturnValue({ disabled: true });
    expect(
      await test.command("session-run", { key: "agent:main:example", actionId: "example/session" }),
    ).toMatchObject({ ok: false });
    expect(test.sessionRun).not.toHaveBeenCalled();
    stop?.();
    stop = undefined;
    expect(test.disposeRow).toHaveBeenCalledOnce();
  });

  it("does not activate without the native embed marker", () => {
    const test = fixture();
    stop?.();
    stop = undefined;
    vi.stubGlobal("__OPENCLAW_NATIVE_EMBED__", undefined);
    expect(startNativeSidebarPluginBridge(test.context)).toBeUndefined();
  });
});
