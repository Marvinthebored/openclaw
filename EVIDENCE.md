# Native app run for openclaw/openclaw#168919

Head under test: `14c43c56462d70ca1802480173aa9a9019f4bfab`, built for the iPhone 17 simulator with the diagnostic harness in `diagnostic-harness.patch` applied on top (log markers and a synthetic chat transport; no product logic changes).

The native UI test `testPerformanceReviewProof` drives the app through a 60-row synthetic transcript, a streamed reply, token-only updates, identical history refreshes and completion. It passed (1 test, 0 failures, 36.3 s). The 19 `ChatStreamReplayTests` passed in the same run.

## Runtime markers (`runtime-perfproof.log`, 417 lines)

| Input to the app | Count | View work logged |
|---|---|---|
| Streamed assistant text events | 128 | 34 paced flushes, 25 transcript body evaluations |
| Token-only updates | 12 | 13 token-indicator body evaluations, 1 transcript body evaluation |
| History refreshes | 20 | 16 reported unchanged, 4 changed |
| Identical history replays | 3 | 3 reported unchanged |
| Terminal event | 1 | reply settles into history |

## Screenshots (in capture order)

1. `01-proof-run-start.png`: run starts.
2. `02-proof-live-edge.png`: paced reply grows at the live edge.
3. `03-proof-paused-reader.png`: reader scrolled up to rows 48 to 51 while the reply streams.
4. `04-proof-paused-reader-stable.png`: same rows after further streamed text.
5. `05-proof-completion-paused.png`: same rows after the reply completes.
6. `06-proof-settled.png`: settled transcript with rows 58 and 59 and the paced reply.

`recording.mov` is the 40 s simulator recording of the same run.
