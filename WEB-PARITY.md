# Public-source context for personal pins (199685)

Inspected local public commit 669ae72f7a9bbd48daf36b66ee2e044d32ea7353 on 18 November. No production or private maintainer discussion is used for this rationale.

- Existing web `personalSessionPinKeys` explicitly maps non-rail `session:` shortcuts to the Sessions Pinned section: https://github.com/openclaw/openclaw/blob/669ae72f7a9bbd48daf36b66ee2e044d32ea7353/ui/src/app-navigation.ts#L125-L136
- Existing web sidebar projection derives pinned keys from `host.sidebarEntries`, rather than treating shared session metadata as personal pin ownership: https://github.com/openclaw/openclaw/blob/669ae72f7a9bbd48daf36b66ee2e044d32ea7353/ui/src/components/sidebar-projection-memo.ts#L162-L170
- Public web navigation preference tests store those entries under `ui.railShortcuts` and distinguish profiles a/b: https://github.com/openclaw/openclaw/blob/669ae72f7a9bbd48daf36b66ee2e044d32ea7353/ui/src/app/server-prefs.navigation-intent.test.ts#L12-L79

Proposed durable PR context: This brings native session pins into parity with web profile-owned navigation. It does not introduce a new shared-pin product. Shared metadata remains stored; existing legacy shared pins are not implicitly imported into a user's shortcuts. That native presentation change and profileless behavior still need explicit, accurate evidence; parity does not prove compatibility or maintainer approval.

These are source observations, not native isolation/cross-client runtime proof. Publish the context with the new evidence after verification.
