# Composer visual proof

All images are 50% device scale, cropped to the composer plus surrounding pane edge. Synthetic Lorem Ipsum and short Line 1–Line 20 prose only. Captured from the rebuilt production-bundle preview.

Empty; a few lines; actual border drag narrower (editor159→201px); actual border drag wider (201→159px);20 numbered lines at pane bound (618px editor,684px content); phone editing on the current mobile toolbar (346px editor,915px content, send button visible); New Session pane bound (495px editor,684px content).

Images inspected individually. Earlier captures with no actual overflow were rejected. No screenshot claims requesting-viewer delivery or real Gateway behavior; upgrade proof is separate.

Real stable 2026.10.7 to rebuilt candidate Gateway: existing width and exact draft survived on the same origin and persistent browser profile, without reseeding storage. candidate-upgrade.json records the tested pre-commit working-tree build; the publication commit contains those same three repairs. The scratch Gateway was stopped afterward.

Validation: 366 units, 38 composer Chromium cases, 20 production-bundle E2E cases, 19 guards, four typecheck projects, lint/style/format/controller checks. Official base comparison passed: +13 raw CSS bytes (64-byte allowance). Full UI shards were not run locally.
