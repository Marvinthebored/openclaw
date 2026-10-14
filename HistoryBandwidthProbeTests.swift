import Foundation
import OpenClawKit
import Testing
@testable import OpenClawChatUI

private actor MeteredHistoryScript {
    private var step = 0
    private var calls = 0
    private var fullPages = 0
    private var bytes = 0

    func advance(to step: Int) {
        self.step = step
    }

    func metrics() -> (Int, Int, Int) {
        (self.calls, self.fullPages, self.bytes)
    }

    func read(sessionKey: String, cursor: String?) throws -> OpenClawChatHistoryPayload {
        self.calls += 1
        if cursor == nil { self.fullPages += 1 }
        let start = cursor.flatMap(Int.init).map { $0 + 1 } ?? 0
        let rows: [[String: Any]] = start <= self.step ? (start...self.step).map { index in
            let row: [String: Any] = [
                "role": index == 0 ? "user" : "assistant",
                "content": [["type": "text", "text": "row-" + String(index)]],
                "timestamp": index + 1,
                "__openclaw": ["id": "message-" + String(index)],
            ]
            return cursor == nil ? row : ["message": row]
        } : []
        var reply: [String: Any] = [
            "sessionKey": sessionKey,
            "messages": rows,
            "deltaCursor": String(self.step),
            "sessionInfo": ["hasActiveRun": false],
        ]
        if cursor == nil { reply["sessionId"] = "script-session" }
        else { reply["kind"] = "delta" }
        let data = try JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys])
        self.bytes += data.count
        return try JSONDecoder().decode(OpenClawChatHistoryPayload.self, from: data)
    }
}

private struct MeteredHistoryTransport: OpenClawChatTransport {
    let script: MeteredHistoryScript

    func requestHistory(sessionKey: String) async throws -> OpenClawChatHistoryPayload {
        try await self.script.read(sessionKey: sessionKey, cursor: nil)
    }

    func requestHistory(sessionKey: String, cursor: String) async throws -> OpenClawChatHistoryPayload {
        try await self.script.read(sessionKey: sessionKey, cursor: cursor)
    }

    func requestHealth(timeoutMs _: Int) async throws -> Bool {
        true
    }

    func events() -> AsyncStream<OpenClawChatTransportEvent> {
        AsyncStream { $0.finish() }
    }

    func sendMessage(
        sessionKey _: String,
        message _: String,
        thinking _: String,
        idempotencyKey _: String,
        attachments _: [OpenClawChatAttachmentPayload]) async throws -> OpenClawChatSendResponse
    {
        throw NSError(domain: "unused-probe-send", code: 1)
    }
}

struct HistoryBandwidthProbeTests {
    @Test @MainActor func `initial read eleven appended rows and idle refresh measure response bytes`() async {
        let script = MeteredHistoryScript()
        let model = OpenClawChatViewModel(sessionKey: "main", transport: MeteredHistoryTransport(script: script))
        defer { model.detachTransport() }
        #expect(await model.refreshHistoryAfterRun().applied)
        for step in 1...11 {
            await script.advance(to: step)
            #expect(await model.refreshHistoryAfterRun().applied)
        }
        #expect(await model.refreshHistoryAfterRun().applied)
        let (requests, full, bytes) = await script.metrics()
        print(
            "HISTORY_BANDWIDTH requests=",
            requests,
            "full=",
            full,
            "delta=",
            requests - full,
            "responseBytes=",
            bytes)
        #expect(requests == 13)
        #expect(full == 1)
        let actualTexts: [String] = model.messages.flatMap { message in
            message.content.compactMap(\.text)
        }
        let expectedTexts: [String] = (0...11).map { "row-" + String($0) }
        #expect(actualTexts == expectedTexts)
    }
}
