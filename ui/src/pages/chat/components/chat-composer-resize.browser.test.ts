import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { COMPOSER_HEIGHT_STORAGE_KEY } from "./chat-composer-resize-geometry.ts";
import { observeComposerResize, rebindComposerResizeInput } from "./chat-composer-resize.ts";

let shell: HTMLDivElement;
let input: HTMLDivElement;
afterEach(() => {
  rebindComposerResizeInput(input, null);
  shell.remove();
  vi.restoreAllMocks();
  localStorage.removeItem(COMPOSER_HEIGHT_STORAGE_KEY);
});

function mount(stored: boolean) {
  if (stored) {
    localStorage.setItem(COMPOSER_HEIGHT_STORAGE_KEY, "800");
  }
  shell = document.createElement("div");
  shell.className = "agent-chat__composer-shell";
  input = document.createElement("div");
  input.className = "agent-chat__input";
  const combo = document.createElement("div");
  combo.className = "agent-chat__composer-combobox";
  const textarea = document.createElement("textarea");
  textarea.style.cssText = "width: 600px; line-height: 20px; box-sizing: border-box";
  textarea.value = "Long draft line\n".repeat(100);
  combo.append(textarea);
  input.append(combo);
  shell.append(input);
  document.body.append(shell);
  observeComposerResize(input);
  return textarea;
}

describe("composer viewport height", () => {
  for (const stored of [false, true]) {
    it(`reclamps and restores a ${stored ? "restored" : "keyboard-selected"} height without rewriting storage`, async () => {
      await page.viewport(1440, 1000);
      const textarea = mount(stored);
      const grip = input.querySelector<HTMLElement>("[aria-orientation=horizontal]")!;
      if (!stored) {
        grip.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
      }
      await expect.poll(() => textarea.getBoundingClientRect().height).toBe(800);
      await page.viewport(1440, 600);
      await expect.poll(() => textarea.getBoundingClientRect().height).toBe(480);
      expect(grip.getAttribute("aria-valuenow")).toBe("480");
      expect(localStorage.getItem(COMPOSER_HEIGHT_STORAGE_KEY)).toBe("800");
      await page.viewport(1600, 1000);
      await expect.poll(() => textarea.getBoundingClientRect().height).toBe(800);
      expect(grip.getAttribute("aria-valuenow")).toBe("800");
      expect(localStorage.getItem(COMPOSER_HEIGHT_STORAGE_KEY)).toBe("800");
      grip.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      await page.viewport(1600, 600);
      expect(textarea.style.maxHeight).toBe("");
      expect(localStorage.getItem(COMPOSER_HEIGHT_STORAGE_KEY)).toBeNull();
    });
  }
});

it("retains an in-memory preference when storage is denied", async () => {
  await page.viewport(1440, 1000);
  const textarea = mount(false);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage denied");
  });
  input
    .querySelector<HTMLElement>("[aria-orientation=horizontal]")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
  await page.viewport(1440, 600);
  await expect.poll(() => textarea.getBoundingClientRect().height).toBe(480);
  await page.viewport(1440, 1000);
  await expect.poll(() => textarea.getBoundingClientRect().height).toBe(800);
});

it("reclamps cancellation after the viewport changes during a drag", async () => {
  await page.viewport(1440, 1000);
  const textarea = mount(true);
  const grip = input.querySelector<HTMLElement>("[aria-orientation=horizontal]")!;
  // Synthetic pointer events have no active pointer; stub capture, not sizing.
  vi.spyOn(grip, "setPointerCapture").mockImplementation(() => {});
  grip.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientY: 100 }));
  await page.viewport(1440, 600);
  await expect.poll(() => textarea.getBoundingClientRect().height).toBe(480);
  grip.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));
  expect(textarea.getBoundingClientRect().height).toBe(480);
  expect(localStorage.getItem(COMPOSER_HEIGHT_STORAGE_KEY)).toBe("800");
  await page.viewport(1440, 1000);
  await expect.poll(() => textarea.getBoundingClientRect().height).toBe(800);
});
