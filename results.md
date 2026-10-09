# Sub-session folding proof

Source head: 8fb895f2b9a7899e661d0e5666d95545cd4a0ea1

## red-unit
```text
✘ Test "pinned parent keeps children in one tree rather than duplicate page roots" recorded an issue at SubsessionFoldingTests.swift:16:9: Expectation failed: (layout.pinnedNodes.map(\.id) → ["parent", "child"]) == ["parent"]
✘ Test "pinned descendant branches retain their ancestry for independent folding" recorded an issue at SubsessionFoldingTests.swift:32:9: Expectation failed: (layout.pinnedNodes.map(\.id) → ["parent", "child", "grandchild"]) == ["parent"]
✘ Test run with 2 tests in 1 suite failed after 0.012 seconds with 2 issues.
```

## red-shared
```text
✘ Test "uncategorized child stays under grouped parent rather than becoming a recent root" recorded an issue at ChatSessionSidebarModelTests.swift:19:9: Expectation failed: (group.nodes.first?.children.map(\.id) → []) == ["child"]
✘ Test "uncategorized child stays under grouped parent rather than becoming a recent root" recorded an issue at ChatSessionSidebarModelTests.swift:20:9: Expectation failed: !(sections.contains { $0.id == "recent" } → <not evaluated>)
✘ Test run with 56 tests in 1 suite failed after 0.026 seconds with 2 issues.
```

## red-ui
```text
/Users/sanae/src/openclaw-subsession-fold-20261009/apps/ios/UITests/OpenClawSnapshotUITests.swift:171: error: -[OpenClawUITests.OpenClawSnapshotUITests testSubsessionFolding] : XCTAssertTrue failed - Parent must offer a child-fold caret
```

## green-unit
```text
✔ Test run with 48 tests in 7 suites passed after 4.184 seconds.
```

## green-shared
```text
✔ Test run with 56 tests in 1 suite passed after 0.027 seconds.
```

## green-iphone-ui
```text
	 Executed 3 tests, with 0 failures (0 unexpected) in 87.411 (87.413) seconds
	 Executed 3 tests, with 0 failures (0 unexpected) in 87.411 (87.414) seconds
	 Executed 3 tests, with 0 failures (0 unexpected) in 87.411 (87.414) seconds
```

## green-ipad-ui
```text
	 Executed 3 tests, with 0 failures (0 unexpected) in 82.775 (82.776) seconds
	 Executed 3 tests, with 0 failures (0 unexpected) in 82.775 (82.777) seconds
	 Executed 3 tests, with 0 failures (0 unexpected) in 82.775 (82.779) seconds
```

## kit-full
```text
	 Executed 61 tests, with 2 tests skipped and 0 failures (0 unexpected) in 0.209 (0.211) seconds
	 Executed 61 tests, with 2 tests skipped and 0 failures (0 unexpected) in 0.209 (0.212) seconds
✔ Test run with 2302 tests in 194 suites passed after 32.712 seconds.
```

## Real Gateway
```text
	 Executed 1 test, with 0 failures (0 unexpected) in 28.201 (28.202) seconds
	 Executed 1 test, with 0 failures (0 unexpected) in 28.201 (28.203) seconds
	 Executed 1 test, with 0 failures (0 unexpected) in 28.201 (28.204) seconds
** TEST EXECUTE SUCCEEDED **
```
