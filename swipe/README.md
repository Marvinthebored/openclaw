# Native swipe body-invalidation comparison

Baseline: `d4df45278320bcb9553d181972b7f88318a9a07e`.
Patched: `556d0afc32a88717e60389e6c8ef2e4d33da0c46`.

Same native 60-question fixture, unchanged `testLongTranscriptFlingScrolling`, 16 fast gestures (8 down, 8 up), identical diagnostic instrumentation and Debug `-Onone` settings. Xcode 26.6, Swift 6.3.3, iPhone 17 Pro / iOS 26.5 simulator. Only the two scroll-state-isolation product files differ. Fixture and UI-test source hashes match across heads.

| Measurement | Baseline | Patched |
|---|---:|---:|
| Bodies during swipe intervals | 82 | 0 |
| Average per swipe | 5.125 | 0 |
| Bodies outside swipe intervals | 31 | 15 |
| Total body trace lines | 113 | 15 |
| Scroll phase trace lines | 53 | 49 |
| Complete intervals | 16 | 16 |

Per-swipe baseline counts: `[6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6]`.
Per-swipe patched counts: `[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]`.

Each interval begins at the first tracking/interacting callback and ends at idle; all observed intervals began at interacting. Baseline in-swipe invalidations and patched outside-swipe body lines are positive controls for the identical tracer. Full timestamps, phase sequences, durations, and counts are in the count JSON and filtered traces. The historical cause parser and independent parser agree.

Both heads passed the fling test and the existing history-prepend and manual-reader-during-tool-stream positioning tests: 3 UI tests per head, zero failures. Existing ±12-point history-row and ±2-point tool-stream-anchor expectations were retained. The patched head also passed 26 focused native tests in ChatScrollCommandTests/ChatReaderScrollStateTests, SwiftFormat 0.63.1 on both changed files, and SwiftLint 0.65.1 on both changed files (0 violations).

This measures native full-chat-body invalidation during gestures, not physical-device latency or frame rate. Complete generated Mermaid assets were hash-matched before SwiftPM; builds/simulator runs were serialized and CPU-capped. Diagnostic and generated-project changes were scratch-only and restored; final tracked source status was clean.

All 40 screenshot attachments show only synthetic fixtures. Their original EXIF/XMP metadata was inspected and removed; sanitized image checksums are recorded. `screenshots.json` maps the image names to test milestones. The four contact sheets cover every image. Full private logs and raw result bundles are excluded. Nothing was published.
