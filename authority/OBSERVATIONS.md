# Production WebKit authority-boundary proof

Candidate: `4460dbd8bf00d12720104c9c2d79448b68572173`.
Isolated Gateway runtime: `a79f8a114d9f6851b80da506b7c86564c797c042`.
Observed 2026-10-10 on iOS 26.5 simulator. No production source changes.

## Result

One targeted native test passed, zero failures (6.726 seconds). This uses the production `IOSSidebarPluginBridge`, production authenticated WebKit coordinator, candidate Control UI, real registered plugin owner, and a real isolated Gateway. No mocked RPC result or injected success receipt.

1. A current registered native action succeeds. Gateway invocation count becomes **1**.
2. A same-origin child `srcdoc` frame sends a forged newer registry snapshot through its actual WebKit frame handle. The production message handler rejects it with **Invalid plugin menu message**; the live revision is unchanged; Gateway count remains **1**.
3. A different WKWebView hosting `https://untrusted.invalid/` sends the forged snapshot to the production handler. It is rejected with **Invalid plugin menu message**; Gateway count remains **1**.
4. The real plugin owner unregisters and replaces its navigation registration. Both the held native action and old web command are rejected; Gateway count remains **1**.
5. After an actual WebKit reload creates a new document, replaying the old document's command with the current revision has no effect; Gateway count remains **1**.
6. A fresh current native action succeeds. Gateway invocation count becomes **2**.

The independently read [Gateway receipt](gateway-receipt.json) contains exactly `positive-before` and `positive-after`, authenticated as operator. No negative-case effect appears. Every intermediate count came from the plugin's read-only authenticated Gateway status method, not a UI counter.

## Reproduction and provenance

- [Native harness](SidebarPluginRuntimeProof.swift), [Gateway proof plugin](proof-plugin.mjs), and [registered UI fixture](proof-plugin-ui.js).
- [Complete runtime log](runtime.log) and [terminal result](terminal.json).
- [Candidate file hashes](manifest.json) and [candidate UI build receipt](ui-build-terminal.json). The parent independently rechecked all 5,426 production source hashes against the source manifest after the run; all matched. The native runner verified 52 Swift candidate hashes before the harness overlay and restored them afterward.
- Only `OpenClawTests/SidebarPluginRuntimeProof/testProductionAuthorityRejectsStaleAndUntrustedCallers` ran. The harness is evidence-only, outside the product patch.
- The frame probe is installed after initial navigation because the production coordinator refreshes its user scripts on navigation. The test-only probe captures the actual child `WKFrameInfo`; the forged message is then sent within that frame to the unchanged production handler. CSP, authentication, navigation policy, and bridge checks remain enabled and unchanged.
- Earlier harness attempts were rejected by CSP or lost their probe during normal script refresh. They are not counted as successful proof. The linked log and receipt are from the final passing run with fresh isolated Gateway state.

This proves the four named caller/lifetime rejection scenarios. Existing physical-device and rendered native-action evidence remain linked in the PR body.
