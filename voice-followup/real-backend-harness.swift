#if Talk && canImport(ElevenLabsKit) && (os(iOS) || os(macOS))
import Foundation
import OpenClawProtocol
import Testing
@testable import OpenClawKit

private final class RealBackendAckProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var marks: [String] = []
    private var onMain = false
    func record(_ params: [String: AnyCodable]?) {
        self.lock.withLock {
            self.marks.append(params?["markName"]?.stringValue ?? "missing")
            self.onMain = self.onMain || Thread.isMainThread
        }
    }
    func snapshot() -> ([String], Bool) { self.lock.withLock { (self.marks, self.onMain) } }
}

@MainActor
struct RealtimeTalkRealBackendProofTests {
    @Test func `silent real OS playback completes during main actor contention`() async throws {
        let events = AsyncStream<EventFrame>.makeStream()
        let created = try JSONEncoder().encode(TalkSessionCreateResult(
            sessionid: "relay-1", mode: AnyCodable("realtime"),
            transport: AnyCodable("gateway-relay"), brain: AnyCodable("agent-consult"),
            relaysessionid: "relay-1"))
        let probe = RealBackendAckProbe()
        let session = RealtimeTalkRelaySession(
            transport: RealtimeTalkRelayTransport(
                subscribeServerEvents: { _ in events.stream },
                request: { method, params, _ in
                    if method == "talk.session.create" {
                        events.continuation.yield(EventFrame(type: "event", event: "talk.event",
                            payload: AnyCodable(["relaySessionId": "relay-1", "type": "ready"])))
                        return created
                    }
                    if method == "talk.catalog" { return try realtimeRelayCatalogData() }
                    if method == "talk.session.acknowledgeMark" { probe.record(params) }
                    return Data("{\"ok\":true}".utf8)
                }),
            options: .init(sessionKey: "isolated-proof", provider: nil, model: nil, voice: nil),
            audioCapture: TestRealtimeTalkAudioCapture(),
            pcmPlayer: RealtimePCMStreamingAudioPlayer(),
            onStatus: { _ in }, onSpeakingChanged: { _ in })
        defer { session.stop(); events.continuation.finish() }
        try await session.start()
        let stalled = RealtimeRelayTestSignal<Void>()
        let producer = Task.detached {
            _ = try await stalled.next("real backend main actor stall")
            for _ in 0..<20 {
                events.continuation.yield(outputAudioEvent(turnId: "silent-proof", data: Data(repeating: 0, count: 960)))
            }
            events.continuation.yield(playbackMarkEvent("real-backend-played"))
            events.continuation.yield(outputAudioDoneEvent(turnId: "silent-proof"))
        }
        stalled.send(())
        let deadline = ProcessInfo.processInfo.systemUptime + 2
        while ProcessInfo.processInfo.systemUptime < deadline {}
        let duringStall = probe.snapshot()
        print("REAL_BACKEND_PROOF pcm16ZeroFrames=20 bytes=19200 mainActorStallSeconds=2 ackDuringStall=\(duringStall.0) ackOnMain=\(duringStall.1)")
        #expect(duringStall.0 == ["real-backend-played"])
        #expect(!duringStall.1)
        try await producer.value
    }
}
#endif
