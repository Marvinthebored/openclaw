# iOS personal pin evidence

Preserved simulator acceptance, November 15, 2026. The acceptance candidate included the family-placement branch plus the personal-pin patch; it is not an exact-head test of the standalone PR. The screenshots below demonstrate personal pin persistence, not child-placement policy.

- Stable onboarding and history creation preceded candidate installation without erasing simulator data.
- `preserved-history.png` shows the retained history and connected state after upgrade.
- `personal-pin-after-relaunch.png` shows the test session under Pinned with an Unpin action after app termination/relaunch.
- Independent read-only Gateway SQLite observations correlated the session key to this displayed test title and the authenticated profile's `ui.railShortcuts`. The profile identifier and email are omitted below.

```text
profile=<redacted authenticated profile>
ui.railShortcuts=["session:agent:main:ios-9eb8d209-2c66-439b-902a-460871897635"]
session.key=agent:main:ios-9eb8d209-2c66-439b-902a-460871897635
session.display_name=Family server pin r6 20261115
session.pinned_at=NULL
session.entry_json.pinned=NULL
```

A preceding preserved-simulator run exercised unpin and independently observed an empty shortcut array afterward. The acceptance runs passed one XCTest each with lint bypass enabled; they are behavior evidence, not lint proof.

The separate final-source native-validation.txt records 13 preference tests and 19 simulator tests with lint enabled on Xcode 27.2. The final apps patch SHA-256 was 419dd8fc458b616ea4eb93266279988eabdc148a095c9b274be3cb20e7088d80.

Limits: no two-profile isolation or cross-client refresh was exercised. Existing personal shortcuts and legacy shared pins were not seeded before the stable upgrade, so this does not prove that migration scenario. No physical phone or production Gateway was used.

AI-assisted work record: the implementation received two independent local review passes; mixed-array compare-and-set decoding, idempotent ordering, empty keys and post-save refresh errors were addressed. Upstream's profileless-response finding was repaired and validated in the final lint-enabled run. Product approval of the shared-to-personal cutover remains a maintainer decision.
