# PR #181591 live Gateway/Codex proof

## What ran

- STOCK: PR merge base on main, `648528a15470451db1d6b89ad35a829630372ec3`. PATCHED: `b5803a09ccaad014d0a9c693f628e037d0be102c`.
- macOS, Node 26.12.1, Codex CLI 0.159.2 from the managed ChatGPT application, `openai/gpt-6.1-sol`, thinking low, official OpenAI API-key authentication. The existing environment credential was used without printing it.
- Fresh detached worktrees, independently cloned locked dependencies, and repository TypeScript source entrypoints. No production build, Gateway restart or production state mutation. Both trees had the same observation-only policy logger, captured in repro/ diffs.
- Each run used a separate state directory, empty workspace and HOME, an agent-scoped Codex home, and an independently allocated loopback port. All scenarios ran sequentially under nice 15 with Rust/Go/UV concurrency capped at 2.
- Five parent turns: READY; sessions_spawn with a random PONG phrase and immediate SPAWNED; actual child completion delivered to the parent; one-word recall; ordinary DONE. Child task ran as its own sixth native turn and is reported separately in artifacts.
- In targeted r2/r3 runs, persistent global `deny: [exec]` is captured into the child inherited policy. The owner consequently has a durable restricted A binding. Extra child-only denies are exec/browser/write/edit. Turn 2 requests cleanup=keep. The patch's completion scope is measured, not injected.

## Token accounting

Input/Cached are sums of distinct native `token_count.info.last_token_usage` events within each turn. Turn 2 has a tool call and a second model response. Final-request columns retain the issue-report style measurement. Raw events, rollout-relative paths and original source line numbers are attached. No token estimates are used.

## Targeted runs

| Run | Turn | Thread | Input | Cached | Final-request input | Final-request cached |
|---|---:|---|---:|---:|---:|---:|
| stock-r2 | 1 | A | 28295 | 0 | 28295 | 0 |
| stock-r2 | 2 | A | 57005 | 56665 | 28629 | 28373 |
| stock-r2 | 3 | B | 28403 | 0 | 28403 | 0 |
| stock-r2 | 4 | C | 28462 | 0 | 28462 | 0 |
| stock-r2 | 5 | C | 28508 | 28459 | 28508 | 28459 |
| patched-r2 | 1 | A | 28339 | 0 | 28339 | 0 |
| patched-r2 | 2 | A | 57094 | 56754 | 28673 | 28418 |
| patched-r2 | 3 | B | 28449 | 0 | 28449 | 0 |
| patched-r2 | 4 | A | 28784 | 28670 | 28784 | 28670 |
| patched-r2 | 5 | A | 28831 | 28781 | 28831 | 28781 |
| stock-r3 | 1 | A | 28295 | 0 | 28295 | 0 |
| stock-r3 | 2 | A | 57001 | 56665 | 28625 | 28373 |
| stock-r3 | 3 | B | 28401 | 0 | 28401 | 0 |
| stock-r3 | 4 | C | 28462 | 0 | 28462 | 0 |
| stock-r3 | 5 | C | 28508 | 28459 | 28508 | 28459 |
| patched-r3 | 1 | A | 28339 | 0 | 28339 | 0 |
| patched-r3 | 2 | A | 57090 | 56753 | 28670 | 28417 |
| patched-r3 | 3 | B | 28444 | 0 | 28444 | 0 |
| patched-r3 | 4 | A | 28780 | 28667 | 28780 | 28667 |
| patched-r3 | 5 | A | 28826 | 28777 | 28826 | 28777 |

## Verified behavior

- stock-r2: `{"childEnvelopeSnapshots": ["snapshot-2", "snapshot-3", "snapshot-4", "snapshot-5"], "childHasPersistentExecDenial": true, "childPersistentPoliciesEqual": true, "completionRestricted": true, "completionScope": "conversation", "nativeRestrictionsRetained": true, "ownerThreadRestored": false, "recallAnswerCorrect": true, "sequence": "A,A,B,C,C", "storedOwnerBindingUnchanged": false, "turn4HasQuotedContext": true, "turn4InputContainsPhrase": true, "turn5InputContainsPhrase": false}`
- patched-r2: `{"childEnvelopeSnapshots": ["snapshot-2", "snapshot-3", "snapshot-4", "snapshot-5"], "childHasPersistentExecDenial": true, "childPersistentPoliciesEqual": true, "completionRestricted": true, "completionScope": "turn", "nativeRestrictionsRetained": true, "ownerThreadRestored": true, "recallAnswerCorrect": true, "sequence": "A,A,B,A,A", "storedOwnerBindingUnchanged": true, "turn4HasQuotedContext": true, "turn4InputContainsPhrase": true, "turn5InputContainsPhrase": false}`
- stock-r3: `{"childEnvelopeSnapshots": ["snapshot-2", "snapshot-3", "snapshot-4", "snapshot-5"], "childHasPersistentExecDenial": true, "childPersistentPoliciesEqual": true, "completionRestricted": true, "completionScope": "conversation", "nativeRestrictionsRetained": true, "ownerThreadRestored": false, "recallAnswerCorrect": true, "sequence": "A,A,B,C,C", "storedOwnerBindingUnchanged": false, "turn4HasQuotedContext": true, "turn4InputContainsPhrase": true, "turn5InputContainsPhrase": false}`
- patched-r3: `{"childEnvelopeSnapshots": ["snapshot-2", "snapshot-3", "snapshot-4", "snapshot-5"], "childHasPersistentExecDenial": true, "childPersistentPoliciesEqual": true, "completionRestricted": true, "completionScope": "turn", "nativeRestrictionsRetained": true, "ownerThreadRestored": true, "recallAnswerCorrect": true, "sequence": "A,A,B,A,A", "storedOwnerBindingUnchanged": true, "turn4HasQuotedContext": true, "turn4InputContainsPhrase": true, "turn5InputContainsPhrase": false}`

## Restrictions and bindings

| Run | Owner tools | Completion tools | Child tools | Completion restricted / scope | Child restricted / scope |
|---|---:|---:|---:|---|---|
| stock-r2 | 48 | 48 | 34 | true / conversation | true / conversation |
| patched-r2 | 48 | 48 | 34 | true / turn | true / conversation |
| stock-r3 | 48 | 48 | 34 | true / conversation | true / conversation |
| patched-r3 | 48 | 48 | 34 | true / turn | true / conversation |

The owner is persistently restricted in this setup, so its completion catalog has the same 48 tools; exec is absent and native restricted-mode feature gates remain disabled. The child has its own additional child-only denials, which remain unchanged. The per-attempt policy log, actual native thread configuration/tool names, independent SQLite binding snapshots and child envelope snapshots are attached for every run. On PATCHED the completion remains restricted, native shell/code-mode/browser/computer-use features remain disabled, the child persistent inherited exec denial remains unchanged, and the original owner binding has the same full durable-binding payload SHA-256 before and after completion; separate lease tokens/expiries change normally. Turn 4 resumes A with quoted completion context; turn 5 does not contain the phrase or quote it again.

## All other attempts

- stock-r1: Gateway reached readiness; probe client failed before any model turn because it accessed an unexposed client field. The Gateway exited 0 and port closed. Callback setup was corrected.
- stock-r1b and patched-r1: unrestricted-handoff controls. Child-only configuration denials did not enter the inherited completion envelope; completion restricted=false. Both completed all five turns, with the results below. These runs do not exercise the targeted completion restriction path.

| Run | Turn | Thread | Input | Cached | Final-request input | Final-request cached |
|---|---:|---|---:|---:|---:|---:|
| stock-r1b | 1 | A | 22651 | 0 | 22651 | 0 |
| stock-r1b | 2 | A | 45714 | 45372 | 22987 | 22724 |
| stock-r1b | 3 | B | 23127 | 0 | 23127 | 0 |
| stock-r1b | 4 | C | 22813 | 0 | 22813 | 0 |
| stock-r1b | 5 | C | 22859 | 22810 | 22859 | 22810 |
| patched-r1 | 1 | A | 22692 | 0 | 22692 | 0 |
| patched-r1 | 2 | A | 45796 | 45454 | 23028 | 22765 |
| patched-r1 | 3 | B | 23182 | 0 | 23182 | 0 |
| patched-r1 | 4 | C | 22854 | 0 | 22854 | 0 |
| patched-r1 | 5 | C | 22900 | 22851 | 22900 | 22851 |

## Artifacts and cleanup

- Per-run `turn-start-inputs.json`: actual current native turn inputs, including quoted completion replay and its absence on turn 5.
- Per-run `token-count-events.json`: native rollout token_count events with source path and line.
- Per-run `policies.json`, `thread-tool-catalogs.json`, `binding-snapshots.json`, `binding-value-hashes.json`, `child-envelope-snapshots.json`: independent restriction/binding evidence.
- `comparison.json`: all completed run outcomes. `stock-r1/`: the pre-inference failure. `repro/`: portable replay scripts and observation-only diffs.
- Each Gateway was stopped by its recorded PID; all recorded ports are closed. Native subprocess PIDs were explicitly cleaned up. Worktree tracked cleanliness is recorded in the private final-verification record. No pushes, PR comments or other GitHub writes were made.

STATUS: DONE
