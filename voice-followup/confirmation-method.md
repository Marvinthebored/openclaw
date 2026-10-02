# Chat-backed omitted-ID confirmation: final-effect evidence

Source head: `458f5345d53fdc5277aeaf2ee9a0bdf0586da886`. Gateway/confirmation/tool production files were unchanged during this proof. Their exact SHA-256 hashes and empty diff are recorded in `confirmation-source-manifest.json`. Concurrent Swift startup repair is outside this evidence.

## Result

Final run: **5/5 passed**, 13.06 seconds total. See `confirmation-effects.txt` for captured terminal output and per-case JSON, including the bytes actually read back from the task-local sentinel file.

| Case | Final I/O entries | File effect |
|---|---:|---|
| Exact saved affirmative, omitted ID | 1 | Exact original JSON action once |
| Another voice session scope | 0 | File does not exist |
| Changed action arguments | 0 | File does not exist |
| Same-run and fresh-run replay | 1 total | Original single row remains |
| Invalidation after grant validation, before binding | 0 | File does not exist |

All cases additionally assert the initial blocked action performs zero final I/O, and user speech `yes` is present in the durable session transcript. Both actual transcript RPC and consult RPC acknowledge successfully; denied actions are denied at the tool boundary, not incorrectly represented as failed consult admission.

## Executed production composition

1. Create a task-isolated OpenClaw SQLite/state fixture and transcript-capable client voice session.
2. Execute the real `wrapToolWithBeforeToolCallHook` with a mutation-classified `sessions_spawn` action. This establishes the original exact-action challenge and proves its first attempted execution cannot enter the I/O callback.
3. Submit synthetic recognized user speech through **actual `talk.client.transcript` handler**, real append queue, persisted transcript receipt and host-observed confirmation readiness. Read durable transcript events back.
4. Submit **actual `talk.client.toolCall` handler** with no `confirmationId`, triggering the newly changed omitted-ID authorization route.
5. Run **real `startTalkRealtimeAgentConsult`, `handleTrustedInternalChatSend`, chat admission/ACK and detached `startChatDispatch`**. No mock replaces those functions. Actual production onRunStarted registers the voice run and binds the grant.
6. At `dispatchInboundMessageWithProjectedDispatcher`, replace provider/model inference plus auto-reply orchestration with a deterministic action-selection adapter. It takes the real admitted runId and **executes** the production tool wrapper; it is not an assertion on a mocked dispatch call.
7. The tool wrapper runs the real initial voice check and final canonical-params one-shot consume. Only its final tool implementation is a safe task-local `fs.appendFile` sentinel. Assertions observe both callback entry count and independently read exact file bytes, or assert no file exists.

The invalidation case instruments `chatRunState.getOrCreate` to invalidate the utterance after omitted-ID grant validation and before onRunStarted binding. It leaves handler/binding/guard production code unchanged. A ten-millisecond host-clock offset models strictly later speech deterministically; no sleeps or expiry extension. Replay includes a repeated same-run tool execution and a fresh registered run attempting the same action without fresh speech. Other voice scope uses a second real voice-session record.

## Limits (do not overclaim)

This is **synthetic isolated runtime evidence**, not live-provider/physical voice acceptance. No provider calls, network actions, actual delegated sessions, microphone/audio transcription, WebSocket authentication handshake, or deployed candidate were exercised. Request authority is a synthetic internal test fixture. The actual initial host challenge is established through the production tool wrapper, not a first full chat model turn; final response publication of that challenge remains covered by existing adjacent tests, not this record. Replay attempts after the admitted follow-up use the production tool wrapper plus real run registration directly, not another full RPC.

The auto-reply/model dispatcher is substituted, not the chat handler/admission pipeline. The final sentinel implements a mutation-classified tool with real local file I/O instead of real `sessions_spawn` side effects. This establishes the production confirmation **guard and one-shot final-I/O contract**, not the downstream implementation correctness of every real high-impact tool. It does not close the separate live-provider voice/audio evidence gap.

## Reproduce (standalone, not shipped suite)

Harness is retained here, not added to the contributor production/test diff. In the same source checkout with its existing installed dependencies, copy `confirmation-chat-effect.evidence.test.ts` to `src/talk/confirmation-chat-effect.evidence.test.ts`, then run:

```sh
node node_modules/vitest/vitest.mjs run src/talk/confirmation-chat-effect.evidence.test.ts --maxWorkers=1
```

Remove the task-only harness after running it. No product or shipped test changes were required for this proof.
