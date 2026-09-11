// @vitest-environment node
// Pure geometry helpers for the composer resize grips: storage parsing and
// drag clamping. DOM application is covered by the browser demo recording.
import { describe, expect, it } from "vitest";
import {
  clampComposerColumnMaxPx,
  clampComposerHeightPx,
  COMPOSER_COLUMN_MIN_PX,
  COMPOSER_HEIGHT_MIN_PX,
  parseStoredPixels,
} from "./chat-composer-resize.ts";

describe("parseStoredPixels", () => {
  it("accepts positive pixel values", () => {
    expect(parseStoredPixels("240")).toBe(240);
    expect(parseStoredPixels("36.5")).toBe(36.5);
  });

  it("rejects empty, zero, negative, and non-numeric input", () => {
    expect(parseStoredPixels(null)).toBeNull();
    expect(parseStoredPixels("")).toBeNull();
    expect(parseStoredPixels("   ")).toBeNull();
    expect(parseStoredPixels("0")).toBeNull();
    expect(parseStoredPixels("-12")).toBeNull();
    expect(parseStoredPixels("tall")).toBeNull();
  });
});

describe("clampComposerHeightPx", () => {
  it("floors at the minimum usable editor height", () => {
    expect(clampComposerHeightPx(10, 900)).toBe(COMPOSER_HEIGHT_MIN_PX);
  });

  it("caps at eighty percent of the viewport", () => {
    expect(clampComposerHeightPx(9999, 900)).toBe(720);
  });

  it("passes through in-range values rounded to whole pixels", () => {
    expect(clampComposerHeightPx(240.4, 900)).toBe(240);
  });
});

describe("clampComposerColumnMaxPx", () => {
  it("floors at the minimum column width", () => {
    expect(clampComposerColumnMaxPx(100, 1440)).toBe(COMPOSER_COLUMN_MIN_PX);
  });

  it("caps near the viewport width so margins never vanish", () => {
    expect(clampComposerColumnMaxPx(9999, 1440)).toBe(1416);
  });

  it("passes through in-range values rounded to whole pixels", () => {
    expect(clampComposerColumnMaxPx(900.4, 1440)).toBe(900);
  });
});
