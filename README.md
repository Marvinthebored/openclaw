# PR #159556: current-main Control UI history-scan proof

Current main: `c374040735c9c4fa6e9dd21efe55b136db782693` (2026-09-29).
PR head: `9809722824e23d24143ae4b2405a092992dd2b87`.

## Result

| Arm | Actual history scan, milliseconds | Median |
| --- | --- | --- |
| Current main | 797.7, 777.1, 758.8 | 777.1 ms |
| Current main + exact PR guard | 2.8, 3.0, 3.0 | 3.0 ms |

All six fresh browser contexts passed: 624 history messages processed, exactly the two expected answers resolved, quoted answer and linked plain answer rendered, no browser page errors. Twenty unrelated questions remain unresolved. No additional history scan was observed during the subsequent viewport resize, consistent with the existing upstream history cache.

## What ran

The actual Control UI boots through its repository E2E Vite server and mocked Gateway handshake/history response in Chromium 153.0.8010.12, macOS arm64. This is NOT a standalone parser microbenchmark, and it does NOT use a live Gateway or private conversation.

The deterministic fixture contains 20 unanswered question cards, 600 ordinary saved user messages, then two question/answer pairs (one generated quoted answer, one canonical linked plain reply). Fixture SHA-256: `0b887ef8df072111af6d00b70d1a6a79c63d5e3e2f501ac7a780f5d22d8b3c3c`.

Only the three-line early return changes between arms. Playwright intercepts the transformed parser module to insert the exact PR guard; both arms use the same current-main app, fixture, cache and scan instrumentation. The current-main parser without the guard and history-reader source are byte-identical to the PR parent's corresponding files. This is current-main plus the PR delta, not a whole-app checkout of the older PR head.

Identical timing probes bracket `readQuestionHistory` at entry and immediately before its return. The scanner is invoked naturally by the rendered chat; the driver never calls the parser or scanner directly. The reports record scanner elapsed time, message count and resolved IDs. Timing runs do not enable CPU profiling. Run order is stock / guard / guard / stock / stock / guard, with a fresh browser context for each run.

## Scope

This isolates a cold/new-history scan on a synthetic unanswered-question workload. It does not establish total navigation time, a production-wide speedup, or that the guard fixes residual resize lag. The upstream memoization is present in both arms. Vite source-mode results are not production-bundle measurements.

## Reproduce

In an isolated checkout at the current-main SHA above, install the repository's dependencies. Copy `proof-history.mts` from this evidence branch into the checkout root, then run:

```sh
node --import ./scripts/tsx.mjs proof-history.mts
```

The repository harness selects an available Chromium executable. `PROOF_OUT` optionally selects the artifact parent; each run allocates a fresh child. The script generates the fixture itself and verifies it through the actual app. It does not alter repository source files or contact a real Gateway.

## Artifacts

- [Reproduction script](proof-history.mts)
- [Synthetic fixture](fixture.json)
- [Raw scan results and assertions](results.json)
- `*.trace.json`: Chrome-compatible User Timing spans from the running browser (not a full CPU trace).
- [Stock rendered UI](0-stock.png) / [guard rendered UI](1-guard.png): inspected captures, same answer state; screenshots establish rendering, not timing.
