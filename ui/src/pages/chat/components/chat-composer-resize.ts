import { loadSettings, patchSettings } from "../../../app/settings.ts";
import { t } from "../../../i18n/index.ts";
import { adjustTextareaHeight } from "./chat-composer-dom.ts";
import {
  clampComposerColumnMaxPx,
  clampComposerHeightPx,
  COMPOSER_COLUMN_MIN_PX,
  COMPOSER_HEIGHT_MIN_PX,
  COMPOSER_HEIGHT_STORAGE_KEY,
  parseStoredPixels,
} from "./chat-composer-resize-geometry.ts";

// Drag handles on the composer input: a top grip grows the editor past its
// six-line CSS cap (persisted in localStorage), a hover-revealed left grip
// widens the whole chat column through the existing Message width setting
// (Settings → Appearance → Chat → Message width, `chatMessageMaxWidth`).
// The grip never owns width itself: drags preview via the same
// --chat-thread-max-width token the chat view renders, and commits call
// patchSettings so the Settings page stays the single owner. Double-click
// either grip to return it to the default.

const TOP_HANDLE_CLASS = "agent-chat__composer-resize-top";
const SIDE_HANDLE_CLASS = "agent-chat__composer-resize-side";
const DRAGGING_CLASS = "agent-chat__composer-resizing";

/** Width commit as a Message width setting value (`"900px"`), or undefined
    on double-click reset. Hosts forward it to settings; the chat host uses
    applySettings so its snapshot refreshes with it. */
export type ComposerWidthCommit = (value: string | undefined) => void;

type ComposerResizeOptions = {
  // Host commit for width drags. The chat host persists through settings,
  // refreshes its snapshot, and invalidates so the view's styleMap takes
  // over; hosts without one (new-session page) use the default, which
  // persists through settings with no live view to refresh.
  onWidthCommit?: ComposerWidthCommit;
};

type ComposerResizeState = {
  topHandle: HTMLElement;
  sideHandle: HTMLElement;
  abort: AbortController;
  onWidthCommit: ComposerWidthCommit;
};

const composerResizeStates = new WeakMap<HTMLElement, ComposerResizeState>();

function defaultWidthCommit(value: string | undefined): void {
  patchSettings({ chatMessageMaxWidth: value });
}

function readStoredHeightPx(): number | null {
  try {
    return parseStoredPixels(window.localStorage.getItem(COMPOSER_HEIGHT_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStoredHeightPx(px: number | null): void {
  try {
    if (px === null) {
      window.localStorage.removeItem(COMPOSER_HEIGHT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(COMPOSER_HEIGHT_STORAGE_KEY, String(px));
    }
  } catch {
    // Private mode or denied storage: the drag still applies for this session.
  }
}

function findTextarea(input: HTMLElement): HTMLTextAreaElement | null {
  return input.querySelector<HTMLTextAreaElement>(".agent-chat__composer-combobox > textarea");
}

function findColumnRoot(input: HTMLElement): HTMLElement {
  // --chat-thread-max-width caps both the transcript (.chat-thread-inner) and
  // the composer shell, so one token widens the whole centred column. The
  // chat view renders this token from settings via styleMap; the grip only
  // previews through it mid-drag. Fall back to the shell, then the input.
  return (
    input.closest<HTMLElement>(".card.chat") ??
    input.closest<HTMLElement>(".chat") ??
    input.closest<HTMLElement>(".agent-chat__composer-shell") ??
    input
  );
}

function currentColumnMaxPx(root: HTMLElement, input: HTMLElement): number {
  // Custom properties stay author-unit in computed style, so the default
  // "48rem" (and any Settings-authored rem/% value) never matches a px
  // regex. When no explicit px token exists, measure the composer shell:
  // it already reflects min(available, token), while the root card spans
  // the full chat width and would make the first drag jump. The first drag
  // from a non-px value commits it as px; reset returns to default.
  const computed = getComputedStyle(root).getPropertyValue("--chat-thread-max-width").trim();
  const match = /^(\d+(?:\.\d+)?)px$/u.exec(computed);
  if (match) {
    return Number(match[1]);
  }
  const shell = input.closest<HTMLElement>(".agent-chat__composer-shell") ?? input;
  return Math.max(Math.round(shell.getBoundingClientRect().width), COMPOSER_COLUMN_MIN_PX);
}

function applyColumnPreview(root: HTMLElement, value: string | null): void {
  if (value === null) {
    root.style.removeProperty("--chat-thread-max-width");
  } else {
    root.style.setProperty("--chat-thread-max-width", value);
  }
}

function applyHeightOverride(textarea: HTMLTextAreaElement, px: number | null): void {
  if (px === null) {
    textarea.style.maxHeight = "";
  } else {
    textarea.style.maxHeight = `${clampComposerHeightPx(px, window.innerHeight)}px`;
  }
  adjustTextareaHeight(textarea);
}

function currentTextareaMaxPx(textarea: HTMLTextAreaElement): number {
  const computed = getComputedStyle(textarea).maxHeight.trim();
  const match = /^(\d+(?:\.\d+)?)px$/u.exec(computed);
  if (match) {
    return Number(match[1]);
  }
  return textarea.scrollHeight || COMPOSER_HEIGHT_MIN_PX;
}

function startDrag(
  handle: HTMLElement,
  event: PointerEvent,
  onMove: (dx: number, dy: number) => void,
  onEnd: () => void,
): void {
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  handle.setPointerCapture(event.pointerId);
  const input = handle.closest<HTMLElement>(".agent-chat__input");
  input?.classList.add(DRAGGING_CLASS);
  const move = (moveEvent: PointerEvent) => {
    onMove(moveEvent.clientX - startX, moveEvent.clientY - startY);
  };
  const end = (endEvent: PointerEvent) => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointercancel", end);
    if (handle.hasPointerCapture(endEvent.pointerId)) {
      handle.releasePointerCapture(endEvent.pointerId);
    }
    input?.classList.remove(DRAGGING_CLASS);
    onEnd();
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end, { once: true });
  handle.addEventListener("pointercancel", end);
}

function makeHandle(className: string, orientation: "horizontal" | "vertical"): HTMLElement {
  const handle = document.createElement("div");
  handle.className = className;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", orientation);
  handle.dataset.composerResizeHandle = className;
  return handle;
}

function labelHandles(state: ComposerResizeState): void {
  const heightLabel = t("chat.composer.resizeInputHeight");
  const widthLabel = t("chat.composer.resizeInputWidth");
  for (const [handle, label] of [
    [state.topHandle, heightLabel],
    [state.sideHandle, widthLabel],
  ] as const) {
    handle.setAttribute("aria-label", label);
    handle.title = label;
  }
}

function disconnectComposerResize(input: HTMLElement): void {
  const state = composerResizeStates.get(input);
  composerResizeStates.delete(input);
  if (!state) {
    return;
  }
  state.abort.abort();
  state.topHandle.remove();
  state.sideHandle.remove();
}

export function observeComposerResize(input: HTMLElement, options?: ComposerResizeOptions): void {
  const onWidthCommit = options?.onWidthCommit ?? defaultWidthCommit;
  const existing = composerResizeStates.get(input);
  if (existing) {
    // Host callbacks close over live state; keep the newest one.
    existing.onWidthCommit = onWidthCommit;
    labelHandles(existing);
    return;
  }
  const topHandle = makeHandle(TOP_HANDLE_CLASS, "horizontal");
  const sideHandle = makeHandle(SIDE_HANDLE_CLASS, "vertical");
  const abort = new AbortController();
  const state: ComposerResizeState = { topHandle, sideHandle, abort, onWidthCommit };
  labelHandles(state);

  topHandle.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) {
        return;
      }
      const textarea = findTextarea(input);
      if (!textarea) {
        return;
      }
      const startMax = currentTextareaMaxPx(textarea);
      startDrag(
        topHandle,
        event,
        (_dx, dy) => {
          applyHeightOverride(textarea, startMax - dy);
        },
        () => {
          writeStoredHeightPx(currentTextareaMaxPx(textarea));
        },
      );
    },
    { signal: abort.signal },
  );
  topHandle.addEventListener(
    "dblclick",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      writeStoredHeightPx(null);
      const textarea = findTextarea(input);
      if (textarea) {
        applyHeightOverride(textarea, null);
      }
    },
    { signal: abort.signal },
  );

  sideHandle.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) {
        return;
      }
      const root = findColumnRoot(input);
      // Dragging left (negative dx) widens the column; dragging right narrows.
      const startMax = currentColumnMaxPx(root, input);
      let committed = `${startMax}px`;
      startDrag(
        sideHandle,
        event,
        (dx) => {
          committed = `${clampComposerColumnMaxPx(startMax - dx, window.innerWidth)}px`;
          applyColumnPreview(root, committed);
        },
        () => {
          // Preview already shows the committed value, so the host's
          // styleMap render lands with no visible jump.
          composerResizeStates.get(input)?.onWidthCommit(committed);
        },
      );
    },
    { signal: abort.signal },
  );
  sideHandle.addEventListener(
    "dblclick",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Removing the preview IS the reset visual; the host clears the
      // setting so its next render omits the token (default width).
      applyColumnPreview(findColumnRoot(input), null);
      composerResizeStates.get(input)?.onWidthCommit(undefined);
    },
    { signal: abort.signal },
  );

  input.prepend(topHandle);
  input.prepend(sideHandle);

  // Hosts that own width rendering (chat view styleMap) need no mount-time
  // application: restoring here would run from the input ref before the
  // element is attached to its .chat ancestor. Hosts without one
  // (new-session page) read the single owned setting so the box reflects it.
  if (!options?.onWidthCommit) {
    const owned = loadSettings().chatMessageMaxWidth;
    if (owned) {
      findColumnRoot(input).style.setProperty("--chat-thread-max-width", owned);
    }
  }
  const textarea = findTextarea(input);
  if (textarea) {
    const stored = readStoredHeightPx();
    if (stored !== null) {
      applyHeightOverride(textarea, stored);
    }
  }

  composerResizeStates.set(input, state);
}

export function rebindComposerResizeInput(
  prev: HTMLElement | null,
  next: HTMLElement | null,
  options?: ComposerResizeOptions,
): void {
  if (prev !== next) {
    if (prev) {
      disconnectComposerResize(prev);
    }
    if (next) {
      observeComposerResize(next, options);
    }
    return;
  }
  if (next) {
    observeComposerResize(next, options);
  }
}

export function restoreComposerHeightOverride(textarea: HTMLTextAreaElement): void {
  // Called from each composer's textarea ref, which runs in the same commit as
  // the input ref: whichever mounts second still picks up the stored height.
  const stored = readStoredHeightPx();
  if (stored !== null) {
    applyHeightOverride(textarea, stored);
  }
}
