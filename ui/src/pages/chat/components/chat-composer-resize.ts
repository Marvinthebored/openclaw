import { t } from "../../../i18n/index.ts";
import { adjustTextareaHeight } from "./chat-composer-dom.ts";

// Drag handles on the composer input: a top grip grows the editor past its
// six-line CSS cap, a hover-revealed left grip widens the whole chat column
// (transcript plus composer) by raising the shared --chat-thread-max-width
// token. Both persist in localStorage; double-click either grip to return it
// to the default.

export const COMPOSER_HEIGHT_STORAGE_KEY = "openclaw.chat.composer.maxHeightPx";
export const COMPOSER_COLUMN_STORAGE_KEY = "openclaw.chat.thread.maxWidthPx";

export const COMPOSER_COLUMN_MIN_PX = 480;
export const COMPOSER_COLUMN_VIEWPORT_MARGIN_PX = 24;
export const COMPOSER_HEIGHT_MIN_PX = 96;
export const COMPOSER_HEIGHT_MAX_VIEWPORT_RATIO = 0.8;

const TOP_HANDLE_CLASS = "agent-chat__composer-resize-top";
const SIDE_HANDLE_CLASS = "agent-chat__composer-resize-side";
const DRAGGING_CLASS = "agent-chat__composer-resizing";

type ComposerResizeState = {
  topHandle: HTMLElement;
  sideHandle: HTMLElement;
  abort: AbortController;
};

const composerResizeStates = new WeakMap<HTMLElement, ComposerResizeState>();

export function parseStoredPixels(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function clampComposerHeightPx(px: number, viewportHeight: number): number {
  const max = Math.max(
    COMPOSER_HEIGHT_MIN_PX,
    Math.floor(viewportHeight * COMPOSER_HEIGHT_MAX_VIEWPORT_RATIO),
  );
  return Math.min(Math.max(Math.round(px), COMPOSER_HEIGHT_MIN_PX), max);
}

export function clampComposerColumnMaxPx(px: number, viewportWidth: number): number {
  const max = Math.max(COMPOSER_COLUMN_MIN_PX, viewportWidth - COMPOSER_COLUMN_VIEWPORT_MARGIN_PX);
  return Math.min(Math.max(Math.round(px), COMPOSER_COLUMN_MIN_PX), max);
}

function readStoredPixels(key: string): number | null {
  try {
    return parseStoredPixels(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeStoredPixels(key: string, px: number | null): void {
  try {
    if (px === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, String(px));
    }
  } catch {
    // Private mode or denied storage: the drag still applies for this session.
  }
}

function findTextarea(input: HTMLElement): HTMLTextAreaElement | null {
  return input.querySelector<HTMLTextAreaElement>(".agent-chat__composer-combobox > textarea");
}

function findColumnRoot(input: HTMLElement): HTMLElement {
  // --chat-thread-max-width is declared on .chat and caps both the transcript
  // (.chat-thread-inner) and the composer shell, so one token widens the
  // whole centred column. Fall back to the shell, then the input itself.
  return (
    input.closest<HTMLElement>(".chat") ??
    input.closest<HTMLElement>(".agent-chat__composer-shell") ??
    input
  );
}

export function readComposerColumnMaxPx(root: HTMLElement): number | null {
  const read = (value: string): number | null => {
    const px = /^(\d+(?:\.\d+)?)px$/u.exec(value.trim());
    if (px) {
      return Number(px[1]);
    }
    const rem = /^(\d+(?:\.\d+)?)rem$/u.exec(value.trim());
    if (rem) {
      return Number(rem[1]) * 16;
    }
    return null;
  };
  return (
    read(root.style.getPropertyValue("--chat-thread-max-width")) ??
    read(getComputedStyle(root).getPropertyValue("--chat-thread-max-width"))
  );
}

export function applyComposerHeightOverride(
  textarea: HTMLTextAreaElement,
  px: number | null,
): void {
  if (px === null) {
    textarea.style.maxHeight = "";
  } else {
    textarea.style.maxHeight = `${clampComposerHeightPx(px, window.innerHeight)}px`;
  }
  adjustTextareaHeight(textarea);
}

export function applyComposerColumnMax(root: HTMLElement, px: number | null): void {
  if (px === null) {
    root.style.removeProperty("--chat-thread-max-width");
  } else {
    root.style.setProperty(
      "--chat-thread-max-width",
      `${clampComposerColumnMaxPx(px, window.innerWidth)}px`,
    );
  }
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

export function observeComposerResize(input: HTMLElement): void {
  const existing = composerResizeStates.get(input);
  if (existing) {
    labelHandles(existing);
    return;
  }
  const topHandle = makeHandle(TOP_HANDLE_CLASS, "horizontal");
  const sideHandle = makeHandle(SIDE_HANDLE_CLASS, "vertical");
  const abort = new AbortController();
  const state: ComposerResizeState = { topHandle, sideHandle, abort };
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
          applyComposerHeightOverride(textarea, startMax - dy);
        },
        () => {
          writeStoredPixels(COMPOSER_HEIGHT_STORAGE_KEY, currentTextareaMaxPx(textarea));
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
      writeStoredPixels(COMPOSER_HEIGHT_STORAGE_KEY, null);
      const textarea = findTextarea(input);
      if (textarea) {
        applyComposerHeightOverride(textarea, null);
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
      const startMax = readComposerColumnMaxPx(root) ?? root.getBoundingClientRect().width;
      startDrag(
        sideHandle,
        event,
        (dx) => {
          applyComposerColumnMax(root, startMax - dx);
        },
        () => {
          writeStoredPixels(COMPOSER_COLUMN_STORAGE_KEY, readComposerColumnMaxPx(root));
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
      writeStoredPixels(COMPOSER_COLUMN_STORAGE_KEY, null);
      applyComposerColumnMax(findColumnRoot(input), null);
    },
    { signal: abort.signal },
  );

  input.prepend(topHandle);
  input.prepend(sideHandle);

  // Restore the operator's persisted geometry. Height applies to the live
  // textarea when one is already mounted; the textarea ref path in each
  // composer host covers the mount that follows this observer.
  applyComposerColumnMax(findColumnRoot(input), readStoredPixels(COMPOSER_COLUMN_STORAGE_KEY));
  const textarea = findTextarea(input);
  if (textarea) {
    applyComposerHeightOverride(textarea, readStoredPixels(COMPOSER_HEIGHT_STORAGE_KEY));
  }

  composerResizeStates.set(input, state);
}

export function rebindComposerResizeInput(
  prev: HTMLElement | null,
  next: HTMLElement | null,
): void {
  if (prev === next) {
    return;
  }
  if (prev) {
    disconnectComposerResize(prev);
  }
  if (next) {
    observeComposerResize(next);
  }
}

export function disconnectComposerResize(input: HTMLElement): void {
  const state = composerResizeStates.get(input);
  composerResizeStates.delete(input);
  if (!state) {
    return;
  }
  state.abort.abort();
  state.topHandle.remove();
  state.sideHandle.remove();
}

export function restoreComposerHeightOverride(textarea: HTMLTextAreaElement): void {
  // Called from each composer's textarea ref, which runs in the same commit as
  // the input ref: whichever mounts second still picks up the stored height.
  const stored = readStoredPixels(COMPOSER_HEIGHT_STORAGE_KEY);
  if (stored !== null) {
    applyComposerHeightOverride(textarea, stored);
  }
}
