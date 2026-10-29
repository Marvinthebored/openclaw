import { scheduleTextareaHeightAdjustment } from "./chat-composer-dom.ts";

export type ComposerLayoutOptions = {
  getEditor: () => HTMLTextAreaElement | null;
  getContext?: () => HTMLElement | undefined;
};

/** Read settled geometry; the shared layout scheduler commits the returned write. */
export function measureComposerLayout(
  input: HTMLElement,
  options: ComposerLayoutOptions,
): (() => void) | void {
  const editor = options.getEditor();
  if (
    !input.isConnected ||
    !editor ||
    !input.closest(".chat-footer, .new-session-page__scroll") ||
    !input.closest(".chat, .new-session-page")
  ) {
    return;
  }
  const shell = input.closest<HTMLElement>(".agent-chat__composer-shell")!;
  const footer = input.closest<HTMLElement>(".chat-footer");
  const shellStyle = getComputedStyle(shell);
  const margins =
    Number.parseFloat(shellStyle.marginTop) + Number.parseFloat(shellStyle.marginBottom);
  const contextHeight = options.getContext?.()?.scrollHeight ?? 0;
  const contextGap = contextHeight > 0 ? Number.parseFloat(shellStyle.rowGap) || 0 : 0;
  // Measure flow chrome explicitly: a capped scrollport can omit its
  // margins and a flex-shrunk context hides its natural content height.
  const chrome =
    Math.max(0, input.offsetHeight - editor.offsetHeight) +
    (footer
      ? margins + Math.max(contextHeight + contextGap, shell.scrollHeight - input.offsetHeight)
      : 0);
  const scroll = shell.closest<HTMLElement>(".new-session-page__scroll");
  // Undo page scrolling so scrolling the welcome pane cannot grow its
  // editor and move the scroll boundary again. Both rects are viewport-relative.
  const budget = footer
    ? Number.parseFloat(getComputedStyle(footer).maxHeight)
    : Math.min(
        window.visualViewport?.height ?? window.innerHeight,
        scroll?.getBoundingClientRect().bottom ?? Infinity,
      ) -
      shell.getBoundingClientRect().top -
      (scroll?.scrollTop ?? 0) -
      margins;
  if (Number.isFinite(budget)) {
    // CSS owns the line cap; measurement only constrains it to short panes.
    const limit = `${Math.max(36, budget - chrome)}px`;
    if (input.style.getPropertyValue("--chat-composer-editor-height-limit") !== limit) {
      return () => {
        input.style.setProperty("--chat-composer-editor-height-limit", limit);
        scheduleTextareaHeightAdjustment(editor);
      };
    }
  }
}

export function composerLayoutTargets(
  input: HTMLElement | undefined,
  shell: HTMLElement | undefined,
  options: ComposerLayoutOptions | undefined,
): Element[] {
  // A Solid mount wraps the shell in a boxless display: contents host.
  let region = shell?.parentElement;
  while (region?.parentElement && getComputedStyle(region).display === "contents") {
    region = region.parentElement;
  }
  return [
    shell,
    input?.closest(".chat, .new-session-page"),
    input,
    options?.getEditor(),
    options?.getContext?.(),
    input?.closest(".chat-footer"),
    region,
    shell?.closest(".agent-chat__welcome"),
    shell?.closest(".new-session-page__scroll"),
  ].filter((node): node is Element => Boolean(node));
}
