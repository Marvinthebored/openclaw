# PR #191217 production SQLite runtime proof

Head: 2fde4a5252cc7407a23b847595fc906173cdb4b9.

Two separate native Swift test processes use the unmodified production OpenClawClientDatabases / OpenClawChatSQLiteTranscriptCache facade on the same on-disk directory. The first writes a synthetic bridged apply_patch message using storeCanonicalTranscript, loads it, verifies the retained input and raw identity, and closes SQLite. After that process exits, a new process opens the existing database without writing a message and resolves its cached arguments through the same ToolDisplayRegistry.displayCall -> ChatToolDiff.resolveDiff path used by ChatToolActivityRowContent.

Result: both phases pass; process IDs differ; restored preview contains one deletion (Hello before) and one addition (Hello after). SQLite payload retains only the patch input, not ignored arguments. No Gateway, network, credentials, or model calls are used.

Important limitation: this is actual production SQLite write/reopen plus production preview resolution in separate native processes, NOT a cold launch of the shipping iOS app and NOT a rendered screenshot. It strengthens the prior argument-projection test but does not establish the full application reload requested by ClawSweeper. Do not present it as completed native app proof or request re-review on that basis alone.

Run in apps/shared/OpenClawKit with the supplied scratch test:
```sh
COLD_PATCH_PHASE=write COLD_PATCH_DIRECTORY=/tmp/pr191217-cold-runtime swift test --jobs 2 --filter ColdPatchRuntimeProof
COLD_PATCH_PHASE=read COLD_PATCH_DIRECTORY=/tmp/pr191217-cold-runtime swift test --skip-build --filter ColdPatchRuntimeProof
```

Use a fresh directory for write. The second phase performs no store. This test file is proof-only and is not part of the PR source diff.
