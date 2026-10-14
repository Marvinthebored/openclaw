# Parallel tool-result validation

Focused Swift tests and a synthetic iOS Simulator fixture. Raw excerpts below.

## red-kit

```text
✘ Test "parallel results" recorded an issue at ChatToolResultIngestionTests.swift:45:9: Expectation failed: (messages.map(\.role) → ["user"]) == ["toolResult", "toolResult"]
✘ Test "parallel results" recorded an issue at ChatToolResultIngestionTests.swift:46:9: Expectation failed: (messages.map(\.toolCallId) → [nil]) == (["a", "b"] → [Optional("a"), Optional("b")])
✘ Test "parallel results" recorded an issue at ChatToolResultIngestionTests.swift:47:9: Expectation failed: (messages.map(\.toolName) → [nil]) == (["exec", "read"] → [Optional("exec"), Optional("read")])
✘ Test run with 14 tests in 1 suite failed after 0.042 seconds with 51 issues.
```

## red-outbox

```text
✘ Test "history result carriers retain canonical cache tips and active-path ancestry" recorded an issue at ChatToolResultIngestionTests.swift:518:9: Expectation failed: (recorded.lastActiveLeafEntryID → "opaque:tool-result:7:tool-result:1") == (carrierID → "opaque:tool-result:7")
✘ Test "session result carriers retain canonical tips for background branch reconciliation" recorded an issue at ChatToolResultIngestionTests.swift:487:9: Expectation failed: (state.lastActiveLeafEntryID → "opaque:tool-result:7:tool-result:1") == (carrierID → "opaque:tool-result:7")
✘ Test "session result carriers retain canonical tips for background branch reconciliation" recorded an issue at ChatToolResultIngestionTests.swift:500:9: Expectation failed: await store.loadCommands().map(\.status) == [.queued]
✘ Test run with 2 tests in 1 suite failed after 0.025 seconds with 6 issues.
```

## red-order

```text
✘ Test "mixed carrier results precede an adopted optimistic user" recorded an issue at ChatToolResultIngestionTests.swift:161:13: Expectation failed: (vm.messages.map(\.role) → ["assistant", "user"]) == ["assistant", "toolResult", "toolResult", "user"]
✘ Test "mixed carrier results precede an adopted optimistic user" recorded an issue at ChatToolResultIngestionTests.swift:167:13: Expectation failed: (merged.first?.content.filter(\.isToolResult).map(\.text) → []) == (["Alpha output", "Beta output"] → [Optional("Alpha output"), Optional("Beta output")])
✘ Test "mixed carrier results precede an adopted optimistic user" recorded an issue at ChatToolResultIngestionTests.swift:161:13: Expectation failed: (vm.messages.map(\.role) → ["assistant", "user"]) == ["assistant", "toolResult", "toolResult", "user"]
✘ Test run with 1 test in 1 suite failed after 0.008 seconds with 4 issues.
```

## green-kit

```text
✔ Test run with 373 tests in 4 suites passed after 1.207 seconds.
```

## red-ui

```text
apps/ios/UITests/OpenClawSnapshotUITests.swift:58: error: -[OpenClawUITests.OpenClawSnapshotUITests testParallelToolResultsIngestion] : XCTAssertTrue failed
** TEST EXECUTE FAILED **
```

## green-ui

```text
** TEST EXECUTE SUCCEEDED **
```

## red-boundary

```text
✘ Test "carrier turn boundary has one owner" recorded an issue at ChatToolResultIngestionTests.swift:194:9: Expectation failed: (pureMessages.map(\.turnBoundary) → [nil, Optional(true), Optional(true)]) == ([nil, true, nil] → [nil, Optional(true), nil])
✘ Test "carrier turn boundary has one owner" recorded an issue at ChatToolResultIngestionTests.swift:200:9: Expectation failed: (pureRows.filter(\.startsTurn).count → 2) == 1
✘ Test "carrier turn boundary has one owner" recorded an issue at ChatToolResultIngestionTests.swift:201:9: Expectation failed: (ChatTranscriptRow.collapseCompletedWork(pureRows, runWorking: false)
✘ Test run with 1 test in 1 suite failed after 0.005 seconds with 9 issues.
```

## green-boundary

```text
✔ Test run with 28 tests in 3 suites passed after 0.038 seconds.
```

## green-ui

```text
** TEST EXECUTE SUCCEEDED **
```

## lint-delta

```text
SCOPED_LINT_BASE 0 SCOPED_LINT_PATCHED 0 NEW_FINDINGS 0
```

## i18n

```text
native-app-i18n: entries=4482 changed=false
```
