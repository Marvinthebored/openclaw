import { beforeEach, expect, it, vi } from "vitest";
import { TalkRealtimeRelayOutputOwnership } from "../../src/gateway/talk/relay/state.js";
import { createRealtimeVoiceSessionHarness } from "../../src/talk/realtime-session-harness.js";
import { buildXaiRealtimeVoiceProvider } from "./realtime-voice-provider.js";
import { openRealtimeBridge } from "./realtime-voice-provider.test-support.js";
const { FakeWebSocket } = await vi.hoisted(() => import("./realtime-voice-socket.test-support.js"));
vi.mock("./ws-runtime.js", () => ({ WebSocket: FakeWebSocket }));
beforeEach(() => {
  FakeWebSocket.instances = [];
});
function server(socket: InstanceType<typeof FakeWebSocket>, type: string, data: object = {}) {
  socket.emitServer({ type, ...data });
}
function responseCreated(socket: InstanceType<typeof FakeWebSocket>, id: string) {
  server(socket, "response.created", { response: { id } });
}
function responseDone(socket: InstanceType<typeof FakeWebSocket>, id: string) {
  server(socket, "response.done", { response: { id, status: "completed" } });
}
function inputTranscript(socket: InstanceType<typeof FakeWebSocket>, text: string, itemId: string) {
  server(socket, "conversation.item.input_audio_transcription.completed", {
    item_id: itemId,
    transcript: text,
  });
}
it("settles a server-VAD predecessor before admitting its successor through Talk", async () => {
  const harness = createRealtimeVoiceSessionHarness({
    talk: {
      sessionId: "vad-test",
      mode: "realtime",
      transport: "gateway-relay",
      brain: "agent-consult",
      provider: "xai",
    },
    talkPayloads: {
      turnStarted: () => ({}),
      turnEnded: (reason) => ({ reason }),
      inputAudioDelta: () => ({}),
      outputAudioStarted: () => ({}),
      outputAudioDelta: () => ({}),
      outputAudioDone: (reason) => ({ reason }),
    },
  });
  const fail = vi.fn();
  const ownership = new TalkRealtimeRelayOutputOwnership(
    () => harness.talk.activeTurnId,
    () => harness.ensureTurn(),
    fail,
    () => false,
  );
  const onTranscript = vi.fn();
  const onToolCall = vi.fn();
  const sendAudio = vi.fn();
  const outcomes = vi.fn((outcome) => ownership.finish(outcome.responseId));
  const session = harness.createBridge({
    provider: ownership.bind(buildXaiRealtimeVoiceProvider(), vi.fn()),
    providerConfig: { apiKey: "xai-test" },
    audioSink: { sendAudio },
    onTranscript,
    onToolCall,
    onResponseDone: outcomes,
  });
  try {
    const socket = await openRealtimeBridge(session.bridge, FakeWebSocket.instances.length);
    responseCreated(socket, "A");
    const firstTurn = harness.talk.activeTurnId;
    server(socket, "input_audio_buffer.speech_started");
    inputTranscript(socket, "new question", "user-B");
    responseCreated(socket, "B");
    expect(fail).not.toHaveBeenCalled();
    expect(outcomes).toHaveBeenCalledExactlyOnceWith({ status: "cancelled", responseId: "A" });
    expect(ownership.responseId).toBe("B");
    expect(harness.talk.activeTurnId).not.toBe(firstTurn);
    expect(
      harness.talk.recentEvents.some(
        (event) => event.type === "turn.cancelled" && event.turnId === firstTurn,
      ),
    ).toBe(true);
    server(socket, "response.output_audio.delta", { response_id: "A", delta: "AAA=" });
    server(socket, "response.output_text.done", { response_id: "A", text: "stale" });
    server(socket, "response.function_call_arguments.done", {
      response_id: "A",
      item_id: "old",
      call_id: "old",
      name: "lookup",
      arguments: "{}",
    });
    responseDone(socket, "A");
    expect(sendAudio).not.toHaveBeenCalled();
    expect(onToolCall).not.toHaveBeenCalled();
    expect(onTranscript.mock.calls.some((call) => call[1] === "stale")).toBe(false);
    expect(ownership.responseId).toBe("B");
    server(socket, "response.output_audio.delta", { response_id: "B", delta: "AAA=" });
    responseDone(socket, "B");
    expect(sendAudio).toHaveBeenCalledOnce();
    expect(ownership.phase).toBe("unowned");
    expect(onTranscript.mock.calls).toContainEqual([
      "user",
      "new question",
      true,
      { textMode: "snapshot" },
    ]);
    responseCreated(socket, "C");
    responseCreated(socket, "C");
    expect(fail).not.toHaveBeenCalled();
    responseCreated(socket, "arbitrary-overlap");
    expect(fail).toHaveBeenCalledExactlyOnceWith(
      "Realtime provider output has no live response owner.",
    );
  } finally {
    await session.close();
    harness.close();
  }
});
