# Native persisted-state upgrade proof

Installed an app built from v2026.10.3, populated its SQLite transcript cache, queued messages with attachments and settings, then installed the patched app over it without deleting app data. Both apps ran the native persistence and chat-model paths in iOS Simulator using synthetic data. Simulator installation assigned a new container UUID; stable data was carried over and read by the patched app.

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
SAME_APP_DATA_CONTAINER_PASS stable-data-carried-over
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
