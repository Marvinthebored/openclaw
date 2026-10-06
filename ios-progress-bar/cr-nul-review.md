No actionable bug found in the latest diff against `f8864e606c73210ea38b0570d48fbe80335de12f`. The CR crash correction and revised NUL mapping are consistent with the dependency contracts.

1. **Newly permitted states:** Lone-CR input now maps parser lines correctly; CRLF advances one line. NUL-containing input now protects code without falsely hiding adjacent real bars. Progress-tag syntax and accepted attributes remain unchanged.

2. **Concurrency and atomicity:** Parsing, maps, and ranges are local to each synchronous initializer call. The change introduces no shared mutable state, suspension, or partially published result.

3. **Caller/self binding:** The caller still supplies the original Markdown. `Document` receives the expanded source, and its offsets map back to that same original input. UTF-8 columns match the byte-based map. Mapping all three replacement bytes to one original NUL correctly handles both endpoints. EOF is safe because the exclusive end uses the preceding byte; empty input has no protected nodes, and empty code content still has a nonempty source span containing its delimiters. Dependency evidence: [UTF-8 locations](https://raw.githubusercontent.com/swiftlang/swift-markdown/0.9.0/Sources/Markdown/Infrastructure/SourceLocation.swift), [range conversion](https://raw.githubusercontent.com/swiftlang/swift-markdown/0.9.0/Sources/Markdown/Parser/CommonMarkConverter.swift), [newline and NUL handling](https://raw.githubusercontent.com/swiftlang/swift-cmark/08ddb528923cc1a6527e02b7a1aee9e516ca749a/src/blocks.c).

4. **Doc instructions:** The added comments accurately explain the dependency behavior and mapping. No user-facing configuration or instructions change. Expansion is confined to parsing; output still uses original text. Existing removal of matched tags and trimming of outer newlines remain unchanged.

5. **Tests absent versus present:** Tests are present for exact `First\r` inline code, all three newline variants, literal-code preservation, real extraction, and both NUL false-bar and missed-bar regressions. Dedicated multibyte UTF-8, repeated/interior NUL, empty-input, and trailing-blank EOF cases are absent; that is coverage information, not evidence of a defect. String equality checks preservation but do not explicitly assert byte equality.

Read-only review completed. No autoreview, delegation, edits, builds, or tests were run.