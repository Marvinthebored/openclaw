import { CHAT_TRANSCRIPT_END_THRESHOLD_PX } from "../scroll.ts";
import { maxTranscriptScrollOffset } from "./chat-transcript-geometry.ts";
import { publishTranscriptScroll } from "./chat-transcript-scroll-events.ts";

type EndAnchorOwner = {
  element(): HTMLDivElement | null;
  canFollow(): boolean;
  suspended(): boolean;
  follow(): void;
  resumeFollow(): void;
};

/** Geometric end anchoring; the pane still owns permission to follow. */
export class TranscriptEndAnchor {
  constructor(private readonly owner: EndAnchorOwner) {}

  private frame: number | null = null;
  private offset: number | null = null;

  // Nested Lit children can resize after the pane commit. This owner coalesces
  // its end reconciliation and retires it with the transcript lifecycle.
  schedule(reconcile: () => void): void {
    if (this.frame !== null) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      reconcile();
    });
  }

  cancelScheduled(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
    }
    this.frame = null;
  }
  private maxOffset: number | null = null;
  private lastOffset: number | null = null;
  private composerResizePending: { preserveEnd: boolean } | null = null;

  invalidateComposerResize(canFollow: boolean): void {
    this.composerResizePending ??= {
      preserveEnd:
        canFollow &&
        this.maxOffset !== null &&
        this.lastOffset !== null &&
        this.maxOffset - this.lastOffset <= CHAT_TRANSCRIPT_END_THRESHOLD_PX,
    };
  }

  commitComposerResize(changed: boolean) {
    const element = this.owner.element();
    const canFollow = this.owner.canFollow();
    if (!this.composerResizePending) {
      return null;
    }
    if (!changed || this.owner.suspended()) {
      // At the height cap, native caret scrolling can move the transcript
      // after overflow settles without producing a viewport ResizeObserver.
      return null;
    }
    const { preserveEnd } = this.composerResizePending;
    this.composerResizePending = null;
    const previousMax = this.maxOffset;
    const previousOffset = this.lastOffset;
    const max = maxTranscriptScrollOffset(element);
    if (!element || max === null) {
      return null;
    }
    const before = element.scrollTop;
    // Use the last committed geometry, not the already-grown scrollport. A
    // native return to its old end can precede the offset observer in this frame.
    const atPreviousEnd =
      previousMax !== null &&
      Math.abs(before - Math.min(previousMax, max)) <= CHAT_TRANSCRIPT_END_THRESHOLD_PX;
    // A shrink can clamp a reader to the end without permission to follow.
    // Only fresh movement toward the old end can supersede that reader policy.
    const resumeFollow =
      !canFollow && atPreviousEnd && this.lastOffset !== null && before > this.lastOffset;
    if (preserveEnd || (atPreviousEnd && (canFollow || resumeFollow))) {
      element.scrollTop = max;
    }
    this.maxOffset = max;
    this.lastOffset = element.scrollTop;
    // Native layout can already have clamped the old end before observers run.
    // Publish that real displacement before a following goal/header commit
    // hides the intermediate viewport; otherwise its late scroll looks manual.
    const beforeResize =
      preserveEnd && previousOffset !== null && previousOffset > max && before === max
        ? previousOffset
        : before;
    const correction = { before: beforeResize, after: element.scrollTop, resumeFollow };
    publishTranscriptScroll(element, {
      type: "resize",
      ...(correction.before !== correction.after
        ? { scrollCorrection: { before: correction.before, after: correction.after } }
        : {}),
    });
    if (resumeFollow) {
      this.owner.resumeFollow();
    }
    return correction;
  }

  cancelComposerResize(): void {
    this.composerResizePending = null;
  }

  clear(): void {
    this.cancelComposerResize();
    this.offset = null;
  }

  capture(): void {
    const element = this.owner.element();
    const max = maxTranscriptScrollOffset(element);
    this.maxOffset = max;
    this.lastOffset = element?.scrollTop ?? null;
    this.offset = element && max !== null && Math.abs(max - element.scrollTop) <= 1 ? max : null;
  }

  reconcile(): void {
    const element = this.owner.element();
    const max = maxTranscriptScrollOffset(element);
    this.maxOffset = max;
    this.lastOffset = element?.scrollTop ?? null;
    // A resized viewport can clamp a reader to the end without granting follow.
    if (!this.owner.canFollow()) {
      this.clear();
      return;
    }
    if (this.owner.suspended()) {
      return;
    }
    if (!element || max === null) {
      return;
    }
    if (Math.abs(max - element.scrollTop) <= 1) {
      this.offset = max;
      return;
    }
    if (this.offset === null) {
      return;
    }
    if (Math.abs(element.scrollTop - this.offset) > 1) {
      this.clear();
      return;
    }
    // Row measurement moved the end while the reader still rests at its old edge.
    this.owner.follow();
  }
}
