import Foundation
import OpenClawChatUI
import OpenClawKit
import OpenClawProtocol
import SwiftUI

/// Uses the shared catalog owner for paging, invalidation and persisted source visibility.
struct RootSidebarCatalogs: View {
    @Environment(NodeAppModel.self) private var appModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var data = ChatSessionSidebarCatalogs()
    @State private var collapsed: Set<String> = []
    @State private var visibilityPresented = false
    let sessions: [OpenClawChatSessionEntry]
    let options: ChatSessionSidebarModel.ViewOptions
    let owners: [OpenClawChatSessionEntry.CreatedActor]
    @Binding var ownerFilter: String
    let openSession: (String) -> Void
    let openDashboard: (RootSidebarDashboardRoute) -> Void
    var isActive = true
    @Binding var adoptedKeys: Set<String>
    var liveRow: ((OpenClawChatSessionEntry) -> AnyView)?

    private var agentID: String {
        self.appModel.chatAgentId
    }

    private var observing: Bool {
        self.isActive && self.scenePhase == .active && self.appModel.isOperatorGatewayConnected
    }

    private var projection: ChatSidebarCatalogPresentation {
        ChatSidebarCatalogPresentation(
            sources: self.data.agentID == self.agentID ? self.data.visible(archived: false) : [],
            requestErrors: self.data.errors,
            query: .init(
                agentID: self.agentID,
                status: self.options.status,
                ownerId: self.ownerFilter.hasPrefix("owner:") ? String(self.ownerFilter.dropFirst(6)) : nil,
                involvingMe: self.ownerFilter == "involving-me"),
            allAgents: false,
            lookup: { key in self.sessions.first { $0.key == key } })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(self.projection.catalogs) { catalog in
                self.catalog(catalog)
            }
            if let error = self.data.errors[""] {
                self.error(error)
            }
            if !self.data.catalogs.isEmpty || !self.data.hidden.isEmpty {
                Button { self.visibilityPresented = true } label: {
                    Label { Text("Session Sources…").font(OpenClawType.captionMedium) }
                        icon: { Image(systemName: "square.stack.3d.up") }
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                }.buttonStyle(.plain).padding(.horizontal, 10)
            }
        }
        .task(id: "\(self.observing)|\(self.appModel.chatViewModelIdentityID)|\(self.agentID)") {
            guard self.observing else { self.data.stop()
                return
            }
            self.data.isRendered = true
            let events = await self.appModel.sidebarCatalogEvents(openSources: self.showSources)
            await self.data.observe(events, agentID: self.agentID)
        }
        .onDisappear { self.data.isRendered = false
            self.data.stop()
            self.adoptedKeys = []
        }
        .onChange(of: self.data.adoptedKeys(archived: self.options.status == .archived)) { _, keys in
            self.adoptedKeys = self.liveRow == nil ? [] : keys
        }
        .sheet(isPresented: self.$visibilityPresented) { self.visibilitySheet }
    }

    private func catalog(_ catalog: ChatSidebarCatalogPresentation.Catalog) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            self.heading(catalog.source.label, id: catalog.id)
                .contextMenu { self.catalogMenu(catalog.source) }
            if !self.collapsed.contains(catalog.id) {
                ForEach(catalog.hosts) { host in
                    if catalog.hosts.count > 1 || host.source.kind.value as? String == "node" {
                        Label {
                            Text(verbatim: host.source.label).font(OpenClawType.captionMedium)
                        } icon: { Image(systemName: host.source.connected ? "desktopcomputer" : "wifi.slash") }
                            .foregroundStyle(OpenClawSidebarPalette.muted).padding(.horizontal, 10)
                    }
                    ForEach(self.data.groups(host.rows)) { group in
                        let groupID = "\(catalog.id)|\(host.id)|\(group.id)"
                        if let label = group.label { self.heading(label, id: groupID) }
                        if !self.collapsed.contains(groupID) {
                            ForEach(group.rows, id: \.threadid) { row in
                                if let key = row.sessionkey, let live = self.projection.liveRows[key], let liveRow {
                                    liveRow(live)
                                } else {
                                    RootSidebarCatalogRow(
                                        data: self.data,
                                        catalog: catalog.source,
                                        host: host.source,
                                        row: row,
                                        openSession: self.openSession,
                                        openDashboard: self.openDashboard)
                                }
                            }
                        }
                    }
                }
                ForEach(ChatSidebarCatalogPresentation.errors(
                    catalog.source, requestError: self.data.errors[catalog.id]), id: \.self) { self.error($0) }
                if self.data.loading.contains(catalog.id) {
                    ProgressView().padding(10)
                } else if catalog.source.hosts.contains(where: { $0.nextcursor?.isEmpty == false }) {
                    Button { Task { await self.data.loadMore(catalog.id) } } label: {
                        Text("Load More").font(OpenClawType.captionMedium)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }.disabled(self.data.connection == nil).padding(.horizontal, 10)
                }
            }
        }
    }

    private func heading(_ title: String, id: String) -> some View {
        Button {
            if !self.collapsed.insert(id).inserted { self.collapsed.remove(id) }
        } label: {
            HStack {
                Image(systemName: self.collapsed.contains(id) ? "chevron.right" : "chevron.down")
                Text(verbatim: title).font(OpenClawType.caption2Bold)
                Spacer(minLength: 0)
            }.foregroundStyle(OpenClawSidebarPalette.muted)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(.horizontal, 10).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    @ViewBuilder private func catalogMenu(_ catalog: SessionCatalog) -> some View {
        Menu {
            Picker(selection: Binding(get: { self.data.grouping }, set: { self.data.setGrouping($0) })) {
                Text("Project").font(OpenClawType.subhead).tag(ChatSessionSidebarCatalogs.Grouping.project)
                Text("Person").font(OpenClawType.subhead).tag(ChatSessionSidebarCatalogs.Grouping.person)
                Text("None").font(OpenClawType.subhead).tag(ChatSessionSidebarCatalogs.Grouping.none)
            } label: { Text("Group By").font(OpenClawType.subhead) }
                .pickerStyle(.inline)
        } label: { Text("Group By").font(OpenClawType.subhead) }
        Menu {
            Picker(selection: self.$ownerFilter) {
                Text("All Owners").font(OpenClawType.subhead).tag("")
                Text("Involving Me").font(OpenClawType.subhead).tag("involving-me")
                ForEach(self.owners.filter { $0.id != nil }, id: \.id) { owner in
                    Text(verbatim: owner.label ?? owner.id ?? "").font(OpenClawType.subhead)
                        .tag("owner:\(owner.id ?? "")")
                }
            } label: { Text("Owner").font(OpenClawType.subhead) }
                .pickerStyle(.inline)
        } label: { Text("Owner").font(OpenClawType.subhead) }
        Button { self.data.setHidden(catalog.id, true) } label: {
            Label { Text("Hide from Sidebar").font(OpenClawType.subhead) }
                icon: { Image(systemName: "eye.slash") }
        }
        Button { self.visibilityPresented = true } label: {
            Text("Manage Session Sources…").font(OpenClawType.subhead)
        }
    }

    private var visibilitySheet: some View {
        NavigationStack {
            Form {
                ForEach(ChatSidebarCatalogPresentation.visibilityOptions(
                    self.data.catalogs,
                    hidden: self.data.hidden))
                { item in
                    Toggle(isOn: Binding(get: { !self.data.hidden.contains(item.id) }, set: {
                        self.data.setHidden(item.id, !$0)
                        if $0 { self.data.scheduleRefresh() }
                    })) { Text(verbatim: item.label).font(OpenClawType.body) }
                }
                Button { self.visibilityPresented = false
                    self.showSources()
                } label: {
                    Text("Session Source Settings…").font(OpenClawType.body)
                }
            }.navigationTitle("Session Sources")
                .toolbar { ToolbarItem(placement: .confirmationAction) {
                    Button { self.visibilityPresented = false } label: {
                        Text("Done").font(OpenClawType.subheadSemiBold)
                    }
                } }
        }
    }

    private func showSources() {
        self.openDashboard(.init(
            path: "/settings/appearance",
            title: "Session Sources",
            queryItems: [.init(name: "section", value: "__appearance__")],
            fragment: "settings-session-sources"))
    }

    private func error(_ message: String) -> some View {
        VStack(alignment: .leading) {
            Text(verbatim: message).font(OpenClawType.captionMedium).foregroundStyle(OpenClawBrand.warn)
            Button { self.data.scheduleRefresh() } label: {
                Text("Retry").font(OpenClawType.subhead).frame(minHeight: 44)
            }.disabled(self.data.connection == nil)
        }.padding(.horizontal, 10)
    }
}

private struct RootSidebarCatalogRow: View {
    @Environment(NodeAppModel.self) private var appModel
    let data: ChatSessionSidebarCatalogs
    let catalog: SessionCatalog
    let host: SessionCatalogHost
    let row: SessionCatalogSession
    let openSession: (String) -> Void
    let openDashboard: (RootSidebarDashboardRoute) -> Void
    @State private var confirmsDelete = false
    @State private var failure: String?
    @State private var busy = false
    @State private var heldConnection: OpenClawSidebarCatalogConnection?
    @State private var heldScope: UUID?

    var body: some View {
        Button { self.openViewer() } label: {
            HStack(spacing: 8) {
                Image(systemName: "bubble.left")
                Text(verbatim: ChatSidebarCatalogPresentation.title(self.row)).font(OpenClawType.subhead)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if self.busy { ProgressView().controlSize(.small) }
            }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(.horizontal, 10).contentShape(Rectangle())
        }.buttonStyle(.plain)
            .contextMenu { self.menu }
            .confirmationDialog("Delete Session?", isPresented: self.$confirmsDelete, titleVisibility: .visible) {
                Button(role: .destructive) {
                    self.run { connection in
                        guard connection.allowsArchive else { throw CancellationError() }
                        _ = await self.data.archive(self.catalog, host: self.host, row: self.row)
                    }
                } label: { Text("Delete Session").font(OpenClawType.subhead) }
                Button(role: .cancel) {} label: { Text("Cancel").font(OpenClawType.subhead) }
            } message: {
                Text("Make sure no other runner is using this session before deleting it.").font(OpenClawType.caption)
            }
            .alert("Session Action Failed", isPresented: Binding(
                get: { self.failure != nil }, set: { if !$0 { self.failure = nil } }))
            {
                Button { self.failure = nil } label: { Text("OK").font(OpenClawType.subhead) }
            } message: { Text(verbatim: self.failure ?? "").font(OpenClawType.body) }
    }

    @ViewBuilder private var menu: some View {
        Button { self.openViewer() } label: { Text("Open in OpenClaw").font(OpenClawType.subhead) }
        if self.catalog.capabilities.continuesession, self.row.cancontinue {
            Button { self.capture()
                self.adopt(importing: false)
            } label: {
                Text("Continue Conversation").font(OpenClawType.subhead)
            }.disabled(self.data.connection?.allowsContinue != true || self.busy)
        }
        if self.data.connection?.allowsImport == true {
            Button { self.capture()
                self.adopt(importing: true)
            } label: {
                Text("Import to OpenClaw").font(OpenClawType.subhead)
            }.disabled(self.busy)
        }
        Button { UIPasteboard.general.string = self.row.threadid } label: {
            Text("Copy Source Session ID").font(OpenClawType.subhead)
        }
        Button {
            let route = self.viewerRoute
            UIPasteboard.general.url = AuthenticatedControlUI.pageURL(
                config: self.appModel.activeGatewayConnectConfig, path: route.path, queryItems: route.queryItems)
        } label: { Text("Copy Session Link").font(OpenClawType.subhead) }
        if self.catalog.capabilities.archive, self.row.canarchive {
            Button(role: .destructive) { self.capture()
                self.confirmsDelete = true
            } label: {
                Text("Delete Session…").font(OpenClawType.subhead)
            }.disabled(self.data.connection?.allowsArchive != true || self.busy)
        }
    }

    private var viewerRoute: RootSidebarDashboardRoute {
        let agent = AuthenticatedControlUI.percentEncodedPathSegment(self.data.agentID) ?? "main"
        var items = [
            URLQueryItem(name: "catalog", value: self.catalog.id),
            .init(name: "host", value: self.host.hostid),
            .init(name: "thread", value: self.row.threadid),
        ]
        if let home = self.row.sourcehomeid { items.append(.init(name: "sourceHomeId", value: home)) }
        return .init(path: "/chat/\(agent)", title: ChatSidebarCatalogPresentation.title(self.row), queryItems: items)
    }

    private func openViewer() {
        if let key = self.row.sessionkey { self.openSession(key) } else { self.openDashboard(self.viewerRoute) }
    }

    private func capture() {
        self.heldConnection = self.data.connection
        self.heldScope = self.data.scopeID
    }

    private func run(_ operation: @escaping (OpenClawSidebarCatalogConnection) async throws -> Void) {
        guard let connection = self.heldConnection, connection.isCurrent(),
              self.heldScope == self.data.scopeID, !self.busy
        else {
            self.failure = String(localized: "The connection changed. Reopen the menu and try again.")
            return
        }
        self.busy = true
        Task { @MainActor in
            defer { self.busy = false }
            do { try await operation(connection) } catch is CancellationError {
                self.failure = String(localized: "The connection changed. Try again.")
            } catch {
                self.failure = error.localizedDescription
            }
        }
    }

    private func adopt(importing: Bool) {
        let scope = self.data.scopeID, agentID = self.data.agentID
        self.run { connection in
            guard importing ? connection.allowsImport : connection.allowsContinue else { throw CancellationError() }
            var params: [String: OpenClawProtocol.AnyCodable] = [
                "catalogId": .init(self.catalog.id), "hostId": .init(self.host.hostid),
                "threadId": .init(self.row.threadid), "agentId": .init(agentID),
            ]
            if let home = self.row.sourcehomeid { params["sourceHomeId"] = .init(home) }
            struct Result: Decodable { let sessionKey: String
                let complete: Bool?
            }
            let response = try await JSONDecoder().decode(Result.self, from: connection.request(.init(
                method: importing ? "sessions.catalog.import" : "sessions.catalog.continue",
                params: params,
                timeoutMs: 30000)))
            guard connection.isCurrent(), scope == self.data.scopeID else { throw CancellationError() }
            self.data.scheduleRefresh()
            if response.complete == false {
                self.failure = String(localized: "The import is incomplete. Open the source and retry the import.")
            } else { self.openSession(response.sessionKey) }
        }
    }
}

extension NodeAppModel {
    fileprivate func sidebarCatalogEvents(openSources: @escaping @MainActor @Sendable () -> Void) async
        -> AsyncStream<OpenClawSidebarCatalogEvent>
    {
        guard let route = await self.operatorSession.currentRoute(),
              await self.operatorSession.supportsServerMethod("sessions.catalog.list", ifCurrentRoute: route) == true,
              let scopes = await self.operatorSession.currentOperatorScopes(ifCurrentRoute: route),
              !scopes.isDisjoint(with: ["operator.read", "operator.write", "operator.admin"])
        else { return AsyncStream { $0.yield(.unavailable)
            $0.finish()
        } }
        let gateway = self.operatorSession, identity = self.chatViewModelIdentityID
        let canWrite = !scopes.isDisjoint(with: ["operator.write", "operator.admin"])
        let archive = await gateway.supportsServerMethod("sessions.catalog.archive", ifCurrentRoute: route) == true
        let resume = await gateway.supportsServerMethod("sessions.catalog.continue", ifCurrentRoute: route) == true
        let importing = await gateway.supportsServerMethod("sessions.catalog.import", ifCurrentRoute: route) == true
        let changedEvents = await gateway.supportsServerEvent("sessions.catalog.changed", ifCurrentRoute: route) == true
        let events = await gateway
            .makeServerEventSubscription { ["sessions.catalog.changed", "seqGap"].contains($0.event) }
        return AsyncStream { continuation in
            let task = Task { @MainActor [weak self] in
                continuation.yield(.connected(.init(
                    profileID: self?.chatViewModelOwnerID ?? identity,
                    changedEvents: changedEvents,
                    allowsArchive: canWrite && archive,
                    allowsContinue: canWrite && resume,
                    allowsImport: canWrite && importing,
                    request: { try await gateway.request($0, ifCurrentRoute: route) },
                    isCurrent: { [weak self] in self?.isOperatorGatewayConnected == true &&
                        self?.chatViewModelIdentityID == identity
                    }, openSources: openSources)))
                for await event in events.events {
                    guard !Task.isCancelled else { break }
                    continuation.yield(.changed(event.payload?.dictionaryValue?["agentId"]?.stringValue))
                }
                continuation.finish()
            }
            continuation.onTermination = { @Sendable _ in events.cancel()
                task.cancel()
            }
        }
    }
}
