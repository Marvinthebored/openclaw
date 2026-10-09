import Foundation
import OpenClawChatUI
import OpenClawProtocol
import Testing
@testable import OpenClaw

@MainActor
struct CommandSessionMenuTests {
    @Test func `shared links use canonical gateway mount and never include credentials`() {
        let session = OpenClawChatSessionEntry(key: "agent:research:release/plan")
        let link = CommandSessionLink.url(
            config: nil, canonicalBase: "wss://user:password@gateway.example/control/?token=secret#secret",
            session: session, preview: true)
        #expect(link?.absoluteString == "https://gateway.example/control/share/chat/research/~key/release%2Fplan")
        #expect(CommandSessionLink.url(
            config: nil, canonicalBase: "javascript:alert(1)", session: session, preview: false) == nil)
    }

    @Test func `global and bare session links require the clicked owner rather than selected agent`() {
        var session = OpenClawChatSessionEntry(key: "global")
        #expect(CommandSessionLink.url(
            config: nil,
            canonicalBase: "https://gateway.example",
            session: session,
            preview: false) == nil)
        session.agentId = "research"
        #expect(CommandSessionLink.url(
            config: nil,
            canonicalBase: "https://gateway.example",
            session: session,
            preview: false)?.path == "/chat/research")
        session.key = "~dot"
        #expect(CommandSessionLink.url(
            config: nil,
            canonicalBase: "https://gateway.example",
            session: session,
            preview: false)?.path == "/chat/research/~key/~~dot")
    }

    @Test func `plugin descriptor honors all required scopes and current connection`() throws {
        let descriptor = try JSONDecoder().decode(CommandSessionPluginDescriptor.self, from: Data(#"""
        {"id":"approve","pluginId":"fixture","surface":"session","label":"Approve","requiredScopes":["operator.write","operator.approvals"]}
        """#.utf8))
        var current = true
        func connection(_ scopes: Set<String>) -> OpenClawSessionMenuConnection {
            .init(methods: ["plugins.sessionAction"], scopes: scopes, isCurrent: { current }, request: { _ in Data() })
        }
        #expect(!descriptor.allowed(by: connection(["operator.write"])))
        let permitted = connection(["operator.write", "operator.approvals"])
        #expect(descriptor.allowed(by: permitted))
        current = false
        #expect(!descriptor.allowed(by: permitted))
    }
}
