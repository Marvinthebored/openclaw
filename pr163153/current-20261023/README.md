# Native history landing evidence

The connected and missing-marker paths below use the product delta in c243a3ea9efe549209f3550946ecfc93f56a5f3e. The staged product patch byte-matches that commit's complete three-file delta. Source variants and scratch-only probes are identified in [product-provenance.json](product-provenance.json).

## Inspectable row landings

iPhone 17, iOS 26.5 simulator, native app, synthetic 600-message history. Each page adds 101 messages. Coordinates are the top of the first rendered label glyph, measured from the top of the native screenshot at 3 pixels per UIKit point. They are not accessibility frame values or scroll-view content offsets. The before captures show the pending-page spinner, and the after captures show older content inserted above the same row.

| Route | Row | Before page arrival (pt) | After landing (pt) | Drift (pt) | Captures |
| --- | --- | ---: | ---: | ---: | --- |
| Connected marker | HISTORY_ANCHOR_499 | 187.33 | 187.33 | 0.00 | [Before](connected-499-before.png) / [after](connected-499-after.png) |
| Missing marker, fenced row restoration | HISTORY_ANCHOR_499 | 187.33 | 186.67 | -0.67 | [Before](fallback-controlled-499-before.png) / [after](fallback-controlled-499-after.png) |
| Missing marker, fenced row restoration | HISTORY_ANCHOR_398 | 187.33 | 186.67 | -0.67 | [Before](fallback-controlled-398-before.png) / [after](fallback-controlled-398-after.png) |

[Machine-readable coordinates](landing-trace.json) · [Reproduction script](measure-landing.py) · [Independent full-interior pixel alignment](pixel-alignment.json).

The [connected native receipt](caller-testConnectedCallerConsumesDeferredOnce.log) records request at 12:01:29.516 and native landing at 12:01:38.080 with the seeded deferred request still present for consumption. The before capture is 12:01:34.347; the after capture is 12:01:39.470. The first landing is shown; the whole short-window test later fails its second-page precondition.

The [controlled native receipt](controlled-testMissingAnchorCallerRestoresReader.log) records both captures at contentOffset.y=0, preserved row offsets approximately -51.333 pt, and page arrivals at 12:22:08.276 and 12:24:32.290. Both arrivals decline native landing, clear the deferred flag, and enqueue row restoration. There are exactly two page requests and no native completion. The harness forces a missing marker and uses a 25-second fixture delay to make a valid pre-arrival sample possible. This is row-preservation proof, not a production-latency measurement. The whole two-page/return-to-latest test passes. All times here are the native log/capture clock as recorded.

## Run results, including failures

[Complete staged run results](results.json) distinguish the intermediate r2 candidate from the final-product caller and controlled variants. [Caller boundary results](caller-boundaries.json) retain both original five-second caller failures. The missing-marker variant and the connected-marker variant each land their first page, but fail their second-page precondition; the controlled missing-marker test passes with a 25-second page-delay fixture. There is no controlled connected-marker whole-test pass in these artifacts.

The intermediate r2 candidate's two rich metadata UI tests fail. The separate native first-paint probe passes and the rich fixture visibly paints before metadata completion, but this does not turn those failed tests into passes.

The historical 711/739/711 pt first-run drift on 776b11e50db remains unresolved. The original logs were overwritten before this evidence task. The current disconnected-marker correction is not claimed as its cause or its fix. This record preserves the failure; later passes do not erase it.

## Privacy and image integrity

All screenshots show synthetic fixture content. Every published image was visually inspected. No IP addresses, keys, phone numbers, or non-public endpoints are included. Metadata was removed without changing PNG image data. [Inspection record](image-inspection.json).

## Current response presentation

Native app captures from c243a3ea9efe549209f3550946ecfc93f56a5f3e on iOS 26.5. Every one of 841 tracked Swift files under apps/ios and apps/shared matches that commit before building; no source instrumentation or fixture delay change is used for these presentation captures. Each device runs the existing testCompletedWorkDisclosureKeepsFinalReplyVisible: open the work disclosure, verify earlier context appears, close it again, and verify the final reply remains above the composer.

| Device | Initially collapsed | Expanded | Collapsed again | Result |
| --- | --- | --- | --- | --- |
| iPhone 17 | [Initial](iphone-completed-work-initial.png) | [Expanded](iphone-completed-work-expanded.png) | [Collapsed again](iphone-completed-work-collapsed-again.png) | Pass |
| iPad Pro 13-inch (M5) | [Initial](ipad-completed-work-initial.png) | [Expanded](ipad-completed-work-expanded.png) | [Collapsed again](ipad-completed-work-collapsed-again.png) | Pass |

[Build/test results](presentation-results.json) · [Swift source manifest](presentation-swift-manifest.json) · [iPhone terminal summary](iphone-presentation-summary.txt) · [iPad terminal summary](ipad-presentation-summary.txt).

Both simulator builds use the existing generated simulator project adaptation that omits the Watch dependency and push entitlement. No physical-device or Watch result is claimed.
