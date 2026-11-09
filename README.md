# Installed simulator upgrade validation — 10 November 2026

Stable source: `b556fdf457b026574bf0f1e7b4914b15f3f179ce`.
Candidate: `39f78f996ef9c3842deb5e14c53350665b670e7d`.
Xcode 27.2; retained iOS simulator; same debug bundle identifier.

The stable app UI created an occupied Legacy Amber group and an empty Legacy Violet group, pinned Docs, and verified persistence after relaunch. The candidate app was installed over that installation with simctl install, without uninstalling or erasing data. Preferences before first candidate launch exactly matched stable preferences (the OS changed the container directory during installation).

Three sequential XCTest UI methods passed (exit 0 each): testCandidateMigration, testCandidateRound2GroupControls, testCandidateRelaunch. Assertions checked migrated occupied-group placement, retained pinned Docs, real session visibility, removal of legacy local group preferences, header fold/unfold, long-press menu items, defaults save/reopen, and folded state after process termination and relaunch. The empty device-local Violet group was absent with the populated writable Gateway catalog. This records observed behavior, not owner acceptance of that policy.

These are install-over simulator results, not physical-device upgrade results. They do not establish new-session inheritance or empty-catalog migration coverage. Test-only UI drivers were additive to each source build; no product source was changed for this proof.

Inspected screenshots:
- [Migrated session and pinned Docs](migrated-session-and-pinned-docs.png)
- [Folded after relaunch](folded-after-relaunch.png)
- [Unfolded after relaunch](unfolded-after-relaunch.png)
