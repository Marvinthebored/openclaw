import { listen } from "../../../lib/reactive/listener.ts";
import { scheduleTextareaHeightAdjustment } from "./chat-composer-dom.ts";

export type ComposerLayoutOptions = {
  getEditor: () => HTMLTextAreaElement | null;
  getContext?: () => HTMLElement | undefined;
};

// One lifecycle for both surfaces. No input listener, draft clone, or height
// preference: native field-sizing owns edits; only settled geometry is read.
export class ComposerLayout {
  private element: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private events: AbortController | null = null;
  private options: ComposerLayoutOptions = { getEditor: () => null };
  private measurementFrame: number | null = null;
  private active = false;
  private measure: (() => void) | null = null;

  update(element: HTMLElement, options: ComposerLayoutOptions) {
    if (this.events && this.element !== element) {
      this.disconnect();
    }
    this.options = options;
    this.element = element;
    this.active = true;
    // Hosts bind before their children/ancestors are attached.
    queueMicrotask(() => {
      if (this.active && this.element?.isConnected) {
        this.attach();
      }
    });
  }

  private attach() {
    const input = this.element!;
    if (this.events) {
      this.measure?.();
      return;
    }
    const pane = input.closest<HTMLElement>(".chat-footer, .new-session-page__scroll");
    if (!pane) {
      return;
    }
    this.root = input.closest<HTMLElement>(".chat, .new-session-page");
    const root = this.root;
    const findEditor = () => this.options.getEditor();
    const mounted = findEditor();
    if (!root || !mounted) {
      return;
    }
    let editor = mounted;
    this.events = new AbortController();
    const shell = input.closest<HTMLElement>(".agent-chat__composer-shell")!;
    const measure = () => {
      const current = findEditor();
      if (!input.isConnected || !current) {
        return;
      }
      if (current !== editor) {
        // A new draft scope mounts a new textarea inside the same surface.
        editor = current;
      }
      const footer = input.closest<HTMLElement>(".chat-footer");
      const shellStyle = getComputedStyle(shell);
      const margins =
        Number.parseFloat(shellStyle.marginTop) + Number.parseFloat(shellStyle.marginBottom);
      const contextHeight = this.options.getContext?.()?.scrollHeight ?? 0;
      const contextGap = contextHeight > 0 ? Number.parseFloat(shellStyle.rowGap) || 0 : 0;
      // Measure flow chrome explicitly: a capped scrollport can omit its
      // margins and a flex-shrunk context hides its natural content height.
      const chrome =
        Math.max(0, input.offsetHeight - editor.offsetHeight) +
        (footer
          ? margins + Math.max(contextHeight + contextGap, shell.scrollHeight - input.offsetHeight)
          : 0);
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const scroll = shell.closest<HTMLElement>(".new-session-page__scroll");
      const paneBottom = Math.min(
        viewportHeight,
        scroll?.getBoundingClientRect().bottom ?? viewportHeight,
      );
      // Undo page scrolling so scrolling the welcome pane cannot grow its
      // editor and move the scroll boundary again. Both rects are viewport-relative.
      const budget = footer
        ? Number.parseFloat(getComputedStyle(footer).maxHeight)
        : paneBottom - shell.getBoundingClientRect().top - (scroll?.scrollTop ?? 0) - margins;
      if (Number.isFinite(budget)) {
        // CSS owns the line cap; measurement only constrains it to short panes.
        const limit = `${Math.max(36, budget - chrome)}px`;
        if (input.style.getPropertyValue("--chat-composer-editor-height-limit") !== limit) {
          input.style.setProperty("--chat-composer-editor-height-limit", limit);
          scheduleTextareaHeightAdjustment(editor);
        }
      }
    };
    const scheduleMeasure = () => {
      if (this.measurementFrame !== null) {
        return;
      }
      this.measurementFrame = requestAnimationFrame(() => {
        this.measurementFrame = null;
        if (this.events && input.isConnected) {
          measure();
        }
      });
    };
    this.measure = measure;
    const eventOptions = { signal: this.events.signal };
    listen(window, "resize", scheduleMeasure, eventOptions);
    if (window.visualViewport) {
      listen(window.visualViewport, "resize", scheduleMeasure, eventOptions);
    }
    measure();
  }

  targets(): Element[] {
    const input = this.element;
    const shell = input?.closest<HTMLElement>(".agent-chat__composer-shell");
    return [
      this.root,
      input,
      this.options.getEditor(),
      this.options.getContext?.(),
      input?.closest(".chat-footer"),
      shell && this.region(shell),
      shell?.closest(".agent-chat__welcome"),
      shell?.closest(".new-session-page__scroll"),
    ].filter((node): node is HTMLElement => Boolean(node));
  }

  // A Solid mount wraps the shell in a boxless `display: contents` host.
  private region(shell: HTMLElement) {
    let region = shell.parentElement!;
    while (region.parentElement && getComputedStyle(region).display === "contents") {
      region = region.parentElement;
    }
    return region;
  }

  disconnect() {
    this.active = false;
    this.events?.abort();
    this.events = null;
    this.measure = null;
    if (this.measurementFrame !== null) {
      cancelAnimationFrame(this.measurementFrame);
    }
    this.measurementFrame = null;
    this.element?.style.removeProperty("--chat-composer-editor-height-limit");
  }
}
