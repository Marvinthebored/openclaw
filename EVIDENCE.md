# Native iOS sidebar validation

Source: [4d14a77c1e2c79f00ed847674a0a912e7dbbc9ec](https://github.com/Marvinthebored/openclaw/commit/4d14a77c1e2c79f00ed847674a0a912e7dbbc9ec).

## Results

- App: **117 tests passed in seven suites**.
- Shared: **24 tests passed in four suites**.
- Web bridge/navigation: **11 tests passed in two files**.
- Native menus: **one UI workflow passed**, including filtering, editing, assignment, rename, scroll and copy effects.
- Stable-to-candidate upgrade: **one UI workflow passed**, preserving stored choices and proving editing/relaunch persistence.
- Authenticated native plugin: **one XCTest passed**, with an independently verified Gateway receipt and inspected rendered result.
- Control UI typecheck, production build/performance budgets, native source lint, localization, protocol-event coverage and whitespace checks passed.
- Complete iOS/Watch build-for-testing index and macOS consumer build passed. Periphery reports **zero iOS app findings** and **zero shared declarations dead in both consumers**. [App results](periphery-ios-app.json), [shared intersection](periphery-shared-intersection.json), [scan summary](periphery-results.txt).

## Shipped Pages compatibility

The unmodified v2026.9.9 Pages implementation (commit bcfc88812a35243893585dbeca87ca41b48272ca) was built and run on an iPhone 17 Pro simulator. A native UI test verified its Overview/Usage/Automations defaults, then used its editor to save Docs → Workboard → Overview. Relaunch preserved that selection.

The candidate was installed over the stable app on the same simulator without uninstalling or seeding a preference. The persisted `sidebar.pinnedPages` value and displayed order survived. The candidate editor unpinned and repinned Docs; Workboard → Overview → Docs survived another relaunch. Workboard remained a native choice without requiring a plugin catalog.

Output: [stable writer](stable-writer-results.txt), [candidate upgrade](stable-upgrade-results.txt). Screenshots: [stable customization](screenshots/stable-pages-customized.png), [candidate preserved order](screenshots/upgraded-pages-customized.png), [candidate after editing and relaunch](screenshots/upgraded-pages-relaunch.png).

## Real authenticated plugin action

The production native bridge and authenticated WKWebView loaded the candidate Control UI from an isolated token-authenticated Gateway. A registered plugin exposed a navigation action backed by a real operator-write Gateway method.

The native bridge received the live registry, dispatched the action, and the plugin invoked its Gateway method. The Gateway wrote an independent receipt with invocation count **1**, operator role, Control UI client identity and write authorization. The WKWebView rendered “Gateway recorded 1 authenticated native action”; XCTest asserted that text and the cleared pending state. No RPC or JavaScript result was mocked.

Output: [native test](native-plugin-results.txt), [server-written receipt](gateway-action-receipt.json), [rendered native result](screenshots/real-native-plugin-action.png).

## Regression evidence

- The retained sidebar source-regression test failed on the previous PR source; its repaired assertions pass in the app suite.
- Pages defaults, preserved destinations and catalog-promoted descendants fail when the earlier admission/default behavior is restored; the candidate passes. [Native red output](native-regression-red.txt), [candidate app output](native-app-results.txt).
- The real plugin runtime returns fresh registration wrappers. A fixture with that same behavior produced **two failures and nine passes** with the old identity guard. Matching registration key and lifetime fixes execution while retaining stale/replaced/disconnected/aborted rejection tests: **11 passed**. [Web red](web-regression-red.txt), [web green](web-results.txt).

## Native menu evidence

[UI output](native-ui-results.txt) covers whole-header and whole-row long presses, Status filters, the Pages editor, appearance and assignment sheets, saved rename, scrolling within native menus, the Copy submenu and Session ID confirmation. [Shared output](native-shared-results.txt) covers catalog projection, menu access, People filtering and refresh coordination.

All screenshots contain synthetic fixture data and were inspected after export. Before images assert that Assign and Copy are absent on the prerequisite-only base. Current candidate landing and menus are in `screenshots/after-*.png`. `screenshots.json` and `source-manifest.json` record hashes.

## Review record

AI-assisted implementation with independent adversarial review and re-review. Review fixes preserve catalog descendants, including unpinned children promoted into the Pages zone; restore shipped Pages defaults and choices; avoid duplicate native Workboard defaults; repair obsolete source-test boundaries; and use registration lifetime identity for plugin actions. The independent lifetime review checked replacement, disposal, connection retirement and synchronous admission-to-dispatch safety.
