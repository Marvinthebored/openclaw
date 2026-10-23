# Chat narration behavior validation

## Built Control UI entry point

The repository's UI end-to-end harness builds the production Control UI bundle and serves its actual chat route. A mocked Gateway supplies only synthetic messages: a user request, first finding, read call and result, second finding, another read call and result, and a final answer.

- Before: one collapsed completed-work disclosure hides both findings.
- After: both findings remain visible, with two independent work disclosures.
- Expanding the first disclosure leaves the second collapsed.
- Transcript search locates the first finding. Its context-menu Reply action puts that finding in the composer quote. Closing search restores the conversation with the quote retained.
- The final answer retains its footer and reply/copy actions.

Screenshots are full-page browser captures at 1440 × 1100. All transcript content is synthetic. PNG chunks were inspected before publication; no text, EXIF, or other personal metadata is present.

The reproduction harness is saved alongside this record as `chat-work-proof.e2e.test.ts`. Run it from `ui/src/e2e/` with `CHAT_PROOF_OUT` naming an output directory; set `CHAT_PROOF_BASELINE=1` for the baseline.

```sh
node scripts/run-vitest.mjs run --config test/vitest/vitest.ui-e2e.config.ts --configLoader runner ui/src/e2e/chat-work-proof.e2e.test.ts --maxWorkers=1
```

## Focused web validation

```text
Test Files  14 passed (14)
     Tests  322 passed (322)

Chromium
Test Files  1 passed (1)
     Tests  4 passed (4)

Async-question bundled e2e
Test Files  1 passed (1)
     Tests  15 passed (15)
```

Chat test typecheck completes with no diagnostics. Scoped lint reports zero warnings and errors.

Recorded skipped-outcome regression: without the production repair, one test fails and 39 are skipped. With the repair, all 40 work-chunk tests pass, including dispatcher display and expanded-card copies.

## Native validation

```sh
swift test --filter 'ChatWorkChunksTests|ChatCompletedWorkTests|ChatAssistantRunGroupTests|ChatToolActivityTests'
```

```text
✔ Test run with 41 tests in 4 suites passed
```

Both Swift and TypeScript suites consume `test/fixtures/chat-work-chunks.json`, including provider-envelope Markdown cases.
