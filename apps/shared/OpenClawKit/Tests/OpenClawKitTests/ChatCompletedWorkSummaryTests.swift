import Foundation
import Testing
@testable import OpenClawChatUI

@Suite("Completed work summary")
struct ChatCompletedWorkSummaryTests {
    @Test func `no tools`() {
        #expect(Self.label([]) == "Worked")
        #expect(Self.label([], duration: 2000) == "Worked for 2s")
    }

    @Test func `mixed kinds and expansion`() throws {
        let messages = try Self.decode("""
        {"role":"assistant","content":[
          {"type":"toolCall","id":"a","name":"exec","arguments":{}},
          {"type":"toolCall","id":"b","name":"read","arguments":{}},
          {"type":"toolResult","id":"a","text":"ok"},
          {"type":"toolResult","id":"b","text":"ok"}
        ]}
        """)
        #expect(Self.label(messages, duration: 2000) == "Worked for 2s · 1 command · 1 read")
        #expect(Self.label(messages, expanded: true) == "Worked · 2 tool calls · 1 command · 1 read")
    }

    @Test func `failed skipped and hidden`() throws {
        let messages = try Self.decode("""
        {"role":"assistant","content":[
          {"type":"toolCall","id":"a","name":"exec"},
          {"type":"toolCall","id":"b","name":"read"},
          {"type":"toolCall","id":"c","name":"read"}
        ],"activity":[
          {"itemId":"a","toolCallId":"a","kind":"tool","phase":"end","title":"Exec","status":"failed"},
          {"itemId":"b","toolCallId":"b","kind":"tool","phase":"end","title":"Read","status":"skipped"},
          {"itemId":"c","toolCallId":"c","kind":"tool","phase":"end","title":"Read",
           "status":"completed","hideFromChannelProgress":true}
        ]}
        """)
        #expect(Self.label(messages) == "Worked · 1 command · 1 read · 1 failed · 1 skipped")
        let encoded = try JSONEncoder().encode(messages[0])
        let restored = try JSONDecoder().decode(OpenClawChatMessage.self, from: encoded)
        #expect(restored.activity == messages[0].activity)
        #expect(Self.label([restored]) == Self.label(messages))
    }

    @Test func `deduplicates calls and unwraps display identity`() throws {
        let messages = try Self.decode("""
        {"role":"assistant","content":[
          {"type":"toolCall","id":"a","name":"dispatch_action",
           "arguments":{"id":"openclaw:host:read","args":{}}},
          {"type":"toolResult","id":"a","text":"ok"}
        ]}
        """)
        #expect(Self.label(messages + messages) == "Worked · 1 read")
    }

    private static func decode(_ json: String) throws -> [OpenClawChatMessage] {
        try [JSONDecoder().decode(OpenClawChatMessage.self, from: Data(json.utf8))]
    }

    private static func label(
        _ messages: [OpenClawChatMessage],
        duration: Double? = nil,
        expanded: Bool = false) -> String
    {
        ChatCompletedWorkSummary.label(
            work: .init(anchorID: UUID(), messages: messages, durationMilliseconds: duration),
            expanded: expanded)
    }
}
