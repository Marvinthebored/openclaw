import Foundation
import Testing
@testable import OpenClawChatUI

struct ChatWorkChunksTests {
    private struct Fixture: Decodable {
        let cases: [Case]
        struct Case: Decodable {
            let name: String
            let live: Bool?
            let parts: [Part]
            let expected: [Output]
        }

        struct Part: Decodable {
            let id: String
            let kind: ChatWorkPartKind
        }

        struct Output: Decodable, Equatable {
            let kind: String
            let ids: [String]
        }
    }

    @Test func `shared portable contract`() throws {
        // Follow the existing TalkConfigContractTests repository-root fixture convention.
        var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while directory.path != "/",
              !FileManager.default.fileExists(atPath: directory.appendingPathComponent(
                  "test/fixtures/chat-work-chunks.json").path)
        {
            directory.deleteLastPathComponent()
        }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: directory.appendingPathComponent(
            "test/fixtures/chat-work-chunks.json")))
        for item in fixture.cases {
            let actual = ChatWorkChunks.project(item.parts, live: item.live ?? false, kind: { $0.kind }).map {
                Fixture.Output(kind: $0.isWork ? "work-chunk" : "visible", ids: $0.parts.map(\.id))
            }
            #expect(actual == item.expected, "\(item.name)")
        }
    }

    @Test func `mixed envelope keeps text and source identity`() throws {
        let source = try JSONDecoder().decode(OpenClawChatMessage.self, from: Data(#"""
        {"role":"assistant","phase":"final_answer","usage":{"input":10,"output":5},"content":[
          {"type":"thinking","thinking":"Private reasoning"},
          {"type":"text","text":"First finding."},
          {"type":"toolCall","id":"read","name":"read"},
          {"type":"tool_result","id":"read","text":"File contents"},
          {"type":"text","text":"Second finding."},
          {"type":"toolCall","id":"check","name":"check"},
          {"type":"tool_result","id":"check","text":"Checked"},
          {"type":"text","text":"Final answer."}
        ]}
        """#.utf8))
        let rows = ChatTranscriptRow.collapseCompletedWork([.message(source)], runWorking: false)
        let visible = rows.compactMap { row -> OpenClawChatMessage? in
            if case let .message(message) = row { return message }
            return nil
        }
        let work = rows.compactMap { row -> ChatTranscriptRow.CompletedWork? in
            if case let .completedWork(work) = row { return work }
            return nil
        }
        #expect(visible.map { ChatMessageVisibleText.visibleText(in: $0) } == [
            "First finding.", "Second finding.", "Final answer.",
        ])
        try #require(work.count == 3)
        #expect(work[0].messages[0].content[0].type == "thinking")
        #expect(work[1].messages[0].content.map(\.type) == ["toolCall", "tool_result"])
        #expect(visible.allSatisfy { $0.id == source.id })
        #expect(Set(rows.map(\.id)).count == rows.count)
        #expect(rows.map(\.id) == ChatTranscriptRow.collapseCompletedWork(
            [.message(source)], runWorking: false).map(\.id))
        #expect(visible.filter(\.presentationOwnsFooter).map(\.presentationID) == [visible[2].presentationID])
        #expect(work.allSatisfy { $0.durationMilliseconds == nil })
        #expect(source.content.count == 8)
        #expect(source.workPresentationParts.compactMap {
            ChatMessageUsagePresentation.make(message: $0, contextWindowTokens: nil)
        }.count == 1)
        let group = ChatAssistantRunGroup.build(
            rows, liveRunID: nil, hasLiveContent: false, searchActive: false)
        #expect(group.last?.answerID == visible.last?.presentationID)
    }

    @Test func `unphased narrative bounds independent work chunks`() {
        let text = { (value: String) in
            OpenClawChatMessage(role: "assistant", content: [.init(type: "text", text: value)], timestamp: nil)
        }
        let tool = {
            OpenClawChatMessage(role: "assistant", content: [
                .init(type: "toolCall", id: UUID().uuidString, name: "read"),
            ], timestamp: nil)
        }
        let source = [text("First"), tool(), text("Second"), tool(), text("Answer")]
        let rows = ChatTranscriptRow.collapseCompletedWork(source.map(ChatTranscriptRow.message), runWorking: false)
        #expect(rows.count == 5)
        #expect(rows.enumerated().allSatisfy { index, row in
            if index == 1 || index == 3 {
                if case .completedWork = row { return true }
                return false
            }
            if case let .message(message) = row { return message.id == source[index].id }
            return false
        })
        #expect(ChatTranscriptRow.collapseCompletedWork(
            source.map(ChatTranscriptRow.message), runWorking: true) == source.map(ChatTranscriptRow.message))
    }

    @Test func `empty text does not split work and projection does not serialize`() throws {
        let source = OpenClawChatMessage(role: "assistant", content: [
            .init(type: "text", text: "Narrative"),
            .init(type: "toolCall", id: "call", name: "read"),
            .init(type: "text", text: "   "),
            .init(type: "tool_result", text: "Done", id: "call"),
        ], timestamp: nil)
        let parts = source.workPresentationParts
        #expect(parts.count == 2)
        #expect(parts[1].content.map(\.type) == ["toolCall", "tool_result"])
        let roundTrip = try JSONDecoder().decode(OpenClawChatMessage.self, from: JSONEncoder().encode(parts[0]))
        #expect(roundTrip.presentationBlockIndex == nil)
        #expect(roundTrip.presentationOwnsFooter)
    }

    @Test(arguments: [false, true])
    func `separated recorded result keeps call outcome without duplicating result`(failed: Bool) {
        let source = OpenClawChatMessage(role: "assistant", content: [
            .init(type: "toolCall", id: "call", name: "read"),
            .init(type: "text", text: "A finding between call and result"),
            .init(type: "tool_result", text: "Recorded outcome", id: "call", isError: failed),
            .init(type: "text", text: "Answer"),
        ], timestamp: nil)
        let parts = source.workPresentationParts
        let items = parts.flatMap { message in
            ChatToolActivity.items(
                calls: message.content.filter(\.isToolCall),
                results: message.content.filter(\.isToolResult),
                recordedResults: message.presentationRecordedToolResults)
        }
        #expect(items.count == 2)
        #expect(items[0].state == (failed ? .failed : .finished))
        #expect(items[0].resultText == nil)
        #expect(items[1].resultText == "Recorded outcome")
    }

    @Test func `unfinished source cannot steal answer actions after splitting`() {
        let user = OpenClawChatMessage(role: "user", content: [], timestamp: 0, transcriptRunID: "run")
        let answer = OpenClawChatMessage(role: "assistant", content: [
            .init(type: "text", text: "Completed answer"),
        ], timestamp: 1, transcriptRunID: "run", phase: "final_answer")
        let unfinished = OpenClawChatMessage(role: "assistant", content: [
            .init(type: "text", text: "An unfinished update"),
            .init(type: "toolCall", id: "call", name: "read"),
        ], timestamp: 2, transcriptRunID: "run")
        let rows = ChatTranscriptRow.collapseCompletedWork(
            [user, answer, unfinished].map(ChatTranscriptRow.message), runWorking: false)
        let groups = ChatAssistantRunGroup.build(rows, liveRunID: nil, hasLiveContent: false, searchActive: false)
        #expect(groups.last?.answerID == answer.id)
        #expect(unfinished.workPresentationParts.allSatisfy { !$0.isCompletedReply })
    }

    @Test func `tool only error keeps its tail`() {
        let source = OpenClawChatMessage(role: "assistant", content: [
            .init(type: "thinking", thinking: "Hidden"),
            .init(type: "toolCall", id: "call", name: "read"),
        ], timestamp: nil, stopReason: "error", errorMessage: "Read failed")
        #expect(source.workPresentationParts == [source])
        #expect(ChatMessageVisibleText.visibleText(in: source).contains("Read failed"))
    }
}
