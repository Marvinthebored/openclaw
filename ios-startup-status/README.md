# Native chat startup status evidence

Synthetic iPhone simulator capture, not a real Gateway/provider request.

- Before: base a51a76bda63 with the held-run fixture and regression test only. The test fails because the native label is missing.
- After: final startup-status patch with the same fixture and test. Label presence and removal after Stop pass.
- Crops preserve the draft and working indicator. The keyboard, synthetic model selector, and OS notification are excluded; no pixels inside the crop were changed.
- Elapsed times differ because the base waits five seconds for a nonexistent label.
- Fixture publishes a live chat startup event and retains the corresponding startup snapshot in history, matching the Gateway contract.

Full kit: 2299 Swift Testing tests / 196 suites pass; XCTest 61, two skipped, zero failures. Shared-source SwiftFormat/SwiftLint and macOS build pass. Exact selected output is in proof.txt.
