#if Talk && canImport(ElevenLabsKit) && (os(iOS) || os(macOS))
import Foundation
import OpenClawProtocol
import Testing
@testable import OpenClawKit

/// A fake audio device, not an actor: records the actual scheduleBuffer boundary.
private final class OffMainPlaybackProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var frames: [Data] = []
    private var scheduledOnMain = false

    func schedule(_ data: Data, sampleRate _: Double, completion _: @escaping @Sendable () -> Void) {
        self.lock.withLock {
            self.frames.append(data)
            self.scheduledOnMain = self.scheduledOnMain || Thread.isMainThread
        }
    }

    func snapshot() -> (frames: [Data], scheduledOnMain: Bool) {
        self.lock.withLock { (self.frames, self.scheduledOnMain) }
    }
}

@MainActor
struct RealtimeTalkRelaySessionOffMainTests {
    @Test func `new reply reaches audio device while main actor is stalled`() async throws {
        let events = AsyncStream<EventFrame>.makeStream()
        let created = try JSONEncoder().encode(TalkSessionCreateResult(
            sessionid: "relay-1",
            mode: AnyCodable("realtime"),
            transport: AnyCodable("gateway-relay"),
            brain: AnyCodable("agent-consult"),
            relaysessionid: "relay-1"))
        let probe = OffMainPlaybackProbe()
        let player = RealtimePCMStreamingAudioPlayer(
            preparePlayback: { _ in },
            scheduleFrame: probe.schedule,
            stopPlayback: {},
            playbackTime: { nil })
        let session = RealtimeTalkRelaySession(
            transport: RealtimeTalkRelayTransport(
                subscribeServerEvents: { _ in events.stream },
                request: { method, _, _ in
                    if method == "talk.session.create" {
                        events.continuation.yield(EventFrame(
                            type: "event",
                            event: "talk.event",
                            payload: AnyCodable(["relaySessionId": "relay-1", "type": "ready"])))
                        return created
                    }
                    if method == "talk.catalog" {
                        return try realtimeRelayCatalogData()
                    }
                    return Data("{\"ok\":true}".utf8)
                }),
            options: .init(sessionKey: "main", provider: nil, model: nil, voice: nil),
            audioCapture: TestRealtimeTalkAudioCapture(),
            pcmPlayer: player,
            onStatus: { _ in },
            onSpeakingChanged: { _ in })
        defer { session.stop()
            events.continuation.finish()
        }
        try await session.start()
        let stallStarted = RealtimeRelayTestSignal<Void>()
        let producer = Task.detached {
            _ = try await stallStarted.next("main actor stall")
            for index in 0..<80 {
                events.continuation.yield(outputAudioEvent(
                    turnId: "brand-new-turn", data: Data(repeating: UInt8(index + 1), count: 960)))
            }
            events.continuation.yield(outputAudioEvent(turnId: "brand-new-turn", data: Data([81, 81])))
            events.continuation.yield(outputAudioDoneEvent(turnId: "brand-new-turn"))
        }
        stallStarted.send(())
        let deadline = ProcessInfo.processInfo.systemUptime + 1.5
        while ProcessInfo.processInfo.systemUptime < deadline {}
        // Snapshot BEFORE releasing the main actor: after-the-stall delivery cannot pass.
        let duringStall = probe.snapshot()
        #expect(
            duringStall.frames.count == 81,
            "all frames, including the first and partial tail, must schedule DURING stall")
        #expect(duringStall.frames.first == Data(repeating: 1, count: 960), "the start of the reply must survive")
        #expect(!duringStall.scheduledOnMain, "scheduleBuffer must never require main")
        try await producer.value
    }
}
#endif
