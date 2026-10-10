import Foundation
import OpenClawKit
import UIKit
import WebKit
import XCTest
@testable import OpenClaw

@MainActor
final class SidebarPluginRuntimeProof: XCTestCase {
    func testProductionAuthorityRejectsStaleAndUntrustedCallers() async throws {
        let token = try XCTUnwrap(ProcessInfo.processInfo.environment["SIDEBAR_PROOF_TOKEN"])
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:19090/"))
        let config = GatewayConnectConfig(url: URL(string: "ws://127.0.0.1:19090/")!, stableID: "authority-proof", tls: nil, token: token, bootstrapToken: nil, password: nil, nodeOptions: GatewayConnectOptions(role: "node", scopes: [], caps: [], commands: [], permissions: [:], clientId: "openclaw-ios", clientMode: "node", clientDisplayName: "Synthetic authority proof"))
        let bridge = IOSSidebarPluginBridge()
        bridge.configure(gatewayURL: url, ownerID: "authority-proof", connectionID: "proof-connection") { true }
        let auth = try XCTUnwrap(AuthenticatedControlUI.authUserScript(config: config, pageURL: url, storedOperatorToken: nil, usesNativeNavigationChrome: true))
        let coordinator = AuthenticatedControlUIWebViewCoordinator(url: url, tls: nil, authScript: auth, sidebarPluginBridge: bridge, usesNativeEmbed: true)
        let webConfig = WKWebViewConfiguration()
        webConfig.websiteDataStore = .nonPersistent()
        coordinator.installUserScripts(in: webConfig.userContentController)
        webConfig.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: IOSSidebarPluginBridge.messageHandlerName)
        let frameProbe = AuthorityFrameProbe()
        webConfig.userContentController.add(frameProbe, contentWorld: .page, name: "authorityFrameProbe")
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 393, height: 852), configuration: webConfig)
        bridge.attach(to: webView); webView.navigationDelegate = coordinator
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene); let controller = UIViewController(); controller.view = webView
        window.rootViewController = controller; window.makeKeyAndVisible()
        defer { bridge.detach(from: webView); webConfig.userContentController.removeScriptMessageHandler(forName: IOSSidebarPluginBridge.messageHandlerName, contentWorld: .page); webView.stopLoading(); webView.navigationDelegate = nil; window.isHidden = true }
        webView.load(URLRequest(url: url))
        try await ready(bridge)
        try await setCase("positive-before", webView)
        try await sendCurrent(bridge)
        try await count(1, webView)
        print("AUTHORITY positive-before authenticatedEffects=1")

        let snapshot = try XCTUnwrap(bridge.currentRegistrySnapshot)
        let entry = try XCTUnwrap(bridge.entries.first { $0.pluginId == "sidebar-native-proof" })
        let action = try XCTUnwrap(entry.actions.first { $0.id == "record" })
        let heldCommand: [String: Any] = ["contract":1,"documentId":snapshot.documentID,"requestId":"retired-command","revision":snapshot.revision,"type":"run","key":entry.key,"actionId":action.id]
        let forged: [String: Any] = ["contract":1,"documentId":snapshot.documentID,"type":"snapshot","revision":snapshot.revision + 10000,"connected":true,"entries":[]]
        webConfig.userContentController.addUserScript(WKUserScript(source: """
        if (window !== window.top) window.webkit.messageHandlers.authorityFrameProbe.postMessage({ready:true});
        """, injectionTime: .atDocumentEnd, forMainFrameOnly: false))
        try await setCase("untrusted-frame", webView)
        _ = try await webView.evaluateJavaScript("const f=document.createElement('iframe');f.id='authorityProbe';f.srcdoc='<html><body>Frame boundary probe</body></html>';document.body.append(f);")
        try await awaitCondition(seconds: 10) { frameProbe.frame != nil }
        let childFrame = try XCTUnwrap(frameProbe.frame)
        XCTAssertFalse(childFrame.isMainFrame)
        let subframe = try await webView.callAsyncJavaScript("try { await window.webkit.messageHandlers.openclawSidebarPlugins.postMessage(payload); return 'accepted'; } catch(error) { return String(error); }", arguments: ["payload":forged], in: childFrame, contentWorld: .page)
        _ = try await webView.evaluateJavaScript("document.getElementById('authorityProbe').remove();")
        guard String(describing: subframe).contains("Invalid plugin menu message") else {
            XCTFail("Child frame did not reach the production rejection: \(String(describing: subframe))")
            throw NSError(domain: "AuthorityFrameProbe", code: 1)
        }
        XCTAssertEqual(bridge.revision, snapshot.revision)
        try await count(1, webView)
        print("AUTHORITY same-origin-child-frame rejectedByProductionWKHandler=true authenticatedEffects=1")

        let otherConfig = WKWebViewConfiguration(); otherConfig.websiteDataStore = .nonPersistent()
        otherConfig.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: IOSSidebarPluginBridge.messageHandlerName)
        let other = WKWebView(frame: .zero, configuration: otherConfig)
        other.loadHTMLString("<html><body>Untrusted authority probe</body></html>", baseURL: URL(string:"https://untrusted.invalid/")!)
        try await awaitCondition(seconds:10) { !other.isLoading && other.url != nil }
        let foreign = try await other.callAsyncJavaScript("try { await window.webkit.messageHandlers.openclawSidebarPlugins.postMessage(payload); return 'accepted'; } catch(e) { return String(e); }", arguments:["payload":forged], in:nil, contentWorld:.page)
        XCTAssertTrue(String(describing:foreign).contains("Invalid plugin menu message"),String(describing:foreign))
        otherConfig.userContentController.removeScriptMessageHandler(forName:IOSSidebarPluginBridge.messageHandlerName,contentWorld:.page)
        other.stopLoading()
        try await count(1,webView)
        print("AUTHORITY foreign-hosting-document rejectedByProductionWKHandler=true authenticatedEffects=1")

        try await setCase("retired-registration",webView)
        _ = try await webView.evaluateJavaScript("window.__authorityFixture.replace();")
        try await awaitCondition(seconds:10) { bridge.revision > snapshot.revision }
        try await dispatch(heldCommand,webView)
        bridge.send("run", entry:entry, action:action, revision:snapshot.revision)
        XCTAssertFalse(bridge.pending)
        XCTAssertNotNil(bridge.failure)
        try await count(1,webView)
        print("AUTHORITY retired-registration oldNativeMenuAndWebCommandRejected=true authenticatedEffects=1")

        let oldDocument = snapshot.documentID
        webView.reload()
        try await awaitCondition(seconds:60) { bridge.ready && bridge.connected && bridge.currentRegistrySnapshot?.documentID != oldDocument && bridge.entries.contains { $0.pluginId == "sidebar-native-proof" } }
        try await ready(bridge)
        try await setCase("retired-document",webView)
        var retiredCommand = heldCommand
        retiredCommand["revision"] = bridge.revision
        try await dispatch(retiredCommand,webView)
        try await count(1,webView)
        print("AUTHORITY retired-document replayWithCurrentRevisionRejected=true authenticatedEffects=1")
        try await setCase("positive-after",webView)
        try await sendCurrent(bridge)
        try await count(2,webView)
        print("AUTHORITY positive-after authenticatedEffects=2 negatives=4 forbiddenEffects=0 productionBridge=true")
    }
    private func json(_ value:Any) throws -> String { String(data:try JSONSerialization.data(withJSONObject:value),encoding:.utf8)! }
    private func dispatch(_ value:[String:Any],_ view:WKWebView) async throws { _ = try await view.evaluateJavaScript("window.dispatchEvent(new CustomEvent('openclaw:native-sidebar-plugin-command',{detail:\(try json(value))}));") }
    private func setCase(_ label:String,_ view:WKWebView) async throws { _ = try await view.evaluateJavaScript("window.__authorityFixture.caseLabel='\(label)';") }
    private func count(_ expected:Int,_ view:WKWebView) async throws {
        let result = try await view.callAsyncJavaScript("return await window.__authorityFixture.status();",arguments:[:],in:nil,contentWorld:.page)
        let value = try XCTUnwrap(result as? [String:Any]); XCTAssertEqual(value["invocationCount"] as? Int,expected)
    }
    private func sendCurrent(_ bridge:IOSSidebarPluginBridge) async throws {
        let entry=try XCTUnwrap(bridge.entries.first { $0.pluginId == "sidebar-native-proof" }); let action=try XCTUnwrap(entry.actions.first { $0.id == "record" })
        bridge.send("run",entry:entry,action:action,revision:bridge.revision)
        try await awaitCondition(seconds:20) { !bridge.pending }; XCTAssertNil(bridge.failure)
    }
    private func ready(_ bridge:IOSSidebarPluginBridge) async throws {
        try await awaitCondition(seconds:90) { bridge.ready && bridge.connected && bridge.entries.contains { $0.pluginId == "sidebar-native-proof" } }
        var revision=bridge.revision;var changed=Date()
        try await awaitCondition(seconds:10) { if bridge.revision != revision { revision=bridge.revision;changed=Date() };return Date().timeIntervalSince(changed)>0.8 }
    }
    private func awaitCondition(seconds:Double,_ predicate:@escaping @MainActor () async -> Bool) async throws {
        let deadline=Date().addingTimeInterval(seconds)
        while Date()<deadline { if await predicate() { return }; try await Task.sleep(for:.milliseconds(100)) }
        XCTFail("Authority proof condition timed out");throw NSError(domain:"AuthorityProof",code:1)
    }
}

@MainActor
private final class AuthorityFrameProbe: NSObject, WKScriptMessageHandler {
    var frame: WKFrameInfo?
    func userContentController(_: WKUserContentController, didReceive message: WKScriptMessage) {
        if !message.frameInfo.isMainFrame { frame = message.frameInfo }
    }
}
