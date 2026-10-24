# Native v2026.10.6 persisted-state upgrade verification

Stable tag: v2026.10.6 (fe06181dc5ecc01cf8904abbfc26925925efefbc). Patched source: d62dfc6241cd410c9997a4451a616f31f48eafd6.

Synthetic data only. The stable app created the SQLite transcript cache, two queued commands with attachments and permission/thinking settings, and appearance/onboarding preferences. Installing the patched app over it without uninstalling retained the stored data. Both native models restored the cached prompt and two queued bubbles.

The upgraded decoder loads pre-change rows with the optional carrier-ID field absent (nil). After ingestion, both expanded outputs retain their canonical carrier IDs and pending-command branch ancestry remains at epoch 0.

The [v2026.10.3 upgrade proof](https://github.com/Marvinthebored/openclaw/blob/cbdace227f07e74aed8318598175387c01f2723e/upgrade-proof.md) also passed. The [legacy decoder regression](https://github.com/openclaw/openclaw/blob/d62dfc6241cd410c9997a4451a616f31f48eafd6/apps/shared/OpenClawKit/Tests/OpenClawKitTests/ChatToolResultIngestionTests.swift#L43) failed with keyNotFound under a strict decoder and passed with decodeIfPresent; all 16 ingestion tests passed in the verified r5 run.

## Native stable and upgraded app

```text
APP_BUILD_PASS stage=stable
INSTALL_PASS stage=stable bundle=ai.openclaw.proof.parallelresults.debug
STAGE=stable
SYNTHETIC_DATA_ONLY
CACHE_LOAD_PASS rows=3 prompt=UPGRADE_CACHED_PROMPT canonical-tip=synthetic-carrier-7
OUTBOX_LOAD_PASS count=2 status=queued text+attachments+thinking+permission-settings=preserved branch-epoch=0 canonical-tip=synthetic-carrier-7
SETTINGS_PASS appearance.preference=dark gateway.onboardingComplete=true
NATIVE_MODEL_PASS cached prompt and two queued bubbles restored
UPGRADE_PROOF_PASS
APP_BUILD_PASS stage=head
INSTALL_PASS stage=head bundle=ai.openclaw.proof.parallelresults.debug
SAME_APP_DATA_CONTAINER_PASS stable-data-carried-over old=CBEB9415-0961-4466-8232-05B012D17AEC new=0569DD06-46D3-475D-A483-7073F146B99F
STAGE=head
SYNTHETIC_DATA_ONLY
CACHE_LOAD_PASS rows=3 prompt=UPGRADE_CACHED_PROMPT canonical-tip=synthetic-carrier-7
OUTBOX_LOAD_PASS count=2 status=queued text+attachments+thinking+permission-settings=preserved branch-epoch=0 canonical-tip=synthetic-carrier-7
SETTINGS_PASS appearance.preference=dark gateway.onboardingComplete=true
NATIVE_MODEL_PASS cached prompt and two queued bubbles restored
LEGACY_MODEL_COMPATIBILITY_PASS pre-change cached carrier-ID field decoded as absent; existing stored rows loaded
NEW_CARRIER_FIELD_PASS SQLite encode/decode retains canonical carrier on both expanded outputs
ANCESTRY_PASS stable carrier -> synthetic-next-leaf epoch=0 queued=2 oldest-command-claim=synthetic-queued-1
UPGRADE_PROOF_PASS
IN_PLACE_STABLE_UPGRADE_PASS
```
