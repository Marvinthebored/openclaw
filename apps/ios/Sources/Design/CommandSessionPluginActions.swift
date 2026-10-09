import OpenClawChatUI
import OpenClawProtocol
import SwiftUI

struct CommandSessionPluginDescriptor: Decodable, Identifiable {
    let id: String
    let pluginId: String
    let pluginName: String?
    let surface: String
    let label: String
    let description: String?
    let schema: AnyCodable?
    let requiredScopes: [String]?
    var menuID: String {
        "\(self.pluginId)/\(self.id)"
    }

    @MainActor func allowed(by connection: OpenClawSessionMenuConnection) -> Bool {
        let scopes = self.requiredScopes?.isEmpty == false ? self.requiredScopes! : ["operator.write"]
        return scopes.allSatisfy { connection.allows("plugins.sessionAction", scope: $0) }
    }
}

struct CommandSessionPluginActions: View {
    let session: OpenClawChatSessionEntry
    let connection: OpenClawSessionMenuConnection
    @State private var descriptors: [CommandSessionPluginDescriptor] = []
    @State private var failure: String?
    @State private var loading = true

    var body: some View {
        Group {
            if let id = self.session.sessionId,
               let agent = OpenClawChatSessionKey.agentID(from: self.session.key) ?? self.session.agentId
            {
                NavigationLink {
                    CommandSessionWebPluginActions(
                        target: .init(key: self.session.key, sessionId: id, agentId: agent),
                        connection: self.connection)
                } label: {
                    Label("Web Plugin Actions", systemImage: "puzzlepiece.extension").font(OpenClawType.body)
                }.disabled(!self.connection.isCurrent())
            }
            if self.loading { ProgressView().accessibilityLabel("Loading plugin actions") }
            if let failure { Text(failure).font(OpenClawType.body).foregroundStyle(OpenClawBrand.danger) }
            ForEach(self.descriptors, id: \.menuID) { descriptor in
                NavigationLink {
                    CommandSessionPluginActionForm(
                        session: self.session,
                        connection: self.connection,
                        descriptor: descriptor)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: descriptor.label).font(OpenClawType.body)
                        Text(verbatim: descriptor.pluginName ?? descriptor.pluginId)
                            .font(OpenClawType.caption).foregroundStyle(.secondary)
                    }
                }.disabled(!descriptor.allowed(by: self.connection))
            }
            if !self.loading, self.descriptors.isEmpty, self.failure == nil {
                Text("No native plugin actions are available for this gateway.")
                    .font(OpenClawType.body)
            }
        }.task {
            defer { self.loading = false }
            struct Catalog: Decodable { let descriptors: [CommandSessionPluginDescriptor] }
            do {
                guard self.connection.allows("plugins.uiDescriptors", scope: "operator.read") else { return }
                let result: Catalog = try await self.connection.read("plugins.uiDescriptors")
                self.descriptors = result.descriptors.filter { $0.surface == "session" }
            } catch { self.failure = error.localizedDescription }
        }
    }
}

/// The existing Control UI registry owns dynamic session actions and their plugin dialogs.
private struct CommandSessionWebPluginActions: View {
    let connection: OpenClawSessionMenuConnection
    @State private var bridge: IOSSidebarPluginBridge

    init(target: IOSSidebarPluginBridge.SessionTarget, connection: OpenClawSessionMenuConnection) {
        self.connection = connection
        self._bridge = State(initialValue: IOSSidebarPluginBridge(sessionTarget: target))
    }

    var body: some View {
        VStack(spacing: 0) {
            if let failure = self.bridge.failure {
                Text(verbatim: failure).font(OpenClawType.body)
                    .foregroundStyle(OpenClawBrand.danger).padding()
            }
            if self.bridge.pending { ProgressView().accessibilityLabel("Running plugin action").padding() }
            if !self.bridge.showsWebContent {
                List {
                    if !self.bridge.ready, self.bridge.failure == nil {
                        ProgressView().accessibilityLabel("Loading plugin actions")
                    }
                    ForEach(self.bridge.sessionActions) { action in
                        Button { self.bridge.sendSessionAction(action, revision: self.bridge.revision) } label: {
                            Text(verbatim: action.label).font(OpenClawType.body)
                        }.disabled(action.disabled || self.bridge.pending || !self.connection.isCurrent())
                    }
                    if self.bridge.ready, self.bridge.sessionActions.isEmpty, self.bridge.failure == nil {
                        Text("No web plugin actions are available for this session.").font(OpenClawType.body)
                    }
                }
            }
            RootSidebarPluginRuntime(bridge: self.bridge, isCurrent: self.connection.isCurrent)
                .frame(maxHeight: self.bridge.showsWebContent ? .infinity : 1)
                .opacity(self.bridge.showsWebContent ? 1 : 0)
                .accessibilityHidden(!self.bridge.showsWebContent)
        }
        .navigationTitle("Web Plugin Actions")
        .toolbar {
            if self.bridge.showsWebContent {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { self.bridge.showsWebContent = false } label: {
                        Text("Actions").font(OpenClawType.subheadSemiBold)
                    }
                }
            }
        }
    }
}

/// Plugin-owned schemas remain data. Native controls cover scalar object fields; arbitrary JSON schemas
/// retain a complete input path and are validated by the Gateway's existing plugin action owner.
private struct CommandSessionPluginActionForm: View {
    let session: OpenClawChatSessionEntry
    let connection: OpenClawSessionMenuConnection
    let descriptor: CommandSessionPluginDescriptor
    @State private var values: [String: String] = [:]
    @State private var raw = "{}"
    @State private var result: String?
    @State private var failure: String?
    @State private var saving = false

    private var schema: [String: AnyCodable]? {
        self.descriptor.schema?.value as? [String: AnyCodable]
    }

    private var fields: [(String, [String: AnyCodable])]? {
        guard self.schema?["type"]?.value as? String == "object",
              let properties = self.schema?["properties"]?.value as? [String: AnyCodable] else { return nil }
        var fields: [(String, [String: AnyCodable])] = []
        for key in properties.keys.sorted() {
            guard let field = properties[key]?.value as? [String: AnyCodable],
                  let type = field["type"]?.value as? String,
                  ["string", "number", "integer", "boolean"].contains(type) else { return nil }
            fields.append((key, field))
        }
        return fields
    }

    var body: some View {
        Form {
            if let description = self.descriptor.description {
                Text(verbatim: description).font(OpenClawType.body)
            }
            if let fields {
                ForEach(fields, id: \.0) { name, field in
                    self.input(name: name, field: field)
                }
            } else if self.descriptor.schema != nil {
                Section {
                    TextEditor(text: self.$raw).font(OpenClawType.body).frame(minHeight: 150)
                        .autocorrectionDisabled().textInputAutocapitalization(.never)
                        .accessibilityLabel("Action input JSON")
                    DisclosureGroup {
                        Text(verbatim: self.json(self.descriptor.schema!)).font(OpenClawType.caption)
                            .textSelection(.enabled)
                    } label: { Text("Input Format").font(OpenClawType.body) }
                } header: { Text("Action Input (JSON)").font(OpenClawType.captionSemiBold) }
            }
            if let failure { Text(failure).font(OpenClawType.body).foregroundStyle(OpenClawBrand.danger) }
            if let result { Text(verbatim: result).font(OpenClawType.body).textSelection(.enabled) }
            Button { self.invoke() } label: {
                HStack {
                    Text(verbatim: self.descriptor.label).font(OpenClawType.subheadSemiBold)
                    if self.saving { ProgressView() }
                }
            }.disabled(self.saving || !self.descriptor.allowed(by: self.connection))
        }
        .navigationTitle(self.descriptor.label)
        .task { self.installDefaults() }
    }

    @ViewBuilder private func input(name: String, field: [String: AnyCodable]) -> some View {
        let title = field["title"]?.value as? String ?? name
        let value = Binding(get: { self.values[name] ?? "" }, set: { self.values[name] = $0 })
        if field["type"]?.value as? String == "boolean" {
            Toggle(isOn: Binding(get: { self.values[name] == "true" }, set: { self.values[name] = String($0) })) {
                Text(verbatim: title).font(OpenClawType.body)
            }
        } else if let choices = field["enum"]?.value as? [AnyCodable] {
            Picker(selection: value) {
                Text("Choose…").font(OpenClawType.body).tag("")
                ForEach(Array(choices.enumerated()), id: \.offset) { _, choice in
                    let label = (choice.value as? String) ?? self.json(choice)
                    Text(verbatim: label).font(OpenClawType.body).tag(label)
                }
            } label: { Text(verbatim: title).font(OpenClawType.body) }
        } else {
            TextField(text: value, prompt: Text(verbatim: title).font(OpenClawType.body)) {
                Text(verbatim: title).font(OpenClawType.body)
            }.font(OpenClawType.body).autocorrectionDisabled().textInputAutocapitalization(.never)
        }
        if let description = field["description"]?.value as? String {
            Text(verbatim: description).font(OpenClawType.caption).foregroundStyle(.secondary)
        }
    }

    private func installDefaults() {
        guard self.values.isEmpty else { return }
        if let fields {
            for (name, field) in fields {
                if let value = field["default"] { self.values[name] = value.value as? String ?? self.json(value) }
            }
        } else if let value = self.schema?["default"] { self.raw = self.json(value) }
    }

    private func payload() throws -> AnyCodable? {
        guard self.descriptor.schema != nil else { return nil }
        guard let fields else { return try JSONDecoder().decode(AnyCodable.self, from: Data(self.raw.utf8)) }
        let required = (self.schema?["required"]?.value as? [AnyCodable] ?? []).compactMap { $0.value as? String }
        var result: [String: AnyCodable] = [:]
        for (name, field) in fields {
            guard let value = self.values[name] ?? (required.contains(name) ? "" : nil) else { continue }
            let type = field["type"]?.value as? String
            if type == "string" {
                result[name] = .init(value)
            } else if type == "boolean" {
                result[name] = .init(value == "true")
            } else if type == "integer", let number = Int(value) {
                result[name] = .init(number)
            } else if type == "number", let number = Double(value), number.isFinite {
                result[name] = .init(number)
            } else {
                throw NSError(domain: "PluginAction", code: 1, userInfo: [NSLocalizedDescriptionKey:
                        String(format: String(localized: "Enter a valid number for %@."), name)])
            }
        }
        return .init(result)
    }

    private func invoke() {
        self.saving = true
        self.failure = nil
        Task {
            defer { self.saving = false }
            do {
                guard self.descriptor.allowed(by: self.connection)
                else { throw OpenClawChatTransportSendError.notDispatched }
                var fields: [String: AnyCodable] = [
                    "pluginId": .init(self.descriptor.pluginId), "actionId": .init(self.descriptor.id),
                    "sessionKey": .init(self.session.key),
                ]
                if let agent = OpenClawChatSessionKey.agentID(from: self.session.key) ?? self.session.agentId {
                    fields["agentId"] = .init(agent)
                }
                fields["payload"] = try self.payload()
                struct Result: Decodable { let ok: Bool
                    let result: AnyCodable?
                    let error: String?
                }
                let response: Result = try await self.connection.read("plugins.sessionAction", fields)
                if response.ok {
                    self.result = response.result.map(self.json) ?? String(localized: "Action completed.")
                } else { self.failure = response.error ?? String(localized: "The plugin action failed.") }
            } catch { self.failure = error.localizedDescription }
        }
    }

    private func json(_ value: AnyCodable) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? encoder.encode(value)).flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }
}
