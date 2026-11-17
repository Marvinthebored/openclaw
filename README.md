# Evidence: iOS live tool-call folding

Simulator proof for PR #200485, recorded 2026-11-17 on an iPhone 17 Pro simulator (iOS 26, Xcode 27.2): the real app
binary with a deterministic offline transport fixture.

## Runs

- **After:** `2f60e1c4464` on upstream main `7bda9076ff9`. Kit: 47 tests in 7 suites passed. Real-app UI tests
  `testLiveToolFoldSegments` (provider-tagged commentary), `testLiveToolFoldUnphasedSegments` (untagged text) and
  `testLiveToolFoldPendingEvents` (live agent events: pending call, commentary stream update, result, recorded history
  replacing the live rows) passed.
- **Before:** stock main `7bda9076ff9` plus the same fixture and a capture-only UI test (no product change).

## Files

- `clean-{before,after}-live.png`: mid-turn, after the first answer, while the last call runs. Native 1206x2622.
- `clean-{before,after}-finished.png`: finished turn. The narrowed change keeps main's finished layout.
- `annotated-{before,after}-live.png`: copies of the live pair with the change marked.
- `clean-pending-*.png`, `clean-commentary-updated.png`, `clean-history-replaced.png`: live-event path.
- `*-geometry.txt`: answer frame before and after the turn finishes, as recorded by the UI tests.
- `sim-tests.mov`: recording of all three after UI tests. `before-main-sim-test.mp4`: recording of the before capture.
