# macOS proof for OpenClaw PR #181551

Prepared October 23, 2026. AI-assisted validation; no source changes or public writes.

## Revisions and environment

- PR head: `00d27c442c5d8b8886f6e40c22b41b241f366c96`.
- Stock control: `ded4d430df859f35599fbb4d0ef32d8dec31e3b5`, the merge base of the head and the PR's observed base ref `7204b8c1c5f98ef24ffa7c25db0574e7084d4db6`.
- macOS 26.6.1 (25G76), ARM64; Node 26.12.1; V8 14.6.202.34-node.40; libuv 1.53.0.
- Separate detached worktrees, identical lockfile, cloned dependencies plus workspace dependency links. Stock borrows the proof tree's dependency directory for direct Node execution; neither install is reconciled during runs.
- All heavy work ran at nice 15, with one Vitest worker and GOMAXPROCS/RAYON/UV thread caps of 2. Host load was not controlled; timings are not performance comparisons.
- Fresh HOME, state, config, workspace and caches for each Gateway; loopback-only ephemeral ports. Channels, plugins, cron, browser, discovery and startup update checks disabled. No custom provider configuration, provider credentials or model requests were supplied. No production config, state, credentials or Gateway process were used.

## macOS-host red/green regression

Command in the head worktree:

```sh
OPENCLAW_VITEST_RUNTIME=node nice -n 15 node scripts/run-vitest.mjs \
  src/logging/diagnostic-stall-flight-recorder.test.ts \
  src/gateway/server/event-loop-health.test.ts --maxWorkers=1
```

| Source | Gateway tests | Recorder tests | Exit |
|---|---:|---:|---:|
| PR head | 20 passed | 13 passed | 0 |
| Stock recorder source, PR tests retained | 20 passed | 12 passed, 1 failed | 1 |

Patched command elapsed 51.72s; stock-source command 50.64s (including worker preparation).

```text
FAIL ... > never starts the automatic native sampler on macOS
AssertionError: expected 'windowMs=1600 samples=2 intervalMs=10…' to be undefined
  expect(sampleAt(6_500)).toBeUndefined();
```

A clean PR checkout has nothing to stash. To exercise the requested source-only stash workflow, the harness first restored only the recorder from the stock base, stashed that inverse source change, applied its exact stash hash for the red run, then restored HEAD in a finally block. Tests were never stashed. Exact commands are in `repro/run-tests.py`; both worktrees are tracked-clean.

**Scope:** the recorder suite mocks platform, runtime and native profiler APIs. Running it on macOS validates the regression on a macOS host, not real native-profiler behavior. The following Gateway evidence uses the actual darwin/Node/V8 runtime without mocking its profiler.

## Actual isolated Gateway comparison

Entry point (each tree's actual CLI, not a standalone monitor):

```sh
node --import "$TREE/scripts/tsx.mjs" --import "$PROOF/gateway-hook.mjs" \
  "$TREE/src/entry.ts" gateway run --port "$PORT" --bind loopback
```

Readiness budget: 660 seconds. After /readyz returned HTTP 200, captured `sample PID 5 -file ...`, induced one named 1,500ms main-thread busy loop, observed HTTP health for 25 seconds, captured another five-second native sample, then sent SIGTERM **only to the Gateway PID**. The hook calls no profiler API and replaces no Gateway implementation; it only invokes the existing task-attribution scope around the synthetic block.

| Observed behavior | Stock base | PR head |
|---|---:|---:|
| /readyz HTTP 200, ready/coreReady true | yes (59.75s) | yes (60.89s) |
| macOS recorder-unavailable warning count | 0 | 1 |
| v8:ProfEvntProc in native sample before block | present | absent |
| v8:ProfEvntProc in native sample after block | present | absent |
| Named callback-stall log | yes | yes |
| /readyz contains event-loop-delay health after block | yes | yes |
| Final /readyz and /healthz HTTP 200 | yes | yes |
| SIGTERM shutdown completed cleanly, exit 0 | yes | yes |

Stock native sample excerpt:

```text
3368 Thread_205529574: v8:ProfEvntProc
```

Patched log excerpts:

```text
stall flight recorder unavailable: macos-native-profiler-deadlock-risk
main-thread stall: elapsedMs=1500 task="proof.synthetic-cpu-block" taskMs=1500
completed cleanly in 162ms
```

Patched /readyz after the synthetic block retained real health metrics:

```json
{
  "ready": true,
  "coreReady": true,
  "eventLoop": {
    "degraded": true,
    "degradedSinceMs": 1790,
    "reasons": [
      "event_loop_delay",
      "cpu"
    ],
    "intervalMs": 1789.8257500000036,
    "delayP99Ms": 1517.3,
    "delayMaxMs": 1517.3,
    "utilization": 0.85,
    "cpuCoreRatio": 2.228,
    "cpuBreakdown": {
      "mainThreadCoreRatio": 0.83,
      "hostUtilization": 0.941,
      "hostCpuCount": 10,
      "workerCoreRatio": 0.782,
      "otherThreadsCoreRatio": 0.616
    }
  }
}
```

Every native sample's complete thread-header inventory and profiler stack context are in `artifacts/{patched,stock}/sample-*-excerpt.txt`. Full redacted native samples are compressed beside those excerpts. Full logs, probe series, hook timestamps, exact commands/environment, configuration and exit codes are included.

### Setup and shutdown harness correction

The initial dependency clone omitted workspace node_modules links, and the test wrapper initially selected Bun; neither attempt is counted as a regression verdict. Workspace links were hydrated and Node was selected explicitly before the reported red/green run.

The first matched Gateway pair already showed the same profiler-thread contrast, callback attribution and health telemetry. Its process-group SIGTERM also killed the tsx/esbuild loader before a lazy shutdown import, logging `TransformError: The service is no longer running`, although both Gateways then exited 0 and logged clean shutdown. Both cases were repeated with PID-only SIGTERM. The table above reports that corrected pair; initial logs/results are retained under `artifacts/initial-group-signal/`.

## What this establishes, and what it does not

This demonstrates actual macOS Node 26 Gateway startup, live health sampling, callback-stall diagnostics and clean shutdown at the reviewed head. The stock-versus-patched native thread contrast independently confirms removal of the automatic profiler exposure in this scenario.

It does **not** reproduce or repair the reported native Gateway deadlock, establish SIGPROF as its cause, prove long-duration stability, validate manual on-demand profiling, or exercise channels/model traffic. Both stock and patched Gateways completed this short scenario. The CLI ran from source with tsx, not a release distribution.

## Supporting reduction (separate evidence, not Gateway proof)

The earlier standalone C++ pthread reduction retained four blocked rwlock waiters with SIGPROF at requested 10,000us and 10us intervals. The no-signal rwlock control completed 374,746,843 operations; the signaled ordinary-mutex control completed 448,480,815. Samples show rwlock read/write waits. A watchdog negative/healthy control checked that the no-progress observer recognizes intentionally stuck versus completing processes. Short Node MessagePort churn controls (profiling off, single profile, rotating profiles) all completed: they did not reproduce the hang. These earlier artifacts and reduction source are included in `supporting/`; they are not substituted for the Gateway runs above.

## Reproduction and artifacts

Set `PROOF_PATCHED_TREE` and `PROOF_STOCK_TREE` to checkouts of the two pinned revisions with working dependencies, and `PROOF_OUTPUT_DIR` to a new scratch output directory. Then run sequentially:

```sh
nice -n 15 python3 repro/run-tests.py
nice -n 15 python3 repro/run-gateways.py
```

These portable copies change only hard-coded local path/output selection from the executed harnesses. The Gateway runner uses only fresh state and cleans up only its own child processes. The test runner leaves an inverse source-only stash for inspection and restores HEAD even on failure.

Only upload the public archive or the listed public files. The local `private/` working directory is excluded. Paths/user/host identifiers, the irrelevant default model label, and the synthetic fixture token were redacted, not behavior, counts, timing, SHAs or diagnostic values. SHA256SUMS hashes the delivered public artifacts.
