import Foundation
import UIKit
import XCTest

/// Private driver only. No app fixture, mocked transport, or preference writes.
@MainActor
final class UpgradeProof: XCTestCase {
    private var app = XCUIApplication()
    private let rowTitle = "Upgrade Session Amber"

    override func setUpWithError() throws { continueAfterFailure = false }

    private func launch(_ destination: String = "chat") {
        app.launchArguments = [
            "--openclaw-initial-tab", destination,
            "--openclaw-initial-destination", destination,
            "--openclaw-sidebar-visibility", "hidden",
            "--openclaw-ui-test-readiness", "-AppleLanguages", "(en)"
        ]
        app.launch()
        let manual = app.buttons["Use Manual Setup"]
        if manual.waitForExistence(timeout: 3), manual.isHittable { manual.tap() }
        // Scratch controller approves the request; the app's pairing pause lasts per process.
        let pending = app.staticTexts["This device is not approved yet"]
        for _ in 0..<2 where pending.waitForExistence(timeout: 6) {
            shot("scratch-pairing-pending")
            _ = XCTWaiter.wait(for: [XCTestExpectation(description: "scratch approval")], timeout: 5)
            app.terminate()
            app.launch()
        }
        XCTAssertFalse(pending.waitForExistence(timeout: 3), app.debugDescription)
    }

    private func shot(_ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-hierarchy"
        tree.lifetime = .keepAlways
        add(tree)
    }

    private func reveal(_ element: XCUIElement) {
        if element.exists && element.isHittable { return }
        let scroll = app.collectionViews.firstMatch.exists ? app.collectionViews.firstMatch :
            (app.tables.firstMatch.exists ? app.tables.firstMatch : app.scrollViews.firstMatch)
        XCTAssertTrue(scroll.exists, app.debugDescription)
        for _ in 0..<10 {
            if element.exists && element.isHittable { return }
            scroll.swipeUp()
        }
        for _ in 0..<10 {
            if element.exists && element.isHittable { return }
            scroll.swipeDown()
        }
        XCTAssertTrue(element.exists && element.isHittable, app.debugDescription)
    }

    private func drawer() {
        let show = app.buttons["RootTabs.Sidebar.Show"]
        if show.waitForExistence(timeout: 8), show.isHittable { show.tap() }
        XCTAssertTrue(app.buttons["RootTabs.Sidebar.Destination.chat"].waitForExistence(timeout: 20),
                      app.debugDescription)
    }

    private func sessionList() {
        drawer()
        let all = app.buttons["All Sessions…"]
        reveal(all)
        all.tap()
        // The stable drawer keeps its (hit-test disabled) dismiss control mounted after closing,
        // so "closed" means the destination's Show Sidebar control is hittable again.
        let show = app.buttons["RootTabs.Sidebar.Show"]
        let closed = NSPredicate { _, _ in show.exists && show.isHittable }
        for attempt in 0..<3 {
            if XCTWaiter.wait(for: [expectation(for: closed, evaluatedWith: nil)], timeout: 4) == .completed { break }
            if attempt < 2 {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.85)).tap()
            } else {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5))
                    .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5)))
            }
        }
        XCTAssertTrue(show.exists && show.isHittable, app.debugDescription)
        XCTAssertTrue(app.segmentedControls["Sessions.StatusScope"].waitForExistence(timeout: 10),
                      app.debugDescription)
        XCTAssertTrue(app.staticTexts[rowTitle].waitForExistence(timeout: 45), app.debugDescription)
    }

    private func createInAlert(_ name: String) {
        let alert = app.alerts["New Group"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), app.debugDescription)
        alert.textFields.firstMatch.tap()
        alert.textFields.firstMatch.typeText(name)
        shot("stable-native-editor-" + name)
        alert.buttons["Create"].tap()
        XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 20), app.debugDescription)
    }

    func testStableWriter() throws {
        // Only route/onboarding bootstrap is seeded by the runner. The actual
        // credential is entered into the normal Keychain-backed native field.
        launch("gateway")
        let token = try XCTUnwrap(ProcessInfo.processInfo.environment["UPGRADE_TOKEN"])
        let field = app.secureTextFields["Gateway Auth Token"]
        reveal(field)
        UIPasteboard.general.string = token
        field.tap()
        field.press(forDuration: 1)
        let paste = app.menuItems["Paste"]
        XCTAssertTrue(paste.waitForExistence(timeout: 5), app.debugDescription)
        paste.tap()
        XCTAssertEqual((field.value as? String)?.count, token.count, "Native credential entry incomplete")
        UIPasteboard.general.string = ""
        app.terminate()
        launch()
        sessionList()
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", rowTitle + ", chat,")).firstMatch
        reveal(row)
        row.press(forDuration: 1)
        XCTAssertTrue(app.buttons["Move to Group"].waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["Move to Group"].tap()
        XCTAssertTrue(app.buttons["New Group…"].waitForExistence(timeout: 5))
        app.buttons["New Group…"].tap()
        createInAlert("Legacy Amber")

        // Stable's full session list header supports a genuinely empty group.
        let header = app.staticTexts["Legacy Amber"].firstMatch
        reveal(header)
        header.press(forDuration: 1)
        XCTAssertTrue(app.buttons["New Group…"].waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["New Group…"].tap()
        createInAlert("Legacy Violet")
        shot("stable-native-occupied-and-empty-groups")

        app.terminate()
        launch()
        drawer()
        let edit = app.buttons["Edit Pages"]
        reveal(edit)
        edit.tap()
        XCTAssertTrue(app.navigationBars["Pages"].waitForExistence(timeout: 5), app.debugDescription)
        // A real user preference, written by stable UI, not by a plist seed.
        let docs = app.buttons.matching(NSPredicate(format: "label == %@ AND value == %@", "Docs", "Not pinned")).firstMatch
        reveal(docs)
        docs.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label == %@ AND value == %@", "Docs", "Pinned"))
            .firstMatch.waitForExistence(timeout: 5))
        app.navigationBars["Pages"].buttons["Done"].tap()
        shot("stable-native-settings-and-sessions")
        app.terminate()
        launch()
        sessionList()
        XCTAssertTrue(app.staticTexts["Legacy Amber"].exists)
        XCTAssertTrue(app.staticTexts["Legacy Violet"].exists)
        shot("stable-relaunch-persisted")
        app.terminate()
    }

    func testCandidateMigration() {
        launch()
        drawer()
        let amber = app.descendants(matching: .any)["SessionGroup.Header.Legacy Amber"].firstMatch
        let violet = app.descendants(matching: .any)["SessionGroup.Header.Legacy Violet"].firstMatch
        XCTAssertTrue(amber.waitForExistence(timeout: 60), app.debugDescription)
        // Web parity: the empty local-only group is not imported into a non-empty Gateway catalog.
        XCTAssertFalse(violet.waitForExistence(timeout: 5), app.debugDescription)
        shot("candidate-native-migrated-occupied-group")
        let docs = app.buttons["RootTabs.Sidebar.Destination.docs"]
        reveal(docs)
        XCTAssertTrue(docs.exists, "Stable pinned Docs setting must survive")
        shot("candidate-preserved-native-setting")
        sessionList()
        XCTAssertTrue(app.staticTexts[rowTitle].waitForExistence(timeout: 20))
        shot("candidate-preserved-real-session")
        app.terminate()
    }

    func testCandidateRound2GroupControls() throws {
        // Exercise only the migrated real group and Gateway-backed defaults UI.
        // Keep this separate from the stable writer and the original migration proof.
        launch()
        drawer()
        let header = app.descendants(matching: .any)["SessionGroup.Header.Legacy Amber"].firstMatch
        let caret = app.buttons["SessionGroup.Caret.Legacy Amber"]
        let row = app.staticTexts[rowTitle].firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 60), app.debugDescription)
        reveal(caret)
        if caret.label == "Expand Group" { caret.tap() }
        XCTAssertTrue(caret.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(expectationForLabel("Collapse Group", on: caret), app.debugDescription)
        reveal(row)
        XCTAssertTrue(row.waitForExistence(timeout: 20), app.debugDescription)
        shot("candidate-round2-expanded-before-fold")

        reveal(header)
        header.tap()
        XCTAssertTrue(caret.waitForExistence(timeout: 5))
        XCTAssertTrue(expectationForLabel("Expand Group", on: caret))
        XCTAssertTrue(row.waitForNonExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.buttons["New Session Defaults…"].exists, "Header tap must only fold")
        shot("candidate-round2-header-folded")
        caret.tap()
        XCTAssertTrue(expectationForLabel("Collapse Group", on: caret))
        reveal(row)
        XCTAssertTrue(row.waitForExistence(timeout: 5), app.debugDescription)
        shot("candidate-round2-caret-unfolded")

        reveal(header)
        header.press(forDuration: 1)
        for item in [
            "New Session in This Group", "New Session Defaults…", "Rename Group…",
            "New Group…", "Move Up", "Move Down", "Delete Group…"
        ] {
            XCTAssertTrue(app.buttons[item].waitForExistence(timeout: 5), "Missing menu item: " + item)
        }
        let defaults = app.buttons["New Session Defaults…"]
        XCTAssertTrue(waitForEnabled(defaults), app.debugDescription)
        shot("candidate-round2-native-long-press-menu")
        defaults.tap()
        let sheetTitle = app.staticTexts["Group defaults"]
        XCTAssertTrue(sheetTitle.waitForExistence(timeout: 10), app.debugDescription)
        let browse = app.buttons["Browse…"]
        XCTAssertTrue(browse.waitForExistence(timeout: 30), app.debugDescription)
        browse.tap()
        let folder = app.textFields["Folder"]
        XCTAssertTrue(folder.waitForExistence(timeout: 10), app.debugDescription)
        // Use the Gateway browser's actual initial directory, not a hard-coded
        // host path or a seeded preference. Saving makes cwd explicit.
        let loadedFolder = NSPredicate(format: "value BEGINSWITH %@", "/")
        XCTAssertEqual(XCTWaiter.wait(for: [
            XCTNSPredicateExpectation(predicate: loadedFolder, object: folder)
        ], timeout: 30), .completed, app.debugDescription)
        let savedFolder = try XCTUnwrap(folder.value as? String)
        XCTAssertFalse(savedFolder.isEmpty)
        let useFolder = app.buttons["Use this folder"]
        XCTAssertTrue(waitForEnabled(useFolder), app.debugDescription)
        useFolder.tap()
        XCTAssertTrue(folder.waitForNonExistence(timeout: 10), app.debugDescription)
        let save = app.buttons["Save"]
        XCTAssertTrue(waitForEnabled(save), app.debugDescription)
        // Git workspaces expose a second real setting; flip it if available.
        // Non-Git folders still prove an explicit cwd round trip.
        let worktree = app.switches["Separate working copy"]
        var savedWorktree: String?
        if worktree.exists {
            let previous = try XCTUnwrap(worktree.value as? String)
            XCTAssertTrue(previous == "0" || previous == "1", app.debugDescription)
            savedWorktree = previous == "1" ? "0" : "1"
            XCTAssertTrue(worktree.isEnabled, app.debugDescription)
            // A Form-row Toggle's centre is its label; tap the trailing knob.
            worktree.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
            let flipped = NSPredicate(format: "value == %@", savedWorktree!)
            XCTAssertEqual(XCTWaiter.wait(for: [
                XCTNSPredicateExpectation(predicate: flipped, object: worktree)
            ], timeout: 5), .completed, app.debugDescription)
        }
        shot("candidate-round2-defaults-before-native-save")
        save.tap()
        XCTAssertTrue(sheetTitle.waitForNonExistence(timeout: 30), app.debugDescription)

        reveal(header)
        header.press(forDuration: 1)
        XCTAssertTrue(defaults.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(waitForEnabled(defaults), app.debugDescription)
        defaults.tap()
        XCTAssertTrue(sheetTitle.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.staticTexts[savedFolder].waitForExistence(timeout: 30),
                      "Reopened defaults must read the saved cwd from the Gateway: " + app.debugDescription)
        XCTAssertTrue(waitForEnabled(save), app.debugDescription)
        if let savedWorktree {
            XCTAssertTrue(worktree.waitForExistence(timeout: 5), app.debugDescription)
            XCTAssertEqual(worktree.value as? String, savedWorktree, "Reopened working-copy mode must be retained")
        }
        shot("candidate-round2-defaults-reopened-retained")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(sheetTitle.waitForNonExistence(timeout: 10), app.debugDescription)

        reveal(caret)
        XCTAssertEqual(caret.label, "Collapse Group")
        caret.tap()
        XCTAssertTrue(expectationForLabel("Expand Group", on: caret))
        XCTAssertTrue(row.waitForNonExistence(timeout: 5), app.debugDescription)
        shot("candidate-round2-folded-before-terminate")
        app.terminate()
        launch()
        drawer()
        XCTAssertTrue(header.waitForExistence(timeout: 60), app.debugDescription)
        reveal(caret)
        XCTAssertTrue(expectationForLabel("Expand Group", on: caret),
                      "Folded state must survive process termination and relaunch")
        XCTAssertTrue(row.waitForNonExistence(timeout: 5), app.debugDescription)
        shot("candidate-round2-folded-after-relaunch")
        caret.tap()
        XCTAssertTrue(expectationForLabel("Collapse Group", on: caret))
        reveal(row)
        XCTAssertTrue(row.waitForExistence(timeout: 20), app.debugDescription)
        shot("candidate-round2-unfolded-after-relaunch")
        app.terminate()
    }

    private func expectationForLabel(_ label: String, on element: XCUIElement) -> Bool {
        XCTWaiter.wait(for: [
            XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", label), object: element)
        ], timeout: 10) == .completed
    }

    private func waitForEnabled(_ element: XCUIElement) -> Bool {
        XCTWaiter.wait(for: [
            XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == true AND enabled == true"), object: element)
        ], timeout: 30) == .completed
    }

    func testCandidateRelaunch() {
        launch()
        drawer()
        let amber = app.descendants(matching: .any)["SessionGroup.Header.Legacy Amber"].firstMatch
        let violet = app.descendants(matching: .any)["SessionGroup.Header.Legacy Violet"].firstMatch
        XCTAssertTrue(amber.waitForExistence(timeout: 60), app.debugDescription)
        XCTAssertFalse(violet.waitForExistence(timeout: 5), app.debugDescription)
        shot("candidate-second-launch-no-reimport")
        app.terminate()
    }
}
