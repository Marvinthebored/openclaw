import Testing
@testable import OpenClawChatUI

@MainActor
struct ChatComposerStopGuardTests {
    @Test func `stop arms once the guard delay has elapsed`() async {
        let armed = await ChatStopGuard.delayElapsed(sleep: {
            #expect($0 == ChatStopGuard.delay)
        })

        #expect(armed)
    }

    @Test func `a wait cancelled while sleeping does not arm stop`() async {
        var isSleeping = false
        let wait = Task {
            await ChatStopGuard.delayElapsed(sleep: {
                isSleeping = true
                try await Task.sleep(for: $0)
            })
        }
        while !isSleeping {
            await Task.yield()
        }
        wait.cancel()

        #expect(await wait.value == false)
    }

    @Test func `a cancelled wait whose sleep still returns does not arm stop`() async {
        let wait = Task {
            while !Task.isCancelled {
                await Task.yield()
            }
            return await ChatStopGuard.delayElapsed(sleep: { _ in })
        }
        wait.cancel()

        #expect(await wait.value == false)
    }
}
