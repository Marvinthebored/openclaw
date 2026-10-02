# Sanitized voice implementation and validation record

Date: 2026-10-02. Base: `8a754c57f5976e6bccab119ad47df0645c94f093`.

This is a curated, sanitized activity record, not a verbatim conversation export. It contains synthetic test evidence only.

1. Isolated a voice candidate from the pinned upstream base. The audio scheduling, emitted transcript metadata, and chat-backed confirmation route were kept separate from the UI consumer and rendering work.
2. Reproduced three Gateway regressions on unchanged production sources while three forged-approval controls remained blocked. See [RED output](gateway-red-summary.txt).
3. Validated the candidate: [301 Gateway tests](gateway-green-summary.txt) and [58 confirmation/schema tests](policy-green-summary.txt) passed. Core no-emit typecheck and scoped lint/format passed.
4. Reproduced native transcript metadata loss and blocked audio scheduling on stock source. A type-only seam allowed new tests to compile without importing the fix: [native RED](kit-red-summary.txt).
5. Verified [163 native shared tests](kit-green-summary.txt), including the production player behind a fake device while MainActor is stalled. The assertion samples scheduling before releasing the stall; all 81 frames including the padded tail are required.
6. Verified [iOS transcript delivery](ios-tests-summary.txt), [simulator app build](ios-build-summary.txt), native macOS compilation, and [scoped format](format-final-summary.txt).
7. Independent Qwen3.8-Max source review found no blockers in current-owner authorization, exact-action binding, expiration/session ownership, audio concurrency and cancellation, or transcript identity forwarding. The parent independently reconciled test logs and source hashes. Review did not rerun tests.

Limitations: no fresh physical-device audio-quality, Bluetooth, or live-provider confirmation acceptance. No production deployment. Displayed transcript/UI behavior is the companion PR's scope. The wall-clock scheduling regression can fail under severe CI load; it is not a responsiveness benchmark.
