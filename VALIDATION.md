# Simulator validation

Synthetic long-chat fixture; no live messages or credentials.

R27: native build and full keyboard/send/manual departure/Jump/system-clock/Jump test PASS, 1 XCTest, 0 failures (63.454 seconds). R28: same product candidate, iPad column portrait/landscape PASS, 1 XCTest, 0 failures (44.826 seconds).

Before-keyboard is R18: content-size guard alone, keyboard open but latest absent. After-keyboard and after-clock are diagnostic-free R27: latest visible above keyboard; semantic clock tap physically leaves latest and exposes Jump. Before is an intermediate candidate, not a stock-main comparison.

Product delta reviewed independently by Codex and Muse Spark: neither found blocking issues. Published source differs from tested candidate only by whitespace formatting and removal of unused diagnostic clock helper tests; full acceptance test retained. Final second Jump checks button disappearance, not final-reply geometry. iPad coverage is column layout only. No macOS runtime or physical-device proof claimed.

Scoped SwiftLint 0.65.1: zero violations in three changed files. SwiftFormat 0.63.0 applied to three files; Swift frontend parse and git diff --check pass. R27/R28 native builds use lint bypass; the focused lint check was separate.
