import SwiftUI

/// Stop replaces Send under the finger, so a double tap must not stop the message it just sent.
/// Stop stays dimmed and inert for a moment after it appears.
struct ChatStopGuard: ViewModifier {
    /// 700 ms. UI tests lengthen it with the launch argument `-openClawChatStopGuardMs <milliseconds>`.
    static var delay: Duration {
        let override = UserDefaults.standard.integer(forKey: "openClawChatStopGuardMs")
        return .milliseconds(override > 0 ? override : 700)
    }

    @State private var isArmed = false

    func body(content: Content) -> some View {
        content
            .disabled(!self.isArmed)
            .opacity(self.isArmed ? 1 : 0.35)
            .task { self.isArmed = await Self.delayElapsed() }
            .onDisappear { self.isArmed = false }
    }

    /// False when the wait is cancelled, so a view that left the screen cannot arm Stop.
    static func delayElapsed(
        sleep: (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) async -> Bool
    {
        do {
            try await sleep(self.delay)
        } catch {
            return false
        }
        return !Task.isCancelled
    }
}
