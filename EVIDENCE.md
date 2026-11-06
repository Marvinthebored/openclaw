# iOS sidebar insertion proof

AI-assisted implementation. This is a sanitized session/validation record; no private chat history is included.

## Reproduction and results
Hosted RootSidebar: 40 pinned rows; scroll offset400; insert3 newer pinned rows.
- Stock r7:1 test/1 suite failed; expected compensation138pt, measured compensation0pt.
- Patched r7:2 tests/2 suites passed (insertion and equality).
- Independent rendered-row geometry r5/r6: stock row Y134->272; patched Y134->134, offset400->538.
- before.png and after.png are layer-rendered captures of the hosted patched sidebar before/after insertion. They show preserved row positions, not a phone gesture test.

## Checks and scope
Xcode27.2, iOS26.5 simulator. Source behavior tested on22a13d60900; rebased onto38f68a10828 with identical apps/ios and apps/shared base trees. Final assertion wrapping is whitespace-only.
SwiftFormat0.63.1:0/5 files need formatting. SwiftLint0.65.1 strict:0 violations in3 source files.
Simulator templates bypass baseline lint build phases; explicit scoped lint above was separate.
Two prefiling reviews completed; no concrete regression remained. Attention badges stay outside equality; selected state, main key, categories, connection, minute, and node are equality inputs.
Known limitation: removal of the chosen anchor row is not corrected. Top-of-list and active scrolling are excluded. No phone test or deletion-case proof claimed.

## Session trail
The initial contentSize-based test oracle was rejected: LazyVStack reports estimated total height. Actual row geometry established138pt displacement. The final diagnostic-free fixture checks compensation for3 fixed44pt rows with2pt spacing. Temporary geometry/image probes are not in the source PR.
