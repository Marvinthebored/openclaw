// Elevenlabs tests cover media understanding provider plugin behavior.
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "openclaw/plugin-sdk/runtime-config-snapshot";
import { mockPinnedHostnameResolution } from "openclaw/plugin-sdk/test-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  elevenLabsMediaUnderstandingProvider,
  transcribeElevenLabsAudio,
} from "./media-understanding-provider.js";

function requireFirstFetchCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  const [call] = fetchMock.mock.calls;
  if (!call) {
    throw new Error("expected ElevenLabs media fetch call");
  }
  return call as [string, RequestInit];
}

describe("elevenLabsMediaUnderstandingProvider", () => {
  let ssrfMock: { mockRestore: () => void } | undefined;

  beforeEach(() => {
    ssrfMock = mockPinnedHostnameResolution();
  });

  afterEach(() => {
    ssrfMock?.mockRestore();
    ssrfMock = undefined;
  });

  it("has expected provider metadata", () => {
    expect(elevenLabsMediaUnderstandingProvider.id).toBe("elevenlabs");
    expect(elevenLabsMediaUnderstandingProvider.capabilities).toEqual(["audio"]);
    expect(elevenLabsMediaUnderstandingProvider.defaultModels?.audio).toBe("scribe_v2");
    expect(elevenLabsMediaUnderstandingProvider.transcribeAudio).toBeTypeOf("function");
  });

  it("posts multipart audio to ElevenLabs speech-to-text", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ text: "hello" })));

    const result = await transcribeElevenLabsAudio({
      buffer: Buffer.from("audio"),
      fileName: "voice.mp3",
      mime: "audio/mpeg",
      apiKey: "eleven-key",
      model: "scribe_v2",
      language: "en",
      timeoutMs: 1000,
      fetchFn: fetchMock,
    });

    expect(result).toEqual({ text: "hello", model: "scribe_v2" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = requireFirstFetchCall(fetchMock);
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("xi-api-key")).toBe("eleven-key");
    const form = init.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("language_code")).toBe("en");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("wraps malformed successful speech-to-text JSON with a stable provider error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{ nope"));

    await expect(
      transcribeElevenLabsAudio({
        buffer: Buffer.from("audio"),
        fileName: "voice.mp3",
        mime: "audio/mpeg",
        apiKey: "eleven-key",
        model: "scribe_v2",
        timeoutMs: 1000,
        fetchFn: fetchMock,
      }),
    ).rejects.toThrow("ElevenLabs audio transcription failed: malformed JSON response");
  });

  it("rejects non-object successful speech-to-text JSON with a stable provider error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([])));

    await expect(
      transcribeElevenLabsAudio({
        buffer: Buffer.from("audio"),
        fileName: "voice.mp3",
        mime: "audio/mpeg",
        apiKey: "eleven-key",
        model: "scribe_v2",
        timeoutMs: 1000,
        fetchFn: fetchMock,
      }),
    ).rejects.toThrow("ElevenLabs audio transcription failed: malformed JSON response");
  });
});

describe("transcribeElevenLabsAudio scoped env names", () => {
  let ssrfMock: { mockRestore: () => void } | undefined;

  beforeEach(() => {
    ssrfMock = mockPinnedHostnameResolution();
    vi.unstubAllEnvs();
    for (const key of [
      "ELEVENLABS_API_KEY",
      "XI_API_KEY",
      "ELEVENLABS_MEDIA_API_KEY",
      "XI_MEDIA_API_KEY",
    ]) {
      vi.stubEnv(key, undefined);
    }
    clearRuntimeConfigSnapshot();
  });

  afterEach(() => {
    ssrfMock?.mockRestore();
    ssrfMock = undefined;
    vi.unstubAllEnvs();
    clearRuntimeConfigSnapshot();
  });

  async function transcribeWithEnvKey(fetchMock: ReturnType<typeof vi.fn>) {
    return await transcribeElevenLabsAudio({
      buffer: Buffer.from("audio"),
      fileName: "voice.mp3",
      mime: "audio/mpeg",
      apiKey: "",
      model: "scribe_v2",
      timeoutMs: 1000,
      fetchFn: fetchMock as unknown as typeof fetch,
    });
  }

  it("prefers ELEVENLABS_MEDIA_API_KEY over the generic names", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "generic");
    vi.stubEnv("ELEVENLABS_MEDIA_API_KEY", "scoped");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "hi" })));

    await transcribeWithEnvKey(fetchMock);

    const [, init] = requireFirstFetchCall(fetchMock);
    expect(new Headers(init.headers).get("xi-api-key")).toBe("scoped");
  });

  it("still accepts ELEVENLABS_API_KEY by default", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "generic");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "hi" })));

    await transcribeWithEnvKey(fetchMock);

    const [, init] = requireFirstFetchCall(fetchMock);
    expect(new Headers(init.headers).get("xi-api-key")).toBe("generic");
  });

  it("ignores the generic names when security.requireScopedApiKeys is enabled", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "generic");
    vi.stubEnv("XI_API_KEY", "generic");
    setRuntimeConfigSnapshot({ security: { requireScopedApiKeys: true } } as OpenClawConfig);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "hi" })));

    await expect(transcribeWithEnvKey(fetchMock)).rejects.toThrow("ElevenLabs API key missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
