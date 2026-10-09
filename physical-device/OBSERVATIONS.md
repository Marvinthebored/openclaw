# Physical-iPhone menu and Copy proof

Candidate: `2f30d78cec2febddcb438b328cd0621717a2a208`. Optimized iPhone build **102422**, installed and independently checked in device inventory. Build inputs matched all 60 candidate-file hashes and 526 native production-source hashes.

A user recorded the native app on a physical iPhone. The original recording is 23.15 seconds. Inspection of the original frames establishes:

| Original time | Observed result |
| --- | --- |
| 5–7 s | Long-press opens the native session menu, including Assign to, Fork Conversation, Copy, and Open in. |
| 8–11 s | Copy expands to Session Link, Session Preview Link, Markdown, and Session ID. |
| 12–13 s | Selecting Session ID dismisses the menu and shows **Copy — Session ID copied.** |
| 19.3 s | Pasting into the composer produces a UUID, matching the ID independently supplied by the user. |

[Redacted recording](iphone-copy-redacted.mp4) retains the original menu and alert pixels and timing from 5.5–19.65 seconds. All other screen areas and navigation intervals are blacked out. The center of the pasted identifier is masked. Audio and metadata are removed. These are privacy redactions, not reconstructed UI.

[Menu](session-menu.png) · [Copy choices](copy-submenu.png) · [Observed confirmation](copy-confirmation.png) · [Pasted result, redacted](pasted-id-redacted.png) · [Verification receipt](verification.json).

The final three-file follow-up fixes the bridge lint findings and removes the source-text assertions requested in review. Its focused checks passed: **11 web tests**, **5 native regression tests**, lint, format, and UI typecheck. The independent delta review found no actionable findings. Earlier full workflow and compatibility results remain in [the validation record](../EVIDENCE.md).
