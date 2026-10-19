# Isolated Gateway proof: foreground turn vs deferred context-engine maintenance

`run.mjs` starts a source-launched Gateway with its own HOME/state under `/tmp`, a loopback fixture model server (`fake-model.mjs`) and a context-engine plugin (`plugin/`) that declares `turnMaintenanceMode: "background"`. Its `maintain()` calls `runtimeContext.llm.complete(...)` with no abort handling. The fixture server holds any request containing `MAINT-PREP` open until released.

Scenario: turn 1 completes and starts the deferred maintenance; while its request is held open, turn 2 is sent to the same session. The script records when turn 2 reaches the model server, whether the held request was aborted, and when the engine was disposed. On the stock tree the script releases the held request after 40 s.

Run: `PATCHED_TREE=<checkout> STOCK_TREE=<checkout> node run.mjs <patched|stock> <1|2|final1|final2>`

| Tree | Run | Turn-2 admission | Held request aborted |
|---|---|---:|---|
| main `ecb279c9b54a` | red-1 | 40.806 s (held request released at the 40 s cap) | no |
| main `ecb279c9b54a` | red-2 | 42.263 s (held request released at the 40 s cap) | no |
| this change | green-final1 | 0.560 s | yes, engine disposed before admission |
| this change | green-final2 | 0.375 s | yes, engine disposed before admission |

Per-run summaries, plugin events and model-server events are in `runs/`.
