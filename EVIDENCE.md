# Stop after Send: production-timing proof

Source: openclaw/openclaw PR #176941, commit 5140dd0a71032e7ed1ebb511e67fd828b596a465.
Native simulator: iPhone 17 Pro, iOS 26.5, Xcode 26.6.

## Interaction

The existing held-response app fixture runs through the shared SwiftUI composer. Its response cannot finish on its own.

The UI test caches the Send button's absolute screen position, performs two independent taps without an intervening accessibility lookup, checks that the response is still active, and then deliberately taps Stop.

- Guard duration: fixed 700 ms.
- Guarded run: first tap 10.68 s, second tap 11.09 s (410 ms apart); response stays active. Deliberate Stop at 13.79 s cancels it. Test passes in 16.428 s.
- Stock composer: first tap 10.08 s, second tap 10.49 s (410 ms apart); response is cancelled. The same test fails with `STOP_GUARD_MISSING: double-tapping Send cancelled the response`.
- Composer package checks: 24 tests in 5 suites pass.
- Touched Swift formatting and strict production lint pass.

## Artifacts

- [Runtime trace](runtime-trace.md)
- [Simulator recording](production-double-tap.mp4)
- [Before: immediately active Stop](before-live-stop.png)
- [After: response survives the rapid taps](response-survives.png)
- [After: deliberate Stop cancels](deliberate-stop.png)

The recording contains only the synthetic chat fixture, has no audio, and has had metadata removed.
