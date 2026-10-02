import Foundation
import OpenClawKit

/// Relay captions are a live projection. Only their exact persisted transcript ID can retire them.
struct ChatRealtimeVoiceCaptions {
    private struct Caption {
        let relayID: String
        var message: OpenClawChatMessage
        var isFinal: Bool
    }

    private var captions: [Caption] = []

    mutating func receive(_ transcript: RealtimeTalkTranscript, history: [OpenClawChatMessage]) {
        let role = transcript.role
        guard ["user", "assistant"].contains(role),
              transcript.isFinal ? !transcript.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty :
              !transcript.text.isEmpty
        else { return }
        let relayID = transcript.relaySessionID ?? ""
        if role == "user" {
            // A new user utterance closes the interrupted assistant caption, as on the web.
            for index in self.captions.indices where self.captions[index].relayID == relayID &&
                self.captions[index].message.role == "assistant"
            {
                self.captions[index].isFinal = true
            }
        }
        let index = self.captions.lastIndex {
            $0.relayID == relayID && $0.message.role == role && !$0.isFinal
        }
        let previous = index.map { self.captions[$0].message }
        if previous == nil, let id = transcript.transcriptID,
           history.contains(where: { $0.transcriptMessageID == id && $0.role == role }) { return }
        // Both relay providers send complete final transcripts. Snapshot deltas replace;
        // ordinary fragments concatenate verbatim, including whitespace and subword pieces.
        let text = if transcript.isFinal || transcript.textMode == "snapshot" {
            transcript.text
        } else {
            (previous?.content.first?.text ?? "") + transcript.text
        }
        let message = OpenClawChatMessage(
            id: previous?.id ?? UUID(),
            role: role,
            content: [.init(type: "text", text: Self.boundText(text), mimeType: nil, fileName: nil, content: nil)],
            timestamp: previous?.timestamp ?? Date().timeIntervalSince1970 * 1000,
            transcriptMessageID: transcript.transcriptID,
            model: role == "assistant" ? "realtime-voice" : nil,
            provenance: .init(kind: "realtime_voice", sourceChannel: "talk"))
        let caption = Caption(relayID: relayID, message: message, isFinal: transcript.isFinal)
        if let index {
            self.captions[index] = caption
        } else if !self.captions.contains(where: {
            transcript.transcriptID != nil && $0.message.transcriptMessageID == transcript.transcriptID
        }) {
            self.captions.append(caption)
        }
        self.captions = Array(self.captions.suffix(60))
    }

    /// Match the web caption budget: preserve the opening context and latest tail,
    /// never split a surrogate pair at either UTF-16 truncation boundary.
    private static func boundText(_ text: String) -> String {
        let units = Array(text.utf16)
        guard units.count > 8000 else { return text }
        let marker = "\n…\n"
        let markerOffset = text.range(of: marker).map { text[..<$0.lowerBound].utf16.count }
        let prefixCount = markerOffset.map { (255...256).contains($0) ? $0 : 256 } ?? 256
        var head = Array(units.prefix(prefixCount))
        if let last = head.last, (0xD800...0xDBFF).contains(last) { head.removeLast() }
        var tail = Array(units.suffix(8000 - head.count - marker.utf16.count))
        if let first = tail.first, (0xDC00...0xDFFF).contains(first) { tail.removeFirst() }
        return String(decoding: head, as: UTF16.self) + marker + String(decoding: tail, as: UTF16.self)
    }

    func projecting(_ history: [OpenClawChatMessage]) -> [OpenClawChatMessage] {
        history + self.captions.map(\.message)
    }

    mutating func reconcile(
        _ history: [OpenClawChatMessage]) -> (messages: [OpenClawChatMessage], changed: Bool)
    {
        var messages = history
        let previousCount = self.captions.count
        self.captions.removeAll { caption in
            guard let id = caption.message.transcriptMessageID,
                  let index = messages.firstIndex(where: {
                      $0.transcriptMessageID == id && $0.role == caption.message.role
                  })
            else { return false }
            messages[index].id = caption.message.id
            return true
        }
        return (messages, previousCount != self.captions.count)
    }
}

extension OpenClawChatViewModel {
    public func receiveRealtimeVoiceTranscript(sessionKey: String, transcript: RealtimeTalkTranscript) {
        guard !self.isTransportDetached,
              self.matchesCurrentSessionKey(
                  incoming: sessionKey,
                  agentId: self.currentSessionSnapshot().deliveryAgentID,
                  current: self.sessionKey)
        else { return }
        self.realtimeVoiceCaptions.receive(transcript, history: self.messages)
        // History can win the final-caption race. Handoff uses the same path in either order.
        self.replaceMessages(self.messages)
        if transcript.role == "user", transcript.isFinal, let id = transcript.transcriptID {
            self.admitRealtimeVoiceTurn(sessionKey: sessionKey, transcriptID: id)
        }
        self.markTimelineChanged()
    }
}

extension OpenClawChatMessage {
    var isRealtimeVoiceTranscript: Bool {
        self.provenance?.kind == "realtime_voice" || self.model == "realtime-voice"
    }
}
