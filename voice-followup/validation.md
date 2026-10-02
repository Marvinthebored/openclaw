# Voice review follow-up

The startup acknowledgment repair installs output identity before the catalog await and buffered-event replay. A separate lock-owned readiness flag keeps new audio behind startup deliveries. Three changed Swift files received a fresh independent source-only review with no blocker.

## Startup regression

[RED output](startup-red.txt): three tests, startup-ack test fails, two controls pass (3.522s execution). The controlled [source variant](startup-red-control.swift) restores published late identity assignment while retaining the new routing gate. This isolates identity ordering; it is not a verbatim stock build. [Restored candidate GREEN](startup-green.txt):69 tests in8 suites,2.488s execution. Formatter:0/3 changed files need formatting.

## Actual native audio backend

[Output](real-backend.txt) and [standalone harness](real-backend-harness.swift): default production player, real macOS AVAudioEngine/AVAudioPlayerNode, twenty zero-PCM frames (19,200 bytes). MainActor is stalled for2 seconds; the real dataPlayedBack completion triggers the playback mark acknowledgment during that stall, off main. One test passed (2.015s). Only transport/capture are synthetic; the output backend is not substituted. Silence avoids audible disturbance. This proves actual OS-backend playback completion under main-actor contention, not intelligibility, Bluetooth behavior, or physical iPhone output.

## Confirmation final I/O

[Captured output](confirmation-effects.txt), [full method and limits](confirmation-method.md), and [standalone harness](confirmation-chat-effect.evidence.test.ts). Five cases pass (13.06s wall): exact saved speech executes the original action once; wrong voice scope, changed action and pre-binding invalidation produce no final file I/O; replay leaves one row total. Assertions independently read file bytes or verify no file exists.

The actual transcript/toolCall handlers, omitted-ID authorization, trusted chat.send admission/ACK/background lifecycle, run binding and production initial/final tool guards run. Model/auto-reply dispatch selects deterministic actions; the final tool implementation writes only a local sentinel. Initial challenge and replay use the real production tool wrapper directly. This is isolated synthetic runtime evidence, not live-provider voice acceptance, a WebSocket/auth test, or actual delegated-session execution. The harness is not added to per-PR CI.

No production or phone deployment, provider call, microphone use, or physical voice test was performed. Fresh live-provider confirmation and physical iPhone audio acceptance remain gaps.
