import Foundation
import Testing
@testable import OpenClaw

@MainActor
struct RootSidebarPluginBridgeTests {
    @Test func `plugin metadata cache is gateway scoped and never retains executable action descriptors`() throws {
        let suite = "RootSidebarPluginBridgeTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let entry = IOSSidebarPluginBridge.Entry(
            key: "example/board", pluginId: "example", label: "Boards", parent: nil,
            defaultVisible: false, pageHref: "/boards", icon: "folder",
            actions: [.init(id: "delete", label: "Delete board", destructive: true, icon: "trash")])
        RootSidebarPluginRegistryCache.save([entry], owner: "gateway-a", defaults: defaults)
        #expect(RootSidebarPluginRegistryCache.load(owner: "gateway-b", defaults: defaults).isEmpty)
        let cached = try #require(RootSidebarPluginRegistryCache.load(owner: "gateway-a", defaults: defaults).first)
        #expect(cached.key == entry.key)
        #expect(cached.pageHref == entry.pageHref)
        #expect(cached.defaultVisible == false)
        #expect(cached.actions.isEmpty)
    }

    @Test func `native session action seed preserves captured identity with JSON escaping`() throws {
        let target = IOSSidebarPluginBridge.SessionTarget(
            key: "agent:main:quote\"",
            sessionId: "original",
            agentId: "main")
        let bridge = IOSSidebarPluginBridge(sessionTarget: target)
        let url = try #require(URL(string: "https://gateway.example"))
        let script = try #require(bridge.seedScript(for: url))
        #expect(script.contains("sessionId"))
        #expect(script.contains("original"))
        #expect(script.contains("agent:main:quote\\\""))
    }

    @Test func `delayed registry publication cannot write or replace a new gateway or document`() throws {
        let suite = "RootSidebarPluginBridgeTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let oldEntry = IOSSidebarPluginBridge.Entry(
            key: "old/board", pluginId: "old", label: "Old", parent: nil,
            defaultVisible: true, pageHref: "/old", icon: nil, actions: [])
        let newEntry = IOSSidebarPluginBridge.Entry(
            key: "new/board", pluginId: "new", label: "New", parent: nil,
            defaultVisible: true, pageHref: "/new", icon: nil, actions: [])
        let held = IOSSidebarPluginBridge.RegistrySnapshot(
            ownerID: "gateway-a", connectionID: "connection-a", documentID: "document-a",
            documentGeneration: UUID(), revision: 1, entries: [oldEntry])
        let replacement = IOSSidebarPluginBridge.RegistrySnapshot(
            ownerID: "gateway-b", connectionID: "connection-b", documentID: "document-b",
            documentGeneration: UUID(), revision: 1, entries: [newEntry])
        var visible = [newEntry]
        RootSidebarPluginRegistryCache.save(visible, owner: "gateway-b", defaults: defaults)
        // A queued callback can run before the bridge is reconfigured. The current
        // app owner must reject it even while its original document is still held.
        #expect(!RootSidebarPluginRegistryCache.publish(
            held, currentSnapshot: held, ownerID: "gateway-b", connectionID: "connection-b",
            defaults: defaults, onEntries: { visible = $0 }))
        let nextDocument = IOSSidebarPluginBridge.RegistrySnapshot(
            ownerID: held.ownerID, connectionID: held.connectionID, documentID: "replacement-document",
            documentGeneration: UUID(), revision: held.revision, entries: held.entries)
        #expect(!RootSidebarPluginRegistryCache.publish(
            held, currentSnapshot: nextDocument, ownerID: held.ownerID, connectionID: held.connectionID,
            defaults: defaults, onEntries: { visible = $0 }))
        #expect(!RootSidebarPluginRegistryCache.publish(
            held, currentSnapshot: held, ownerID: held.ownerID, connectionID: "reconnected-a",
            defaults: defaults, onEntries: { visible = $0 }))
        #expect(visible == [newEntry])
        #expect(RootSidebarPluginRegistryCache.load(owner: "gateway-a", defaults: defaults).isEmpty)
        #expect(RootSidebarPluginRegistryCache.load(owner: "gateway-b", defaults: defaults) == [newEntry])
        #expect(RootSidebarPluginRegistryCache.publish(
            replacement, currentSnapshot: replacement, ownerID: replacement.ownerID,
            connectionID: replacement.connectionID, defaults: defaults, onEntries: { visible = $0 }))
        #expect(visible == replacement.entries)
    }
}
