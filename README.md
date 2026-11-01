# iOS history proof — 1 November 2026

Synthetic local fixtures only. Inspected screenshots; no real conversation data.

- Before latest-output: cde4f192254 (main plus independent scroll follow-state PR165948).
- After latest-output and uneven prepend:220cf377be6, PR163153 rebased on d20f161513f.
- Five-turn reply:4e2f760e6f8. Product source unchanged from220cf377be6; only the test opens the nested result disclosure before exercising persistence.
- CI-mode:GITHUB_ACTIONS=true, Xcode27.1, pinned Swift tools, simulator MarvinIOSVerification. No Watch omission or testing-only source changes. This is not strict normal-local-build or phone proof.

Measured prepend results on220cf377be6:

```text
PREPEND_PROBE decelerating gestures=3 onScreen=true kept=true drift=0 visibleBefore=499-501 visibleAfter=498-501
PREPEND_PROBE ticking-below gestures=0 onScreen=true kept=true drift=0 visibleBefore=499-501 visibleAfter=498-501
PREPEND_PROBE uneven gestures=0 onScreen=true kept=true drift=0 visibleBefore=499-501 visibleAfter=499-501
```

Empty-projected-page continuation and latest-output restoration also passed. The initial fold test failed before its five-turn assertion because it omitted the nested tool-result disclosure step used by the existing upstream test. Adding that step, without weakening the persistence assertion, passed on4e2f760e6f8. The five-turn screenshot shows the fifth reply, not the earlier offscreen fold; its retained open state is checked by the test.

The before/after latest-output screenshots are context, not a claim of visual performance measurement. The measured reader-row assertions establish the prepend result. Prior historical evidence and unresolved historical issues remain qualified in the PR body.
