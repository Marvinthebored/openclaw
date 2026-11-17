# Evidence: iOS live tool-call folding

Simulator proof for the iOS live tool-fold PR, recorded 2026-11-17 on an iPhone 17 Pro
simulator (iOS 26, Xcode 27.2): the real app binary with a deterministic offline transport fixture.

## Runs

- **After:** commit `afc225a1305` on upstream main `7bda9076ff9`. Kit tests: 53 tests in 7 suites
  passed. Real-app UI tests `testLiveToolFoldSegments` (OpenAI-style tagged commentary) and
  `testLiveToolFoldUnphasedSegments` (Claude-style untagged text) passed.
- **Before:** stock main `7bda9076ff9` plus the same fixture and `testLiveToolFoldBaseGeometry`
  (fixture and test only, no product change). The test fails at its final assertion because the
  answer moves 36 pt when the turn finishes; both frames were captured before that assertion.

## Files

- `clean-{before,after}-{live,finished}.png`: before/after pair at native resolution
  (1206x2622). Live = mid-turn, after the first answer, while the last call runs. Finished = turn complete.
- `annotated-*.png`: copies of the same frames with the defect and the change marked.
- `*-geometry.txt`: answer frame before and after finalization, as recorded by the UI tests
  (main: y 340 -> 304; after, tagged: 269 -> 269).
- `openai-*.png`, `claude-*.png`: five states per fixture (402x874 pt): live-folded, live-expanded,
  live-frozen-and-current, finished-collapsed, finished-expanded. `*-sheet.png`: side by side.
- `sim-tests.mov`: recording of both after UI tests. `before-main-sim-test.mp4`: recording of the before test.
