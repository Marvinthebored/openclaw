# iOS transcript validation

AI-assisted implementation and validation record.

- Native cancellation/history-trim regression: 1 XCTest, 0 failures.
- Keyboard, sends, manual reader departure and explicit Jump: 1 UI XCTest, 0 failures (62.691 seconds). Post-Jump viewport intersection, rendered pixels and captured screenshot checked. Synthetic fixture, not real network proof.
- Focused package regressions: 142 tests across 8 suites passed.
- Before image: archived public simulator reproduction on earlier main, not a fresh base-red run of the cleaned port. After: current cleaned port synthetic UI test. Images differ in appearance and content; they are behavior evidence, not a visual parity comparison.
- Archived streaming/fold/Talk measurements apply to the accepted development stack, not a repeated cleaned-port experiment.
- Scoped pinned lint and format passed; build job lint phases bypassed. No new physical-device or macOS visual validation.
- Two local independent reviews completed. Cancellation resurrection finding fixed with deletion-revision invalidation and production-path regression.
