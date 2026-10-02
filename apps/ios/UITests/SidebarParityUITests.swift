import UIKit
import XCTest

/// Runs only against the isolated synthetic sidebar Gateway, never operator data.
@MainActor
final class SidebarParityUITests: XCTestCase {
    func testSidebarNestingAndOrganization() async throws {
        let environment = ProcessInfo.processInfo.environment
        try XCTSkipUnless(environment["OPENCLAW_IOS_SIDEBAR_FIXTURE_URL"] != nil, "Requires synthetic sidebar Gateway")
        let fixture = try XCTUnwrap(environment["OPENCLAW_IOS_SIDEBAR_FIXTURE_URL"].flatMap(URL.init(string:)))
        let setupCode = try XCTUnwrap(environment["OPENCLAW_IOS_LIVE_SETUP_CODE"])
        var reset = URLRequest(url: fixture.appendingPathComponent("reset"))
        reset.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: reset)
        continueAfterFailure = false
        let app = XCUIApplication()
        defer {
            app.terminate()
            if UIDevice.current.userInterfaceIdiom == .pad { XCUIDevice.shared.orientation = .portrait }
        }
        if UIDevice.current.userInterfaceIdiom == .pad { XCUIDevice.shared.orientation = .landscapeLeft }
        addUIInterruptionMonitor(withDescription: "Local network access") { alert in
            guard alert.buttons["Allow"].exists else { return false }
            alert.buttons["Allow"].tap()
            return true
        }
        let usesSavedPairing = environment["OPENCLAW_IOS_SIDEBAR_PAIRED"] == "1"
        app.launchArguments = [
            "--openclaw-initial-tab", "chat", "--openclaw-initial-destination", "chat",
            "-AppleLanguages", "(en)",
        ]
        if usesSavedPairing {
            // Isolate sidebar proof from the separately recorded iPad onboarding layout failure.
            app.launchArguments += ["-onboarding.completed", "YES", "-onboarding.quickSetupDismissed", "YES"]
        } else {
            app.launchArguments += ["--openclaw-reset-onboarding"]
        }
        app.launch()
        if !usesSavedPairing {
            XCTAssertTrue(app.buttons["Continue"].waitForExistence(timeout: 15))
            app.buttons["Continue"].tap()
            XCTAssertTrue(app.buttons["Connect Manually"].waitForExistence(timeout: 10))
            app.buttons["Connect Manually"].tap()
            let setup = app.textFields["Enter setup code"]
            XCTAssertTrue(setup.waitForExistence(timeout: 5))
            setup.tap()
            setup.typeText(setupCode)
            app.buttons["Apply"].tap()
            let connected = app.staticTexts["You're connected"].waitForExistence(timeout: 60)
            XCTAssertTrue(connected)
            guard connected else { throw NSError(domain: "SidebarFixtureConnection", code: 1) }
            app.buttons["Go to Chat"].tap()
        }
        XCTAssertTrue(app.staticTexts["Your research workspace is ready."].waitForExistence(timeout: 30))
        self.openSidebar(app)
        let parent = self.navigationButton("Website refresh", app: app)
        let child = self.navigationButton("Child research", app: app)
        XCTAssertTrue(parent.waitForExistence(timeout: 10))
        XCTAssertTrue(child.waitForExistence(timeout: 10))
        XCTAssertGreaterThan(child.frame.minX, parent.frame.minX + 8, app.debugDescription)
        XCTAssertGreaterThan(child.frame.minY, parent.frame.minY)
        self.capture(app, name: "sidebar")

        let dividendMenu = app.buttons["RootTabs.Sidebar.SessionMenu.agent:main:dividends"]
        let hasMenu = dividendMenu.waitForExistence(timeout: 5)
        XCTAssertTrue(hasMenu)
        guard hasMenu else { throw NSError(domain: "SidebarFixtureMenu", code: 1) }
        dividendMenu.tap()
        XCTAssertTrue(app.buttons["Rename…"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Move to Group"].exists)
        XCTAssertTrue(app.buttons["Archive"].exists)
        XCTAssertTrue(app.buttons["Pin"].exists)
        self.capture(app, name: "session-menu")
        app.buttons["Rename…"].tap()
        let nameField = app.textFields["CommandSessionActions.Editor"]
        let hasEditor = nameField.waitForExistence(timeout: 5)
        XCTAssertTrue(hasEditor)
        guard hasEditor else { throw NSError(domain: "SidebarFixtureEditor", code: 1) }
        nameField.tap()
        nameField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40) + "Carry monitor")
        XCTAssertEqual(nameField.value as? String, "Carry monitor")
        guard nameField.value as? String == "Carry monitor" else {
            throw NSError(domain: "SidebarFixtureTextEntry", code: 1)
        }
        self.capture(app, name: "rename-editor")
        app.buttons["Save"].tap()
        XCTAssertTrue(self.navigationButton("Carry monitor", app: app).waitForExistence(timeout: 10))
        dividendMenu.tap()
        app.buttons["Pin"].tap()
        XCTAssertTrue(self.navigationButton("Carry monitor", app: app).waitForExistence(timeout: 10))
        dividendMenu.tap()
        XCTAssertTrue(app.buttons["Unpin"].waitForExistence(timeout: 5))
        app.buttons["Unpin"].tap()

        let organizer = app.buttons["RootTabs.Sidebar.Organizer"]
        organizer.tap()
        XCTAssertTrue(app.navigationBars["Reorder Sidebar"].waitForExistence(timeout: 5))
        self.capture(app, name: "reorder")
        let planning = app.cells.containing(.staticText, identifier: "Planning").firstMatch
        let research = app.cells.containing(.staticText, identifier: "Research").firstMatch
        XCTAssertLessThan(research.frame.minY, planning.frame.minY)
        guard research.frame.minY < planning.frame.minY else {
            throw NSError(domain: "SidebarFixtureInitialGroupOrder", code: 1)
        }
        planning.coordinate(withNormalizedOffset: CGVector(dx: 0.94, dy: 0.5)).press(
            forDuration: 0.5, thenDragTo: research.coordinate(withNormalizedOffset: CGVector(dx: 0.94, dy: 0.1)))
        XCTAssertLessThan(planning.frame.minY, research.frame.minY)
        guard planning.frame.minY < research.frame.minY else {
            throw NSError(domain: "SidebarFixtureGroupReorder", code: 1)
        }
        let carry = app.cells.containing(.staticText, identifier: "Carry monitor").firstMatch
        let website = app.cells.containing(.staticText, identifier: "Website refresh").firstMatch
        // Client session ordering intentionally survives Gateway fixture resets.
        // Always reverse the current pair, rather than dragging an already-first row down.
        let carryWasFirst = carry.frame.minY < website.frame.minY
        let moving = carryWasFirst ? website : carry
        let target = carryWasFirst ? carry : website
        moving.coordinate(withNormalizedOffset: CGVector(dx: 0.94, dy: 0.5)).press(
            forDuration: 0.5, thenDragTo: target.coordinate(withNormalizedOffset: CGVector(dx: 0.94, dy: 0.1)))
        app.buttons["Done"].tap()
        XCTAssertTrue(self.navigationButton("Carry monitor", app: app).waitForExistence(timeout: 10))
        let firstTitle = carryWasFirst ? "Website refresh" : "Carry monitor"
        let secondTitle = carryWasFirst ? "Carry monitor" : "Website refresh"
        XCTAssertLessThan(
            self.navigationButton(firstTitle, app: app).frame.minY,
            self.navigationButton(secondTitle, app: app).frame.minY)
        self.capture(app, name: "reordered")

        app.buttons["RootTabs.Sidebar.GroupMenu.Planning"].tap()
        XCTAssertTrue(app.buttons["Rename Group…"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Delete Group…"].exists)
        self.capture(app, name: "group-menu")
        app.buttons["Rename Group…"].tap()
        let groupName = app.textFields["CommandSessionActions.Editor"]
        XCTAssertTrue(groupName.waitForExistence(timeout: 5))
        groupName.tap()
        groupName.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40) + "Projects")
        XCTAssertEqual(groupName.value as? String, "Projects")
        app.buttons["Rename"].tap()
        XCTAssertTrue(app.buttons["RootTabs.Sidebar.GroupMenu.Projects"].waitForExistence(timeout: 10))

        app.buttons["RootTabs.Sidebar.NewSession.Research"].tap()
        XCTAssertTrue(app.staticTexts["Your research workspace is ready."].waitForExistence(timeout: 15))
        self.openSidebar(app)
        XCTAssertTrue(self.navigationButton("New session", app: app).waitForExistence(timeout: 10))
        self.capture(app, name: "created-in-group")
        dividendMenu.tap()
        app.buttons["Move to Group"].tap()
        XCTAssertTrue(app.buttons["Projects"].waitForExistence(timeout: 5))
        app.buttons["Projects"].tap()
        dividendMenu.tap()
        XCTAssertTrue(app.buttons["Archive"].waitForExistence(timeout: 5))
        app.buttons["Archive"].tap()
        XCTAssertTrue(dividendMenu.waitForNonExistence(timeout: 10))
        let (data, _) = try await URLSession.shared.data(from: fixture)
        let state = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let groups = try XCTUnwrap(state["groups"] as? [[String: Any]])
        XCTAssertEqual(groups.first?["name"] as? String, "Projects")
        let sessions = try XCTUnwrap(state["sessions"] as? [[String: Any]])
        let created = sessions.first { $0["label"] as? String == "New session" }
        XCTAssertEqual(created?["category"] as? String, "Research")
        let archived = sessions.first { $0["key"] as? String == "agent:main:dividends" }
        XCTAssertEqual(archived?["label"] as? String, "Carry monitor")
        XCTAssertEqual(archived?["category"] as? String, "Projects")
        XCTAssertEqual(archived?["archived"] as? Bool, true)
    }

    private func navigationButton(_ title: String, app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
    }

    private func openSidebar(_ app: XCUIApplication) {
        let show = app.buttons["RootTabs.Sidebar.Show"]
        if show.exists, show.isHittable { show.tap() }
        XCTAssertTrue(app.buttons["RootTabs.Sidebar.Destination.chat"].waitForExistence(timeout: 10))
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let output = FileManager.default.temporaryDirectory.appendingPathComponent("T275-\(name).png")
        do {
            try screenshot.pngRepresentation.write(to: output)
            print("SIDEBAR_SCREENSHOT=\(output.path)")
        } catch { XCTFail("Could not save screenshot: \(error)") }
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "T275-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
