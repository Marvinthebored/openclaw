# Apple chat history bandwidth

The same synthetic transport script performs one initial read, eleven appends with one refresh each, and one unchanged refresh. Both versions retain all twelve message texts in order.

| Measurement | Before | After |
| --- | ---: | ---: |
| Total chat.history reads | 13 | 13 |
| Full reads | 13 | 1 |
| Delta reads | 0 | 12 |
| Encoded JSON response bytes | 11,391 | 2,824 |

The probe counts sorted-key JSON response bytes before decoding, without request or WebSocket overhead. Response payload bytes decrease 75.2% in this workload.

`HistoryBandwidthProbeTests.swift` is the complete supplemental measurement probe. Copy it into `apps/shared/OpenClawKit/Tests/OpenClawKitTests/` and run `swift test --package-path apps/shared/OpenClawKit --filter HistoryBandwidthProbeTests` with the package resources prepared. The `full == 1` assertion fails on stock production code and passes with the fix; both runs check all twelve message texts.

`stock-main-assertion.log` contains the stock assertion result. `run.log` contains the raw step results: stock red; patched 653 tests in 19 suites passed; 34 iOS transport tests passed; iOS simulator and macOS builds passed.
