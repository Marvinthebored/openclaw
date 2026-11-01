# Parallel tool result proof
Published candidate: fb7d90d6de909f3f6708bc96d64424e323c5a78f, rebased onto 87ba257f66d04d65772ce1e160c4cc9e872a21cd.
Native build and simulator proof ran at e5e26727099756e39b18ca7fce170a257a4f0a2a before rebase; all six changed source/test files are byte-identical after rebase (git diff empty).
Xcode 27.1, two build workers. Local app build and native fixture tests passed using the repository's CI-mode advisory size semantics (GITHUB_ACTIONS=true). Watch packaging and prebuild lint remained enabled.
The strict local build fails on an existing lint error in AppleReviewDemoChatTransport.swift, which this PR does not touch. This is NOT strict local build proof.
Synthetic fixture only, not real-provider end-to-end proof. The fixture was removed and shipping source hashes restored afterward.
Before: echo Alpha and echo Beta both show No result. After: expanding completed work reveals ALPHA_RESULT_VISIBLE and BETA_RESULT_VISIBLE under the matching calls.
Focused ChatToolResultIngestion tests were rerun on the published rebased candidate; see ingestion-tests.txt.
No persisted schema change; earlier upgrade/strict-decoder claims are superseded.
Two prior local adversarial passes identified a run/carrier collision; it was fixed with regression coverage.
AI-assisted. Session summary: inspected native screenshots, rebased cleanly, reran focused tests, published this bounded evidence and updated the existing PR. No merge, phone, or production action.
