# Control UI resize-lag PR evidence

These clips were captured by the affected user on 27 September 2026 and posted with their permission. They are qualitative, real-use evidence for [openclaw/openclaw#159556](https://github.com/openclaw/openclaw/pull/159556).

- `before-resize-lag.mp4` — 13:38 HKT, before the patch was deployed (23.4 s, 792×892).
- `after-resize-fix.mp4` — 16:40 HKT, after the identical four-file patch was deployed by Doc as local commit `468c676827e` (16.36 s, 802×562).

The clips differ in viewport and interaction sequence; they are not a controlled timing benchmark. The PR body reports separate scripted before/after measurements on the same long session and resize sequence.
