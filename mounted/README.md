# Mounted composer proof
PR 194235 head ca086cfc2e38b5323ce82bb51dcfcfbd75462d0b source fix, with temporary instrumentation in runtime.patch. One simulator UI test passed on iPhone 17 Pro / iOS 27.2, Xcode 27.2. Synthetic screenshot fixture; no live gateway, phone, or latency measurement.

The actual mounted editor and primary-control bodies recorded draft changes. From the first length=1 editor event through deletion back to zero, composer and model-controls each evaluated zero times. Startup and keyboard-focus events before that interval do evaluate those bodies. SwiftUI coalesced some edits: observed editor lengths are 1,4,5,4,3,2,0, not one render per key. Primary controls render multiple times due to layout candidates; no one-render-per-key claim.

XCTest verified empty Talk/no Send, draft 'mount' with enabled Send/no Talk, then cleared Talk/no Send. The three exported screenshots were visually inspected. Trace timestamps are relative to first event; local filesystem paths in the test log were redacted. Instrumentation is proof-only, not part of the product patch. This run does not measure wall-clock typing latency or compare mounted counts against stock.
