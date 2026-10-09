import Foundation
import OpenClawChatUI
import Testing
@testable import OpenClaw

@MainActor
struct RootSidebarOrderTests {
    @Test func `unqualified keys in different agents do not share an ordering slot`() throws {
        let rows = try JSONDecoder().decode(OpenClawChatSessionsListResponse.self, from: Data(#"""
        {"sessions":[{"key":"global","agentId":"alpha"},{"key":"global","agentId":"beta"},
        {"key":"agent:alpha:global","agentId":"alpha"}]}
        """#.utf8)).sessions
        let entries = rows.map { RootTabs.SidebarEntry.session(RootTabs.sidebarSessionSlot(for: $0)) }
        #expect(Set(entries).count == 3)
        #expect(entries[2].id == "session:agent:alpha:global")
        #expect(RootTabs.sidebarEntries(from: RootTabs.sidebarEntriesStorage(entries)) == entries)
    }

    @Test func `mixed canonical storage preserves opaque keys and unloaded agent slots`() {
        let entries: [RootTabs.SidebarEntry] = [
            .route(.agents), .plugin("plugin/custom,key"), .session("agent:not-loaded:thread,key"), .route(.usage),
        ]
        #expect(RootTabs.sidebarEntries(from: RootTabs.sidebarEntriesStorage(entries)) == entries)
        #expect(entries.first?.id == "route:agents-home")
        #expect(RootTabs.sidebarEntries(from: "usage,workboard,docs") == [
            .route(.usage), .plugin("workboard/workboard"), .route(.docs),
        ])
        #expect(RootTabs.sidebarEntries(from: "none").isEmpty)
        #expect(RootTabs.sidebarEntries(from: "") == RootTabs.defaultSidebarEntries)
    }

    @Test func `reset preserves every saved session slot even when no sessions are loaded`() {
        let entries: [RootTabs.SidebarEntry] = [
            .session("agent:other:older"), .plugin("workboard/workboard"), .route(.usage),
            .session("agent:missing:newer"),
        ]
        #expect(RootTabs.resetSidebarEntries(entries) == RootTabs.defaultSidebarEntries + [
            .session("agent:other:older"), .session("agent:missing:newer"),
        ])
    }

    @Test func `move crosses route plugin and session boundaries without deleting hidden slots`() {
        let route = RootTabs.SidebarEntry.route(.usage)
        let plugin = RootTabs.SidebarEntry.plugin("workboard/workboard")
        let session = RootTabs.SidebarEntry.session("agent:main:visible")
        let hidden = RootTabs.SidebarEntry.session("agent:other:hidden")
        let entries = [route, hidden, plugin, session]
        let moved = RootTabs.movingSidebarEntry(
            plugin,
            by: -1,
            entries: entries,
            visibleEntries: [route, plugin, session])
        #expect(moved == [plugin, hidden, route, session])
        #expect(RootTabs.movingSidebarEntry(
            session,
            by: -1,
            entries: moved,
            visibleEntries: [plugin, route, session]) == [
            plugin,
            hidden,
            session,
            route,
        ])
        #expect(RootTabs.movingSidebarEntry(
            route,
            by: -1,
            entries: entries,
            visibleEntries: [route, plugin, session]) == entries)
    }

    @Test func `reconcile adds newly pinned rows without replacing saved order or unknown agents`() {
        let entries: [RootTabs.SidebarEntry] = [.session("agent:other:saved"), .route(.usage)]
        let reconciled = RootTabs.reconciledSidebarEntries(
            entries,
            pinnedSessionKeys: ["agent:main:new", "agent:main:new"],
            defaultPluginKeys: ["workboard/workboard"])
        #expect(reconciled == entries + [.plugin("workboard/workboard"), .session("agent:main:new")])
        #expect(RootTabs.settingSidebarEntry(
            .plugin("workboard/workboard"),
            pinned: false,
            entries: reconciled) == entries + [.session("agent:main:new")])
    }

    @Test func `customization offers canonical web routes not hardcoded plugin or footer utilities`() {
        #expect(RootTabs.sidebarCustomizablePages.map { RootTabs.SidebarEntry.route($0).id } == [
            "route:agents-home", "route:dashboards", "route:usage", "route:cron", "route:sessions",
            "route:systems", "route:activity", "route:meetings", "route:plugins", "route:apps", "route:portals",
        ])
        #expect(!RootTabs.sidebarCustomizablePages.contains(.workboard))
        #expect(RootTabs.SidebarDestination.systems.screen == .dashboard("/systems"))
    }
}
