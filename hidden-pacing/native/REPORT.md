# Native iOS publication measurement

Both variants ran one XCTest successfully on the same iOS simulator with the real app view/pacer and controlled synthetic assistant events (~40 ms). Same measurement patch; only candidate adds production pacing patch. No provider or phone. Diagnostics are evidence-only, not committed regression tests.

Fixed windows: phase marker +0.75 through +4.00 s (3.25 s). Whole marker-to-next-marker windows include drawer tap transitions and must not be used.

| Phase | Baseline inputs/publications | Candidate inputs/publications | Candidate interval |
|---|---|---|---|
| Visible | 78/20 | 79/21 | 0.15 s |
| Covered | 78/20 | 78/7 | 0.5 s |
| Revealed | 78/21 | 80/23 | 0.15 s |

Covered publication count fell 65% with equal input counts. First input-to-display: baseline 0.494 ms, candidate 0.640 ms. Clear input-to-display: 0.200/0.203 ms. Neither trace has display publications after clearing. These measure model display publications, not pixels, frame counts, CPU, battery, provider latency or physical-device performance.

All six screenshots inspected. Drawer cover and revealed text are rendered. Candidate initial visible screenshot shows an empty live-text bubble despite recorded display publications; this capture does NOT prove visible first-pixel output. First/clear timing claims are strictly publication timing. Later covered/revealed captures show the synthetic words. No claim that this pacing patch fixes the existing blank-chat rendering behavior.

Pending callback deadlines remain unchanged: reveal selects 0.15 s for subsequent scheduling, not an immediate flush. Maintainer-only choice: whether that covered-chat latency tradeoff is desirable upstream.
