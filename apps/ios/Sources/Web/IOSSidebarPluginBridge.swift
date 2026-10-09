import Foundation
import Observation
import OpenClawKit
import WebKit

/// Document-scoped adapter for the Control UI's live plugin navigation registry.
/// It carries opaque action IDs, never JavaScript closures or guessed Gateway methods.
@MainActor
@Observable
final class IOSSidebarPluginBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let messageHandlerName = "openclawSidebarPlugins"
    struct Action: Codable, Hashable, Identifiable {
        let id: String
        let label: String
        let destructive: Bool
        let icon: String?
    }

    struct Entry: Codable, Hashable, Identifiable {
        let key: String
        let pluginId: String
        let label: String
        let parent: String?
        let defaultVisible: Bool
        let pageHref: String
        let icon: String?
        let actions: [Action]
        var id: String {
            self.key
        }
    }

    struct RegistrySnapshot: Equatable {
        let ownerID: String
        let connectionID: String
        let documentID: String
        let documentGeneration: UUID
        let revision: Int
        let entries: [Entry]
    }

    struct SessionTarget: Codable, Hashable {
        let key: String
        let sessionId: String
        let agentId: String
    }

    struct SessionAction: Decodable, Identifiable {
        let id: String
        let label: String
        let disabled: Bool
    }

    private struct Message: Decodable {
        let contract: Int
        let documentId: String
        let type: String
        let revision: Int?
        let connected: Bool?
        let entries: [Entry]?
        let sessionActions: [SessionAction]?
        let sessionError: String?
        let requestId: String?
        let ok: Bool?
        let error: String?
    }

    let sessionTarget: SessionTarget?
    init(sessionTarget: SessionTarget? = nil) {
        self.sessionTarget = sessionTarget
        super.init()
    }

    private(set) var registrySnapshot: RegistrySnapshot?
    var currentRegistrySnapshot: RegistrySnapshot? {
        guard self.ready, self.isCurrent(), let snapshot = self.registrySnapshot,
              snapshot.documentID == self.documentID, snapshot.documentGeneration == self.documentGeneration,
              snapshot.revision == self.revision else { return nil }
        return snapshot
    }

    private(set) var sessionActions: [SessionAction] = []
    private(set) var entries: [Entry] = []
    private(set) var revision = 0
    private(set) var ready = false
    private(set) var connected = false
    private(set) var pending = false
    var failure: String?
    var showsWebContent = false
    @ObservationIgnored private weak var webView: WKWebView?
    @ObservationIgnored private var gatewayURL: URL?
    @ObservationIgnored private var ownerID: String?
    @ObservationIgnored private var connectionID: String?
    @ObservationIgnored private var documentID: String?
    @ObservationIgnored private var documentGeneration = UUID()
    @ObservationIgnored private var pendingRequest: String?
    @ObservationIgnored private var deadline: Task<Void, Never>?
    @ObservationIgnored private var isCurrent: () -> Bool = { false }

    func configure(gatewayURL: URL, ownerID: String, connectionID: String, isCurrent: @escaping () -> Bool) {
        if self.ownerID != ownerID || self.connectionID != connectionID || self.gatewayURL != gatewayURL {
            self.retireDocument()
            self.showsWebContent = false
            self.failure = nil
        }
        self.ownerID = ownerID
        self.connectionID = connectionID
        self.gatewayURL = gatewayURL
        self.isCurrent = isCurrent
    }

    func seedScript(for url: URL) -> String? {
        var marker: [String: Any] = ["contract": 1]
        if let sessionTarget {
            marker["session"] = [
                "key": sessionTarget.key,
                "sessionId": sessionTarget.sessionId,
                "agentId": sessionTarget.agentId,
            ]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: marker),
              let json = String(data: data, encoding: .utf8) else { return nil }
        return IOSDeviceSettingsBridge.originGatedScript(
            "window.__OPENCLAW_NATIVE_SIDEBAR_PLUGINS__ = \(json);", url: url)
    }

    func attach(to webView: WKWebView) {
        self.webView = webView
    }

    func retireDocument() {
        self.deadline?.cancel()
        self.deadline = nil
        self.documentGeneration = UUID()
        self.documentID = nil
        self.registrySnapshot = nil
        self.ready = false
        self.connected = false
        self.entries = []
        self.sessionActions = []
        self.revision = 0
        self.pending = false
        self.pendingRequest = nil
    }

    func didCommitDocument() {
        self.retireDocument()
        let generation = self.documentGeneration
        self.deadline = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(12)) } catch { return }
            guard let self, generation == self.documentGeneration, !self.ready else { return }
            self.failure = String(localized:
                "Update this Gateway’s Control UI to enable native plugin menus.")
        }
    }

    func detach(from webView: WKWebView) {
        guard self.webView === webView else { return }
        self.retireDocument()
        self.webView = nil
    }

    func userContentController(
        _: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor (Any?, String?) -> Void)
    {
        guard self.isCurrent(), message.name == Self.messageHandlerName,
              IOSDeviceSettingsBridge.isTrustedSource(
                  message.frameInfo.request.url,
                  webViewURL: self.webView?.url,
                  gatewayURL: self.gatewayURL,
                  isMainFrame: message.frameInfo.isMainFrame,
                  isHostingWebView: message.webView === self.webView),
              JSONSerialization.isValidJSONObject(message.body),
              let data = try? JSONSerialization.data(withJSONObject: message.body), data.count <= 512_000,
              let value = try? JSONDecoder().decode(Message.self, from: data), value.contract == 1,
              let ownerID = self.ownerID, let connectionID = self.connectionID,
              !value.documentId.isEmpty, value.documentId.count <= 128
        else { replyHandler(nil, "Invalid plugin menu message.")
            return
        }
        if value.type == "snapshot", let revision = value.revision, let entries = value.entries,
           entries.count <= 256, entries.allSatisfy({ $0.actions.count <= 64 }),
           self.documentID == nil || self.documentID == value.documentId
        {
            guard revision > self.revision else { replyHandler(["ok": true], nil)
                return
            }
            self.documentID = value.documentId
            self.revision = revision
            self.entries = entries
            self.sessionActions = Array((value.sessionActions ?? []).prefix(256))
            if let sessionError = value.sessionError { self.failure = sessionError }
            self.connected = value.connected == true
            self.ready = true
            self.registrySnapshot = RegistrySnapshot(
                ownerID: ownerID,
                connectionID: connectionID,
                documentID: value.documentId,
                documentGeneration: self.documentGeneration,
                revision: revision,
                entries: entries)
            if !self.pending { self.deadline?.cancel() }
            if self.failure?.contains("native plugin menu bridge") == true { self.failure = nil }
            replyHandler(["ok": true], nil)
        } else if value.type == "result", self.documentID == value.documentId,
                  value.requestId == self.pendingRequest
        {
            self.deadline?.cancel()
            self.pending = false
            self.pendingRequest = nil
            if value.ok != true { self.failure = value.error ?? String(localized: "Plugin action failed.") }
            replyHandler(["ok": true], nil)
        } else { replyHandler(nil, "Stale plugin menu document.") }
    }

    func send(_ type: String, entry: Entry, action: Action? = nil, revision: Int) {
        self.send(type, key: entry.key, actionID: action?.id, revision: revision)
    }

    func sendSessionAction(_ action: SessionAction, revision: Int) {
        guard !action.disabled else { return }
        self.send("session-run", key: self.sessionTarget?.key ?? "", actionID: action.id, revision: revision)
    }

    private func send(_ type: String, key: String, actionID: String?, revision: Int) {
        guard self.isCurrent(), self.ready, self.connected, !self.pending,
              revision == self.revision, let documentID, let webView
        else {
            self.failure = String(localized: "The plugin menu changed. Reopen it and try again.")
            return
        }
        let requestID = UUID().uuidString
        var command: [String: Any] = [
            "contract": 1, "documentId": documentID, "requestId": requestID,
            "revision": revision, "type": type, "key": key,
        ]
        if let actionID { command["actionId"] = actionID }
        guard let data = try? JSONSerialization.data(withJSONObject: command),
              let json = String(data: data, encoding: .utf8) else { return }
        self.failure = nil
        self.pending = true
        self.pendingRequest = requestID
        self.showsWebContent = true
        self.deadline?.cancel()
        self.deadline = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            guard let self, self.pendingRequest == requestID else { return }
            self.pending = false
            self.pendingRequest = nil
            self
                .failure =
                String(localized: "The plugin has not confirmed this action. Check its page before retrying.")
        }
        Task { @MainActor [weak self, weak webView] in
            do {
                _ = try await webView?.evaluateJavaScript(
                    "window.dispatchEvent(new CustomEvent('openclaw:native-sidebar-plugin-command', " +
                        "{ detail: \(json) }));")
            } catch {
                guard let self, self.pendingRequest == requestID else { return }
                self.deadline?.cancel()
                self.pending = false
                self.pendingRequest = nil
                self.failure = error.localizedDescription
            }
        }
    }
}
