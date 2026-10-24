# Current-head in-place upgrade proof — PR #167173

Candidate: `f1c3deb6256fa1d5b0f7d975042d4dd9c0c488f3`. Release: `59cb44796b0f1f0daa0e37af8b1495abb45d9bc1` (2026.10.3).

Simulator only, normal native token entry and pairing to an isolated real Gateway. No phone install. Production app sources are unchanged by the private UI driver.

- [Sanitized terminal receipt](ready.sanitized.json): all 28 steps rc0, with completion timestamp and exact build hashes. Preferences are byte-identical across installation before first launch; Docs remains pinned.
- [Exact XCTest output](exact-ui-results.txt): four separate UI phases each execute one test with zero failures.
- [Sanitized Gateway snapshots](gateway.sanitized.json): catalog, session labels/placement and zero migration puts across stable, candidate, and relaunch.
- [Executed private XCTest driver](UpgradeProof.swift): native group creation, upgrade, seven menu entries, fold/unfold, defaults save/reopen, and persisted folded state.

Populated-catalog behavior matches the web UI: stable creates Legacy Amber through session placement; candidate keeps that catalog, clears local legacy names and drops the empty Legacy Violet. This proof does not claim that empty local groups survive a populated catalog. Menu availability is checked; the controls phase does not execute every destructive/menu action.

The focused current-head lane separately passed 50 app, 61 kit, and 3 UI tests. Prior-head broader proof remains separately linked in the PR; it is not current-head CI evidence.

Screenshots are real XCTest attachments. Connection footers are cropped and the local folder path is masked in the defaults sheet. [Hashes and transformation manifest](screenshots.json). Raw private state, SQLite files, credentials, runtime connection metadata and full logs are deliberately excluded.
