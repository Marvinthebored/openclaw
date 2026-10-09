# Native iOS sidebar menu validation

Source commit: [`3c487b0179494cb20445f1fa8431a77a6dd98164`](https://github.com/Marvinthebored/openclaw/commit/3c487b0179494cb20445f1fa8431a77a6dd98164).

## Results

- iOS simulator build: passed.
- Scoped app tests: **110 passed in 6 suites** (2.574 seconds test execution; 21.515 seconds Xcode test operation).
- Shared package tests: **13 passed in 3 suites** (0.007 seconds test execution).
- Native UI workflow: **1 passed**. Whole-header and whole-row long presses open native menus. Status filters, Pages editor, appearance and assignment sheets, saved rename, menu scrolling, Copy submenu, and Session ID confirmation were exercised.
- Web bridge/navigation: **11 passed in 2 files**, single worker; 8.655 seconds command wall time.
- Full Control UI typecheck, production build and hard performance budgets: passed.
- Control UI and native localization verification: passed.
- Changed native source SwiftLint, targeted SwiftFormat, and diff whitespace checks: passed.

Raw successful test summaries are in `native-app-results.txt`, `native-shared-results.txt`, `native-ui-results.txt`, and `web-results.txt`.

## Rendered before and after

Images are unmodified simulator screenshots with synthetic fixture data, inspected after export. The before run uses the same prerequisite group-header base and dark appearance. It asserts that Assign and Copy are absent from the original menu. The after run verifies the expanded menu and actual editing/navigation effects.

- `screenshots/before-sidebar-landing.png`, `screenshots/before-session-menu.png`
- `screenshots/after-sidebar-landing.png`, `screenshots/after-session-menu.png`
- `screenshots/after-copy-submenu.png`, `screenshots/after-rename-copy-confirmation.png`
- `screenshots/after-pages-editor.png`, `screenshots/after-assignment.png`, `screenshots/after-appearance.png`

`screenshots.json` records screenshot hashes; `source-manifest.json` records the tested source hashes.

## Commands and suites

- `xcodebuild build-for-testing` for the OpenClaw app and UI-test schemes on iPhone 17 Pro / iOS 26.5 Simulator.
- `xcodebuild test-without-building` selecting RootSidebarMenuParityTests, RootSidebarOrderTests, RootSidebarPluginBridgeTests, RootTabsPresentationTests, CommandSessionMenuTests, and OpenClawTypographyTests.
- `xcodebuild test-without-building` selecting RootSidebarMenuParityUITests.
- `swift test --package-path apps/shared/OpenClawKit --filter 'ChatSessionMenuAccessTests|ChatSidebarPeopleFilterTests|ChatSessionSidebarRefreshCoordinatorTests'`.
- Control UI Vitest: `src/app/native-sidebar-plugin-bridge.test.ts src/plugins/control-ui-navigation.test.ts --maxWorkers=1`.
- `node scripts/run-tsgo.mjs -p tsconfig.ui.json`; `node scripts/ui.js build`.
- `node --import ./scripts/tsx.mjs scripts/control-ui-i18n-verify.ts verify`; `node --import ./scripts/tsx.mjs scripts/native-app-i18n.ts verify`.

## Review record

AI-assisted implementation and independent adversarial review. Review identified and corrected a missing bound-menu connection on the standalone Sessions screen and a batch-delete confirmation that needed captured durable targets. Follow-up review checked those fixes, shared refresh cancellation and trailing invalidation, localized formats, and the fixture/UI-test changes. No outstanding findings remained in these passes.
