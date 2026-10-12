# Native app run for openclaw/openclaw#169197

Head under test: `3bb9847edda3d3a16a6387ac07cdcc3692692690`, built for the iPhone 17 simulator with the diagnostic harness in `diagnostic-harness.patch` applied on top (log markers and a synthetic 40-session roster; no product logic changes).

The native UI test `testPerformanceReviewProof` opens the populated drawer, opens a session menu, selects a session, reopens the drawer, switches Dynamic Type to extra-extra-extra-large, replaces the roster and restores small type. It passed (1 test, 0 failures, 25.7 s). The 20 `OpenClawTypographyTests` passed in the same run.

## Runtime markers (`runtime-perfproof.log`, 5,566 lines)

| Marker | Count |
|---|---|
| Sidebar body evaluations | 28 |
| Alias lookups served from the cache | 428 |
| Alias lookups computed | 9 |
| Alias cache invalidations on a 40-row roster change | 3 |
| Fonts served from the cache | 5,026 |
| Fonts constructed | 61 |
| Session selections | 1 |
| Roster replacement requests | 1 |

Fonts are constructed again after the switch to extra-extra-extra-large, and the small-category entries are reused after the switch back. Alias lookups are computed again after the roster replacement.

## Screenshots (in capture order)

1. `01-proof-populated-drawer-small.png`: 40-session drawer at small type.
2. `02-proof-session-menu.png`: long-press session menu.
3. `03-proof-selected-chat.png`: selected chat.
4. `04-proof-selection-retained-reopen.png`: selection retained on reopening the drawer.
5. `05-proof-large-type.png`: extra-extra-extra-large type.
6. `06-proof-roster-replaced-selection-retained.png`: selection retained after roster replacement.
7. `07-proof-small-type-restored.png`: small type restored.

`recording.mov` is the 38 s simulator recording of the same run.
