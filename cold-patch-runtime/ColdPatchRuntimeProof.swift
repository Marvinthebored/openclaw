import Foundation
import OpenClawKit
import Testing
@testable import OpenClawChatUI

struct ColdPatchRuntimeProof {
    @Test func coldDiskRuntime() async throws {
        let environment = ProcessInfo.processInfo.environment
        let phase = try #require(environment["COLD_PATCH_PHASE"])
        let directory = URL(fileURLWithPath: try #require(environment["COLD_PATCH_DIRECTORY"]))
        let databases = try OpenClawClientDatabases(directoryURL: directory)
        let cache = databases.store(gatewayID: "public-proof-gateway")
        let patch = "*** Begin Patch\n*** Update File: greeting.txt\n@@\n-Hello before\n+Hello after\n*** End Patch"
        print("COLD_PATCH phase=\(phase) pid=\(ProcessInfo.processInfo.processIdentifier)")
        if phase == "write" {
            let message = OpenClawChatMessage(role: "assistant", content: [
                OpenClawChatMessageContent(type: "toolCall", id: "proof-patch", name: "mcp__openclaw__apply_patch",
                    arguments: AnyCodable(["input": patch, "ignored": "must-not-persist"])),
            ], timestamp: 1)
            await cache.storeCanonicalTranscript(sessionKey: "public-proof", agentID: nil, messages: [message],
                canonicalMessageIdempotencyKeys: [])
            print("COLD_PATCH production storeCanonicalTranscript completed")
        }
        let messages = await cache.loadTranscript(sessionKey: "public-proof")
        let message = try #require(messages.first)
        let call = try #require(message.content.first)
        #expect(call.name == "mcp__openclaw__apply_patch")
        #expect(call.arguments == AnyCodable(["input": patch]))
        let display = ToolDisplayRegistry.displayCall(name: call.name, args: call.arguments)
        let preview = try #require(ChatToolDiff.resolveDiff(name: display.name, arguments: display.args, details: nil, isError: false))
        #expect(preview.stat?.added == 1)
        #expect(preview.stat?.removed == 1)
        print("COLD_PATCH raw_name=\(call.name ?? "") display_name=\(display.name ?? "")")
        print("COLD_PATCH preview added=\(preview.stat?.added ?? -1) removed=\(preview.stat?.removed ?? -1)")
        for line in preview.lines { print("COLD_PATCH \(line.kind): \(line.text)") }
        await cache.retire()
        try databases.close()
        print("COLD_PATCH closed SQLite; phase=\(phase) PASS")
    }
}
