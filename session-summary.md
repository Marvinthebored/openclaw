# AI-assisted engineering session

Codex prepared this fix and the PR, with an independent Grok review and a Codex adversarial review before filing.

Problem: Claude CLI history can embed a tool_result alongside a toolcall in an assistant message, matching tool_use_id, with output in a content text array instead of text. A separate ended activity without a status preserves an unknown outcome; that must not be confused with absent output.

Solution: normalize embedded assistant result text using the existing decoder and preserve message identity and result metadata. Keep unknown outcomes neutral in collapsed rows; show output and Outcome unknown in expanded rows. Preserve actionable failed, blocked, and skipped cues. No execution success is inferred from output presence.

Review follow-up: Codex identified that blocked rows without output would lose their visible outcome. The collapsed status policy now preserves blocked status and has a focused regression covering every state, including absence of success/unknown badges.

Device verification: the reporter verified the UI on an iPhone on November 3, 2026. Before build 102480; after build 102481. The after-build also included other fixes. This PR changes only tool-row output and status presentation. The screenshots are cropped to tool rows; raw chat history is not published. The JSON fixture is sanitized.

The focused shared Swift tests cover history/live ingestion, activity output, transcript rows, source preview, and duplicate delivery. The native UI regression now checks collapsed badge absence and expanded output plus the separate outcome cue.

Cross-family follow-up: embedded assistant text is extracted block by block, matching web, so unrelated malformed metadata cannot discard valid text. String-valued content is also covered. The final focused run passed 45 tests in four suites.
