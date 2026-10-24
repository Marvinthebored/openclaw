# Apple history: live Gateway proof

Validated source: c752c097fee716989eb7b33c84fd435a6353acd1.

## Actual native execution

The app-hosted Swift Testing case `realGatewayHistory()` started and passed in 13 seconds, with `REAL_APP_GATEWAY_HISTORY_PASS` in its output. The native run passed 35 tests in 2 suites. XCTest separately reports zero tests because these cases use Swift Testing, not XCTest. See [terminal excerpts](validation.log).

The app connects through production GatewayNodeSession, URLSession WebSockets, IOSGatewayChatTransport, and the shared view model to an isolated real Gateway. The [transparent relay](wire-relay.mjs) records a successful openclaw-ios connection and actual chat.history requests and responses. History responses are not mocked or synthesized. The local model is held only to exercise active-run recovery.

## Wire results

| Measurement | Cursorless baseline | Accepted cursors |
| --- | ---: | ---: |
| Requests | 13 | 13 |
| Full responses | 13 | 1 |
| Delta responses | 0 | 12 |
| Response JSON frame bytes | 633,120 | 131,529 |
| Request JSON frame bytes | 2,041 | 4,664 |

Response JSON bytes fell 79.23%. Both runs preserve all nineteen message texts: eight seed rows plus eleven appends. The unchanged cursor refresh returns zero rows. Counts exclude WebSocket/TCP/TLS framing; compression is disabled on both relay legs.

Baseline and candidate use the same production adapter. The baseline decorator forces cursorless reads; the candidate supplies accepted cursors. A proof-only event-consumption gate makes each measured observation explicit without changing responses.

The trace has 31 requests and 31 successful responses, including recovery: active-run delta, empty sequence-gap delta retaining active ownership, final delta, stale-cursor reset, then canonical full reload. The native assertions verify preserved rows and reset survivor/old-row absence.

## Decode reuse and validation

- Focused shared-kit run: 672 tests in 22 suites passed.
- Prepared identity regression: 1 test failed as intended after removing prepared-message reuse; restored source passed 1 test in 1 suite.
- All 13 changed source/test files match the committed source hashes before and after validation.
- Production Gateway listener and installed build remained unchanged.
- This run built and tested an iOS Simulator app; it did not install on a phone or rerun the macOS product build.

[Native harness](RealHistoryGatewayProof.swift), [wire metadata](wire.public.jsonl), [measurements](summary.public.json), [source hashes and terminal status](native-results.json), [terminal excerpts](validation.log).

Only allowlisted wire metadata is published: no message bodies, tokens, cursor values, session IDs, IP addresses or local paths. Published harness endpoints use localhost in place of numeric loopback addresses.

AI-assisted.
