# iOS message-actions PR session log

## Change

Removed the iOS-only inline Message Actions control below assistant replies. The existing row long-press context menu remains; macOS controls are unchanged. Added an XCUITest absence assertion before exercising the retained long-press actions.

## Validation

Validated the exact two-file patch on source base `2abd386a6dbc3ab12b87d93d464441a6ea60bcc9`; the two changed source files are unchanged between that base and the current upstream tip used for PR preparation.

- Repository-configured SwiftFormat lint: passed.
- Strict SwiftLint on changed production source: passed.
- Focused OpenClawKit Chat tests: 1,759 tests in 132 suites passed (`swift test --filter Chat`).
- iPhone 17 / iOS 26.5 simulator control run: 1 test passed, 0 failed.
- Patched iPhone 17 / iOS 26.5 simulator run: 1 test passed, 0 failed.
- The focused UI test checks the removed button is absent, then verifies the long-press menu, reactions, Copy Message, Select Text, and transcript/composer visibility.

Screenshots are captured from the same before/after test: the assistant row before long-press and after the inline button removal. The simulator scratch project excluded the Watch target; production SwiftLint was run separately on the changed production file.
