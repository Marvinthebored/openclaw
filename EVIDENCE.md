# Apple chat history: real-Gateway native proof

## Environment and method

Source: 8fb912ca655280a77911553e20761d6614360130.
Platform: iOS Simulator, app-hosted Swift Testing.
The native application uses GatewayNodeSession, real URLSession WebSockets, the production IOSGatewayChatTransport and shared chat view model against an isolated real Gateway.

The same workload runs in two independent synthetic sessions: eight seed rows, one initial read, eleven appended rows with a refresh after each, then one unchanged refresh. The baseline forces cursorless requests through the production adapter. The optimized run passes accepted cursors. A proof-only transport decorator suppresses unsolicited live events so each observation is explicit; it does not fabricate or modify history responses.

A transparent relay counts original UTF-8 JSON frame bytes with compression disabled on both legs. Counts exclude WebSocket/TCP/TLS framing. The trace records only allowlisted metadata, never message contents, credentials or cursor values.

## Results

| Measurement | Cursorless baseline | Cursor refresh |
| --- | ---: | ---: |
| History exchanges | 13 | 13 |
| Full responses | 13 | 1 |
| Delta responses | 0 | 12 |
| Response JSON frame bytes | 633,120 | 131,529 |
| Request JSON frame bytes | 2,041 | 4,664 |
| Both-direction JSON frame bytes | 635,161 | 136,193 |

Response bytes decrease 79.23%; both-direction JSON bytes decrease 78.56%.
Both runs preserve all nineteen message texts. The unchanged optimized response has zero message rows.

## Recovery assertions

The optimized native view model additionally verifies:

- A real held local-model run appears in the history snapshot.
- Sequence-gap recovery re-adopts active ownership from an empty transcript delta while preserving prior rows.
- Model completion is reconciled into the transcript.
- Reset rejects the stale cursor, then performs a cursorless canonical reload.
- The reset survivor is present and pre-reset rows are absent.

The captured recovery sequence is delta(active), delta(empty and active), delta(final), reset, full.

## Native validation

- App-hosted proof plus iOS adapter suite: 35 tests in 2 suites passed.
- Scoped shared-kit validation: 665 tests in 19 suites passed.
- macOS OpenClaw native product build passed.

Files: [test harness](RealHistoryGatewayProof.swift), [wire metadata](wire.public.jsonl), [measurement summary](summary.public.json), [terminal success excerpts](validation.log).

AI-assisted.
