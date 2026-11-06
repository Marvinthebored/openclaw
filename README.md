# Runtime proof for openclaw/openclaw#193869

Two isolated, throwaway gateways ran on one host with the same config overlay:
`session.maintenance = { mode: "enforce", maxEntries: 2 }`.

- **Red:** upstream main `95a3ccde141` plus other pending patches. None of them touch the subagent registry or session maintenance.
- **Green:** the red build plus this PR's source change, and nothing else.

The parent ran on the Claude CLI. Each child used `cleanup: "keep"`. A cap pass runs when a session is created. So in each scenario a side session was created while the parent was still busy or yielded, which means the requester wake was still owed.

| File | What it shows |
|---|---|
| `runtime-proof.json` | Per-run timeline: when cleanup completed, when the row was deleted, the wake state at deletion, and when the wake settled and the row was released |
| `deleted-archives-red.txt`, `deleted-archives-green.txt` | Transcript archive timestamps that maintenance wrote when it deleted each session row (UTC) |
| `R5-red-no-session-found.png` | Red. The resumed parent calls `sessions_history` on its kept child and gets `No session found` |
| `G5-green-history-ok.png` | Green. The same step succeeds |

## How to match the files

The red row deletions at 06:12:36, 06:14:10, 06:15:11, 06:15:51 and 06:16:40 UTC happened while the wake was `pending` or `dispatching`. That is before settlement.

The green deletions of the same children happened about 2 s *after* the wake settled. They are at 06:13:34, 06:15:27 and 06:16:56 UTC.

Times in `runtime-proof.json` are UTC+8.

## Gap

These runs show that the kept session goes missing. They did not log a policy rejection where the request fails closed. The PR's completion test covers the policy-snapshot consequence.
