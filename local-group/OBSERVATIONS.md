# Local-group creation through the native conversation menu

Candidate: `4460dbd8bf00d12720104c9c2d79448b68572173`. Recorded October 10, 2026.

One XCUITest exercised the native iPhone simulator app with the existing synthetic drawer fixture. Its transport advertised only `sessions.patch`, with no group-catalog methods. The run checked all 60 candidate-file hashes before adding transport instrumentation and the single UI test. The three repaired production files were unchanged.

## Observed flow

1. The sidebar initially showed **Project notes** in **Projects**.
2. Long-pressing that conversation, then **Move to Group**, exposed an enabled **New Group…** action.
3. Entering **Local Proof** and tapping **Create** dismissed the editor. The sidebar displayed **Project notes** under **Local Proof**.
4. Collapsing that group hid the conversation; expanding it restored the conversation, confirming group membership.
5. Terminating and relaunching the app retained the locally remembered **Local Proof** group. The fixture reseeds conversation categories on launch; the relaunch assertion checks the remembered group independently of those seeded conversations.

[Before](local-group-before.png) · [Enabled New Group](local-group-menu-enabled.png) · [Created group and moved conversation](local-group-created-and-moved.png)

## Independent saved-state inspection

After the test terminated the app, a separate Python process read the simulator preferences. The [receipt](independent-receipt.json) contains exactly one `sessions.patch`, the selected fixture session identity, the mutated category **Local Proof**, and `openclaw:sessions:custom-groups = ["Local Proof"]` after relaunch. No group-catalog request occurred.

## Result and scope

[Raw UI-test output](ui-test.log): **1 test passed, 0 failures**, 36.845 seconds. The incremental Xcode build-and-test command took 83.8 seconds. [Runner result](terminal.json) confirms candidate hashes were restored after the harness overlays. This run covers the changed session-row local-group path using the catalog-free fixture transport.
