/* @vitest-environment jsdom */

import { html, render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetChatViewState } from "./chat-view-state.ts";
import {
  getComposerTextarea,
  renderChatView,
  stubAnimationFrames,
} from "./chat-view.test-helpers.ts";
import {
  installTranscriptDomMocks,
  resetTranscriptTestDom,
} from "./components/chat-transcript.test-support.ts";

beforeEach(installTranscriptDomMocks);
afterEach(() => {
  resetChatViewState();
  resetTranscriptTestDom();
});

describe("chat composer sizing", () => {
  beforeEach(() => vi.spyOn(CSS, "supports").mockReturnValue(false));

  it("settles native overflow without synchronous input layout reads", async () => {
    const flushFrames = stubAnimationFrames();
    vi.mocked(CSS.supports).mockReturnValue(true);
    const container = renderChatView({});
    const textarea = getComposerTextarea(container);
    const thread = container.querySelector<HTMLElement>(".chat-thread")!;
    document.body.append(container);
    await Promise.resolve();
    flushFrames();
    let scrollHeight = 200;
    Object.defineProperty(textarea, "clientHeight", { configurable: true, value: 150 });
    let textareaLayoutReads = 0;
    let transcriptLayoutReads = 0;
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => {
        textareaLayoutReads += 1;
        return scrollHeight;
      },
    });
    Object.defineProperty(thread, "scrollHeight", {
      configurable: true,
      get: () => {
        transcriptLayoutReads += 1;
        return 200;
      },
    });
    textarea.style.height = "42px";

    textarea.value = "responsive draft";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect({ textareaLayoutReads, transcriptLayoutReads }).toEqual({
      textareaLayoutReads: 0,
      transcriptLayoutReads: 0,
    });
    expect(textarea.style.height).toBe("");
    flushFrames();
    expect(textarea.style.overflowY).toBe("auto");

    scrollHeight = 42;
    Object.defineProperty(textarea, "clientHeight", { configurable: true, value: 42 });
    textarea.value = "Short draft";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    flushFrames();
    expect(textarea.style.overflowY).toBe("hidden");
    expect(textarea.hasAttribute("data-scroll-fade-bottom")).toBe(false);
    render(html``, container);
    container.remove();
  });

  it("sizes restored drafts after the rendered value is committed", async () => {
    const container = renderChatView({ draft: "A restored long draft" });
    const textarea = getComposerTextarea(container);
    Object.defineProperties(textarea, {
      scrollHeight: { configurable: true, value: 180 },
      clientHeight: { configurable: true, value: 150 },
    });
    document.body.append(container);

    await Promise.resolve();

    expect(textarea.style.height).toBe("150px");
    expect(textarea.style.overflowY).toBe("auto");
    container.remove();
  });

  it("shows the textarea scrollbar only when the draft overflows", () => {
    const container = renderChatView({});
    const textarea = getComposerTextarea(container);
    let scrollHeight = 42;
    let clientHeight = 42;
    Object.defineProperties(textarea, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, get: () => clientHeight },
    });

    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(textarea.style.height).toBe("42px");
    expect(textarea.style.overflowY).toBe("hidden");

    scrollHeight = 180;
    clientHeight = 150;
    textarea.value = "A long draft";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(textarea.style.height).toBe("150px");
    expect(textarea.style.overflowY).toBe("auto");
  });

  it("resizes the draft when responsive layout changes the textarea width", () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    let animationFrameCallback: FrameRequestCallback | undefined;
    let nextAnimationFrameId = 0;
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      animationFrameCallback = callback;
      nextAnimationFrameId += 1;
      return nextAnimationFrameId;
    });
    const cancelAnimationFrameMock = vi.fn();
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): ResizeObserverEntry[] {
        return [];
      }
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);

    let width = 320;
    let scrollHeight = 42;
    let clientHeight = 42;
    vi.spyOn(HTMLTextAreaElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
      bottom: clientHeight,
      height: clientHeight,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));

    const container = renderChatView({});
    const textarea = getComposerTextarea(container);
    Object.defineProperties(textarea, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, get: () => clientHeight },
    });
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(textarea.style.height).toBe("42px");
    expect(textarea.style.overflowY).toBe("hidden");

    scrollHeight = 180;
    clientHeight = 150;
    resizeCallback?.([], {} as ResizeObserver);
    expect(textarea.style.overflowY).toBe("auto");
    expect(requestAnimationFrameMock).not.toHaveBeenCalled();

    width = 180;
    scrollHeight = 120;
    clientHeight = 120;
    resizeCallback?.([], {} as ResizeObserver);
    expect(requestAnimationFrameMock).toHaveBeenCalledOnce();
    expect(textarea.style.height).toBe("42px");

    animationFrameCallback?.(0);
    expect(textarea.style.height).toBe("120px");
    expect(textarea.style.overflowY).toBe("hidden");

    width = 160;
    resizeCallback?.([], {} as ResizeObserver);
    render(html``, container);
    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(2);
  });
});
