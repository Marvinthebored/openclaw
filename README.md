# Existing physical-device evidence for PR #168919

## Native recording

[60-second native iPhone recording](phone-token-display.mp4). [Sampled frames](phone-token-display.png).

This is an uninterrupted, normal-speed segment from an existing October 11 recording, source seconds 5–65. Only the working-indicator strip remains: the conversation, composer, keyboard, status bar and navigation have been cropped out; audio is removed. Frame rate is reduced to 5 fps for size. No displayed counter has been replaced or synthesized.

The visible output-token count advances from 1,233 through 1,412, 1,511, 1,725, 2,025 and 2,210. Elapsed time and activity text also update. This establishes that the native working indicator remained live on the cumulative phone build carrying the observation fixes. It does not establish that events were token-only, measure transcript rebuilds, or show completion.

Build provenance: the latest verified installed build before this recording was 102455. The token-observation change was carried into 102454; unchanged-narration reconciliation was added in 102455. This is the cumulative development phone build, NOT the exact isolated PR binary. The phone uses its existing child-view wrapper; this PR extracts that observation boundary into ChatRunStatusContent. Other performance changes and diagnostics are present in the phone build. Do not attribute overall performance to this PR from this clip.

## Earlier physical runtime trace

The attached runtime-excerpt.txt is the complete saved diagnostic-log interval overlapping an existing physical Time Profiler capture, October 11, 11:27:48.086–11:28:01.877 HKT, app PID 44090, build 102455. It is earlier than the video, not synchronized with it. The raw profiler export is retained privately because it contains machine paths and unrelated application details.

The log shows a history application with changed=false, followed later by changed=true. It also records nonzero body/live evaluation counts and 45–107 ms stall samples while the sidebar is open. It does NOT label individual token events or connect an unchanged history response to an isolated zero-rebuild interval. Therefore this trace must not be presented as proof of zero transcript rebuilds, smooth scrolling, or a general lag cure.

## Coverage and remaining gap

| Requirement | Evidence | Limit |
|---|---|---|
| Working indicator still updates | Physical recording above | Cumulative build; no synchronized event trace |
| Token events do not notify lifecycle observers | Existing stock-fail/patched-pass regression | Model observation, not shipped-view profiling |
| Identical history does not notify transcript observers | Existing stock-fail/patched-pass regression, with/without narration | Model observation; runtime excerpt is not causally isolated |
| Completion and narration settlement preserve state | Existing passing regression/replay suites | No matched native completion recording found in this archive review |

The other October 11 phone recordings found in the supplied-recordings directory are from 07:18 and 07:37, before these changes. They cannot serve as after-proof for this PR. This supplemental evidence narrows the gap; it does not claim the full review gate is satisfied.

AI-assisted evidence extraction and review. No new phone run, installation or code change was performed.
