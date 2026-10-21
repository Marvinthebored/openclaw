import Foundation
import OpenClawKit
import OpenClawProtocol
import Testing
@testable import OpenClaw
@testable import OpenClawChatUI

/// Measurement decorator: all history bytes and decoding use the production iOS adapter.
/// Live events are intentionally not consumed, so each measured observation is explicitly admitted.
private struct ObservedHistoryTransport: OpenClawChatTransport {
    let real: IOSGatewayChatTransport
    let cursorless: Bool
    func requestHistory(sessionKey: String) async throws -> OpenClawChatHistoryPayload {
        try await real.requestHistory(sessionKey: sessionKey)
    }
    func requestHistory(sessionKey: String, cursor: String) async throws -> OpenClawChatHistoryPayload {
        if cursorless { return try await real.requestHistory(sessionKey: sessionKey) }
        return try await real.requestHistory(sessionKey: sessionKey, cursor: cursor)
    }
    func sendMessage(sessionKey: String, message: String, thinking: String, idempotencyKey: String,
                     attachments: [OpenClawChatAttachmentPayload]) async throws -> OpenClawChatSendResponse {
        try await real.sendMessage(sessionKey: sessionKey, message: message, thinking: thinking,
                                   idempotencyKey: idempotencyKey, attachments: attachments)
    }
    func requestHealth(timeoutMs: Int) async throws -> Bool { try await real.requestHealth(timeoutMs: timeoutMs) }
    func events() -> AsyncStream<OpenClawChatTransportEvent> { AsyncStream { $0.finish() } }
}

/// App-hosted test: real URLSession websocket, production iOS adapter and shared history VM.
/// No test socket or fabricated history response is installed.
@MainActor
struct RealHistoryGatewayProof {
    private func control(_ phase: String) async throws {
        let url = URL(string: "http://127.0.0.1:19154/phase/" + phase)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: request)
        #expect((response as? HTTPURLResponse)?.statusCode == 200)
    }

    @Test func realGatewayHistory() async throws {
        let env = ProcessInfo.processInfo.environment
        let token = try #require(env["PROOF_TOKEN"])
        let gateway = GatewayNodeSession()
        let options = GatewayConnectOptions(
            role: "operator", scopes: ["operator.admin", "operator.read", "operator.write"],
            scopesAreExplicit: true, caps: [], commands: [], permissions: [:],
            clientId: "openclaw-ios", clientMode: "ui", clientDisplayName: "History Proof",
            includeDeviceIdentity: true, allowStoredDeviceAuth: false,
            deviceAuthGatewayID: "isolated-history-proof")
        try await gateway.connect(
            url: URL(string: "ws://127.0.0.1:19152")!,
            credentials: .init(token: token), connectOptions: options, sessionBox: nil,
            onConnected: {}, onDisconnected: { _ in },
            onInvoke: { BridgeInvokeResponse(id: $0.id, ok: true) })
        do {
            @discardableResult
            func rpc(_ method: String, _ params: [String: Any]) async throws -> Data {
                let data = try JSONSerialization.data(withJSONObject: params, options: [.sortedKeys])
                return try await gateway.request(method: method,
                    paramsJSON: String(decoding: data, as: UTF8.self), timeoutSeconds: 60)
            }
            let real = IOSGatewayChatTransport(gateway: gateway, globalAgentId: "main")
            let seed = "Synthetic seed " + String(repeating: "amber birch cedar delta ", count: 200)
            var measured: OpenClawChatViewModel?
            for mode in ["before", "after"] {
                let session = "agent:main:dashboard:public-history-proof-" + mode
                try await control("seed-" + mode)
                try await rpc("sessions.create", ["key": session, "agentId": "main",
                    "label": "Synthetic History Proof " + mode, "worktree": false])
                for index in 1...8 {
                    try await rpc("chat.inject", ["sessionKey": session, "message": "Seed row \(index) " + seed])
                }
                let transport = ObservedHistoryTransport(real: real, cursorless: mode == "before")
                let vm = OpenClawChatViewModel(sessionKey: session, transport: transport, activeAgentId: "main")
                // Keep run fallback timers outside this explicit wire-observation window.
                vm.pendingRunRefreshDelaysMs = [600_000]
                vm.pendingRunSteadyRefreshDelayMs = 600_000
                func texts() -> [String] { vm.messages.map { $0.content.compactMap(\.text).joined(separator: "\n") } }
                try await control(mode + "-full")
                #expect(await vm.refreshHistoryAfterRun().applied)
                #expect(vm.messages.count == 8)
                #expect(texts().allSatisfy { $0.contains(seed) })
                for index in 1...11 {
                    try await control("seed-" + mode)
                    let text = "Synthetic appended row \(index)"
                    try await rpc("chat.inject", ["sessionKey": session, "message": text])
                    try await control(mode + "-append-\(index)")
                    #expect(await vm.refreshHistoryAfterRun().applied)
                    #expect(vm.messages.count == 8 + index)
                    #expect(texts().last?.contains(text) == true)
                }
                let before = texts()
                try await control(mode + "-unchanged")
                #expect(await vm.refreshHistoryAfterRun().applied)
                #expect(texts() == before)
                if mode == "after" { measured = vm } else { vm.detachTransport() }
            }
            let vm = try #require(measured)
            defer { vm.detachTransport() }
            let key = "agent:main:dashboard:public-history-proof-after"
            func texts() -> [String] { vm.messages.map { $0.content.compactMap(\.text).joined(separator: "\n") } }

            try await control("seed-run")
            let sent = try await rpc("chat.send", ["sessionKey": key,
                "message": "Synthetic active run question", "idempotencyKey": UUID().uuidString])
            let ack = try #require(JSONSerialization.jsonObject(with: sent) as? [String: Any])
            let runID = try #require(ack["runId"] as? String)
            try await control("wait-model")
            try await control("run-start")
            let active = await vm.refreshHistoryAfterRun()
            #expect(active.applied && active.hasInFlightRun && active.sessionHasActiveRun)
            #expect(vm.pendingRunCount == 1)
            #expect(texts().contains { $0.contains(seed) })
            // Exercise real recovery admission: it retires local ownership, then re-adopts the wire snapshot.
            try await control("run-gap-recovery")
            await vm.handleTransportEvent(.seqGap)?.value
            #expect(vm.pendingRunCount == 1)
            #expect(texts().contains { $0.contains("Synthetic active run question") })
            #expect(texts().contains { $0.contains("Synthetic appended row 11") })
            try await control("release-model")
            try await rpc("agent.wait", ["runId": runID, "timeoutMs": 120000])
            try await control("run-final")
            let finished = await vm.refreshHistoryAfterRun()
            #expect(finished.applied && !finished.hasInFlightRun)
            #expect(texts().contains { $0.contains("Synthetic completed active run") })
            #expect(texts().contains { $0.contains(seed) })

            // Mutate on server without notifying this VM: its accepted cursor MUST be stale.
            try await control("seed-reset")
            try await rpc("sessions.reset", ["key": key])
            try await rpc("chat.inject", ["sessionKey": key, "message": "Synthetic reset survivor"])
            try await control("reset-recovery")
            let recovered = await vm.refreshHistoryAfterRun()
            #expect(recovered.applied)
            #expect(texts().contains { $0.contains("Synthetic reset survivor") })
            #expect(!texts().contains { $0.contains("Synthetic appended row") })
            #expect(!texts().contains { $0.contains(seed) })

            try await control("done")
            print("REAL_APP_GATEWAY_HISTORY_PASS before=13 after=13 append=11 unchanged activeRun gapRecovery final resetRecovery")
            await gateway.disconnect()
        } catch {
            await gateway.disconnect()
            throw error
        }
    }
}
