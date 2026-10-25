# Composer shrink proof

Before: stock regression fixture after shrinking the viewport, with the end caret below the visible draft. After: rebuilt Chat preview after the same 900-to-600px height change, with the final draft line visible. Both screenshots use synthetic Line N content and are cropped to the composer; themes and fixture chrome differ.

Three original window-shrink regression cases fail before the shrink fix and pass afterward. Two additional wrapped-caret and compact-mode regression cases fail before their corrections and pass afterward. Focused Chromium layout/overflow suite: 30 tests pass.

The rebased integration passed 41 Chromium tests, 94 unit tests and 48 E2E tests before the shrink follow-up. The shrink follow-up passed 28 focused browser cases and 12 built-preview scenarios. Focused type, lint, formatting and controller checks passed. Repository eager-import/worktree guards and affected test typecheck projects passed.

Range-diff: two product commits required upstream lifecycle and responsive-layout adaptations; two earlier test commits remained patch-equivalent. The shared geometry/gesture modules were unchanged by the rebase. The long-draft overflow fixture was restored without weakened assertions.

After the review corrections, all 18 affected full-app E2E tests across three files passed.
