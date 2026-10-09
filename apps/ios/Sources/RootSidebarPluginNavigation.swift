import Foundation
import OpenClawKit
import OpenClawProtocol
import SwiftUI

/// Metadata is only a navigation hint. Action registrations are always loaded live.
/// The cache contains no closures, credentials, transcripts, or action descriptors.
@MainActor
enum RootSidebarPluginRegistryCache {
    private struct Item: Codable {
        let key: String
        let pluginId: String
        let label: String
        let pageHref: String
        let icon: String?
        let parent: String?
        let defaultVisible: Bool
    }

    static func load(owner: String, defaults: UserDefaults = .standard) -> [IOSSidebarPluginBridge.Entry] {
        guard let data = defaults.data(forKey: "openclaw.ios.sidebar.plugins." + owner),
              let items = try? JSONDecoder().decode([Item].self, from: data) else { return [] }
        return items.prefix(256).map {
            .init(
                key: $0.key,
                pluginId: $0.pluginId,
                label: $0.label,
                parent: $0.parent,
                defaultVisible: $0.defaultVisible,
                pageHref: $0.pageHref,
                icon: $0.icon,
                actions: [])
        }
    }

    @discardableResult
    static func publish(
        _ snapshot: IOSSidebarPluginBridge.RegistrySnapshot,
        currentSnapshot: IOSSidebarPluginBridge.RegistrySnapshot?,
        ownerID: String,
        connectionID: String,
        defaults: UserDefaults = .standard,
        onEntries: ([IOSSidebarPluginBridge.Entry]) -> Void) -> Bool
    {
        guard snapshot == currentSnapshot, snapshot.ownerID == ownerID,
              snapshot.connectionID == connectionID else { return false }
        self.save(snapshot.entries, owner: snapshot.ownerID, defaults: defaults)
        onEntries(snapshot.entries)
        return true
    }

    static func save(_ entries: [IOSSidebarPluginBridge.Entry], owner: String, defaults: UserDefaults = .standard) {
        let items = entries.prefix(256).map {
            Item(
                key: $0.key,
                pluginId: $0.pluginId,
                label: $0.label,
                pageHref: $0.pageHref,
                icon: $0.icon,
                parent: $0.parent,
                defaultVisible: $0.defaultVisible)
        }
        if let data = try? JSONEncoder().encode(items) {
            defaults.set(data, forKey: "openclaw.ios.sidebar.plugins." + owner)
        }
    }
}

/// Normal drawer use never starts a second Control UI connection. Explicit plugin
/// discovery refreshes the native owner's cached projection and action registry.
struct RootSidebarPluginNavigation: View {
    @Environment(NodeAppModel.self) private var appModel
    @State private var showsPicker = false
    let isActive: Bool
    var onEntries: ([IOSSidebarPluginBridge.Entry]) -> Void = { _ in }
    var isPinned: (IOSSidebarPluginBridge.Entry) -> Bool = { _ in false }
    var setPinned: (IOSSidebarPluginBridge.Entry, Bool) -> Void = { _, _ in }

    var body: some View {
        Button { self.showsPicker = true } label: {
            Label { Text("Plugin Pages & Actions…").font(OpenClawType.subhead) }
                icon: { Image(systemName: "puzzlepiece.extension") }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .padding(.horizontal, 10).contentShape(Rectangle())
        }.buttonStyle(.plain)
            .disabled(!self.appModel.isOperatorGatewayConnected)
            .task(id: self.appModel.chatViewModelOwnerID) {
                self.onEntries(RootSidebarPluginRegistryCache.load(owner: self.appModel.chatViewModelOwnerID))
            }
            .sheet(isPresented: self.$showsPicker) {
                RootSidebarPluginActionsScreen(
                    onEntries: self.onEntries, isPinned: self.isPinned, setPinned: self.setPinned)
            }
    }
}

/// Shared authenticated runtime for native navigation and session action pickers.
/// /new initializes registrations without loading a conversation transcript.
struct RootSidebarPluginRuntime: View {
    @Environment(NodeAppModel.self) private var appModel
    let bridge: IOSSidebarPluginBridge
    var isCurrent: (() -> Bool)?

    var body: some View {
        let config = self.appModel.activeGatewayConnectConfig
        let ownerID = self.appModel.chatViewModelOwnerID
        let identity = self.appModel.chatViewModelIdentityID
        if let config, let url = AuthenticatedControlUI.pageURL(config: config, path: "/new", queryItems: []) {
            let token = AuthenticatedControlUI.storedOperatorToken(config: config)
            AuthenticatedControlUIWebView(
                url: url,
                authScript: AuthenticatedControlUI.authUserScript(
                    config: config, pageURL: url, storedOperatorToken: token, usesNativeNavigationChrome: true),
                tls: config.tls,
                sidebarPluginBridge: self.bridge,
                usesNativeEmbed: true)
                .id(identity)
                .onAppear {
                    self.bridge.configure(
                        gatewayURL: config.url,
                        ownerID: ownerID,
                        connectionID: identity,
                        isCurrent: { [weak appModel = self.appModel] in
                            appModel?.isOperatorGatewayConnected == true && appModel?
                                .chatViewModelIdentityID == identity &&
                                (self.isCurrent?() ?? true)
                        })
                }
        } else {
            Text("Connect to a Gateway to load plugin menus.").font(OpenClawType.body)
        }
    }
}

/// The picker is native. Plugin-owned dialogs/pages stay in the authenticated runtime that owns them.
struct RootSidebarPluginActionsScreen: View {
    @Environment(NodeAppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss
    @State private var bridge = IOSSidebarPluginBridge()
    @State private var destructive: PendingAction?
    var pluginID: String?
    var navigationKey: String?
    var onEntries: ([IOSSidebarPluginBridge.Entry]) -> Void = { _ in }
    var isPinned: (IOSSidebarPluginBridge.Entry) -> Bool = { _ in false }
    var setPinned: (IOSSidebarPluginBridge.Entry, Bool) -> Void = { _, _ in }

    private struct PendingAction {
        let entry: IOSSidebarPluginBridge.Entry
        let action: IOSSidebarPluginBridge.Action
        let revision: Int
    }

    private var entries: [IOSSidebarPluginBridge.Entry] {
        guard let snapshot = self.bridge.currentRegistrySnapshot,
              snapshot.ownerID == self.appModel.chatViewModelOwnerID,
              snapshot.connectionID == self.appModel.chatViewModelIdentityID else { return [] }
        return snapshot.entries.filter {
            (self.pluginID == nil || $0.pluginId == self.pluginID) &&
                (self.navigationKey == nil || $0.key == self.navigationKey)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let failure = self.bridge.failure {
                    Text(verbatim: failure).font(OpenClawType.footnote)
                        .foregroundStyle(OpenClawBrand.warn).padding()
                }
                if self.bridge.pending { ProgressView().padding(8) }
                if !self.bridge.showsWebContent { self.picker }
                RootSidebarPluginRuntime(bridge: self.bridge)
                    .frame(maxHeight: self.bridge.showsWebContent ? .infinity : 1)
                    .opacity(self.bridge.showsWebContent ? 1 : 0)
                    .accessibilityHidden(!self.bridge.showsWebContent)
            }
            .onChange(of: self.bridge.registrySnapshot) { _, snapshot in
                self.destructive = nil
                if let snapshot { self.receive(snapshot) }
            }
            .onChange(of: self.appModel.chatViewModelIdentityID) { _, _ in
                self.destructive = nil
            }
            .navigationTitle("Plugin Pages & Actions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if self.bridge.showsWebContent {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { self.bridge.showsWebContent = false } label: {
                            Text("Actions").font(OpenClawType.subhead)
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { self.dismiss() } label: { Text("Done").font(OpenClawType.subheadSemiBold) }
                }
            }
            .confirmationDialog(
                self.destructive?.action.label ?? "Plugin Action",
                isPresented: Binding(get: { self.destructive != nil }, set: { if !$0 { self.destructive = nil } }),
                titleVisibility: .visible)
            {
                if let action = self.destructive {
                    Button(role: .destructive) {
                        self.destructive = nil
                        self.bridge.send("run", entry: action.entry, action: action.action, revision: action.revision)
                    } label: { Text(verbatim: action.action.label).font(OpenClawType.subhead) }
                }
                Button(role: .cancel) { self.destructive = nil } label: {
                    Text("Cancel").font(OpenClawType.subhead)
                }
            }
        }
    }

    private func receive(_ snapshot: IOSSidebarPluginBridge.RegistrySnapshot) {
        RootSidebarPluginRegistryCache.publish(
            snapshot,
            currentSnapshot: self.bridge.currentRegistrySnapshot,
            ownerID: self.appModel.chatViewModelOwnerID,
            connectionID: self.appModel.chatViewModelIdentityID,
            onEntries: self.onEntries)
    }

    private var picker: some View {
        List {
            if !self.bridge.ready {
                HStack {
                    ProgressView()
                    Text("Loading Plugin Menus…").font(OpenClawType.body)
                }
            } else if self.entries.isEmpty {
                Text("No plugin navigation items are registered.").font(OpenClawType.body)
            }
            ForEach(self.entries) { entry in
                let revision = self.bridge.revision
                Section {
                    Button { self.bridge.send("open", entry: entry, revision: revision) } label: {
                        Label { Text("Open Page").font(OpenClawType.body) }
                            icon: { Image(systemName: "arrow.up.right.square") }
                    }
                    Button {
                        guard let snapshot = self.bridge.currentRegistrySnapshot,
                              snapshot.ownerID == self.appModel.chatViewModelOwnerID,
                              snapshot.connectionID == self.appModel.chatViewModelIdentityID,
                              snapshot.entries.contains(entry) else { return }
                        self.setPinned(entry, !self.isPinned(entry))
                    } label: {
                        Label {
                            Text(self.isPinned(entry) ? "Unpin from Sidebar" : "Pin to Sidebar").font(OpenClawType.body)
                        } icon: { Image(systemName: self.isPinned(entry) ? "pin.slash" : "pin") }
                    }
                    ForEach(entry.actions) { action in
                        Button(role: action.destructive ? .destructive : nil) {
                            if action.destructive { self.destructive = .init(
                                entry: entry,
                                action: action,
                                revision: revision) } else { self.bridge.send(
                                "run",
                                entry: entry,
                                action: action,
                                revision: revision) }
                        } label: { Text(verbatim: action.label).font(OpenClawType.body) }
                    }
                } header: { Text(verbatim: entry.label).font(OpenClawType.captionMedium) }
                    .disabled(!self.bridge.connected || self.bridge.pending)
            }
        }
    }
}
