# Native helper-wait status: engineering log

AI-assisted (Codex). Public source and synthetic evidence only.

## Scope

Base: upstream main `a51a76bda63`. Add a derived helper-wait state to native chat and show the existing claw/caption layout after the parent turn ends. Name and link exactly one active helper. Use the existing session-switch action. No Gateway, transport protocol, or lifecycle changes.

## Implementation and review

- Reused session metadata and existing display-name/navigation primitives.
- No new mutable state. Seven resolver tests assert named, generic, suppressed, archived, and terminal/explicit-liveness cases.
- Synthetic UI test starts with an idle parent plus one active helper, then taps the helper link and asserts the parent waiting line disappears and the helper transcript appears.
- Static independent Codex review found no actionable defects, covering newly reachable states, atomicity, caller dependence, documentation instructions, and presence/absence assertions.
- Initial patched UI replay drew both the waiting line and named link, but the XCUI child identifier query failed. Removed an unused outer accessibility identifier; retained the button identifier. Re-reviewed the complete change with no actionable findings.

## Evidence limits

Synthetic simulator replay does not establish live Gateway delivery, roster freshness, reconnect behavior, running-to-idle transition, or macOS rendered presentation. Device observation came from a build with additional unmerged changes.


## Final replay

Proof3 base fails at the missing waiting-line assertion; patched iPhone and iPad each pass named-link navigation. Focused 7 tests pass. Swift Testing 2295 tests in 195 suites pass; XCTest 61 tests, 2 skipped, 0 failures. Changed-source SwiftFormat and strict SwiftLint pass; UI test has one inherited unchanged line-length finding (base 571, patched 590). Tree restored clean. Screenshots inspected: waiting line, helper link, destination transcript, and absence of parent waiting line in destination. The iPhone parent AFTER screenshot includes an unrelated simulator Apple Intelligence notification at the top; waiting row is unobscured. Images are unmodified.
