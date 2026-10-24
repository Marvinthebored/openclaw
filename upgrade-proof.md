# Rebased iOS parallel-result upgrade verification

Source commit: d62dfc6241cd410c9997a4451a616f31f48eafd6

Verified 2026-10-24 using synthetic data only. Native simulator install of v2026.10.3 followed by the rebased app without uninstalling; persisted cache, queued commands, attachments and settings were retained.

The regression red control changes only the optional carrier decoder to strict decoding. It fails with keyNotFound; the tolerant decoder passes all 16 focused ingestion tests. This control demonstrates legacy-field compatibility, not stock parallel-result rendering.

## Strict-decoder red control

```text
◇ Test "v2026_10_3 cached messages decode without carrier field" started.
✘ Test "v2026_10_3 cached messages decode without carrier field" recorded an issue at ChatToolResultIngestionTests.swift:43:6: Caught error: DecodingError.keyNotFound: Key 'toolResultCarrierTranscriptMessageID' not found in keyed decoding container. Path: [0]. Debug description: No value associated with key CodingKeys(stringValue: "toolResultCarrierTranscriptMessageID", intValue: nil) ("toolResultCarrierTranscriptMessageID").
✘ Test "v2026_10_3 cached messages decode without carrier field" failed after 0.001 seconds with 1 issue.
✘ Test run with 1 test in 1 suite failed after 0.001 seconds with 1 issue.
```

## Focused green summary

```text
✔ Test "history result carriers retain canonical cache tips and active-path ancestry" passed after 0.038 seconds.
✔ Suite ChatToolResultIngestionTests passed after 0.038 seconds.
✔ Test run with 16 tests in 1 suite passed after 0.038 seconds.
```

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
SAME_APP_DATA_CONTAINER_PASS stable-data-carried-over old=B4C48B22-0D10-4B1A-A232-9732F067559D new=B4F57D4B-AEC9-42EF-9BD4-702EC2CC4ED6
STAGE=head
SYNTHETIC_DATA_ONLY
CACHE_LOAD_PASS rows=3 prompt=UPGRADE_CACHED_PROMPT canonical-tip=synthetic-carrier-7
OUTBOX_LOAD_PASS count=2 status=queued text+attachments+thinking+permission-settings=preserved branch-epoch=0 canonical-tip=synthetic-carrier-7
SETTINGS_PASS appearance.preference=dark gateway.onboardingComplete=true
NATIVE_MODEL_PASS cached prompt and two queued bubbles restored
NEW_CARRIER_FIELD_PASS SQLite encode/decode retains canonical carrier on both expanded outputs
ANCESTRY_PASS stable carrier -> synthetic-next-leaf epoch=0 queued=2 oldest-command-claim=synthetic-queued-1
UPGRADE_PROOF_PASS
IN_PLACE_STABLE_UPGRADE_PASS
```
