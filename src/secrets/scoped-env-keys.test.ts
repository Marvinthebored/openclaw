// Covers subsystem-scoped env key derivation, precedence, and the require-scoped flag.
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { deriveScopedEnvKeyName, resolveScopedEnvApiKey } from "./scoped-env-keys.js";

const REQUIRE_SCOPED = { security: { requireScopedApiKeys: true } } as OpenClawConfig;
const ALLOW_GENERIC = { security: { requireScopedApiKeys: false } } as OpenClawConfig;

describe("deriveScopedEnvKeyName", () => {
  it("inserts the subsystem token before the _API_KEY suffix", () => {
    expect(deriveScopedEnvKeyName("OPENAI_API_KEY", "tts")).toBe("OPENAI_TTS_API_KEY");
    expect(deriveScopedEnvKeyName("GEMINI_API_KEY", "embedding")).toBe("GEMINI_EMBEDDING_API_KEY");
    expect(deriveScopedEnvKeyName("OPENAI_API_KEY", "realtime")).toBe("OPENAI_REALTIME_API_KEY");
  });

  it("supports the media and search subsystem tokens", () => {
    expect(deriveScopedEnvKeyName("ELEVENLABS_API_KEY", "media")).toBe("ELEVENLABS_MEDIA_API_KEY");
    expect(deriveScopedEnvKeyName("TAVILY_API_KEY", "search")).toBe("TAVILY_SEARCH_API_KEY");
  });

  it("returns an already-scoped name unchanged instead of deriving again", () => {
    expect(deriveScopedEnvKeyName("VOLCENGINE_TTS_API_KEY", "tts")).toBe("VOLCENGINE_TTS_API_KEY");
    expect(deriveScopedEnvKeyName("VOLCENGINE_TTS_TOKEN", "tts")).toBe("VOLCENGINE_TTS_TOKEN");
  });

  it("returns undefined for names without the generic suffix", () => {
    expect(deriveScopedEnvKeyName("ANTHROPIC_OAUTH_TOKEN", "tts")).toBeUndefined();
    expect(deriveScopedEnvKeyName("AZURE_SPEECH_KEY", "tts")).toBeUndefined();
  });
});

describe("resolveScopedEnvApiKey", () => {
  it("prefers the scoped name over the generic one", () => {
    const resolved = resolveScopedEnvApiKey({
      baseEnvKeys: ["OPENAI_API_KEY"],
      scope: "tts",
      env: { OPENAI_API_KEY: "sk-generic", OPENAI_TTS_API_KEY: "sk-tts" } as NodeJS.ProcessEnv,
      config: ALLOW_GENERIC,
    });
    expect(resolved).toEqual({ value: "sk-tts", envVar: "OPENAI_TTS_API_KEY", scoped: true });
  });

  it("consults every scoped candidate before any generic one", () => {
    // GEMINI_API_KEY (generic) is set, but GOOGLE_TTS_API_KEY (scoped, lower base
    // precedence) must still win: scoped names always outrank generic names.
    const resolved = resolveScopedEnvApiKey({
      baseEnvKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
      scope: "tts",
      env: { GEMINI_API_KEY: "sk-generic", GOOGLE_TTS_API_KEY: "sk-tts" } as NodeJS.ProcessEnv,
      config: ALLOW_GENERIC,
    });
    expect(resolved).toEqual({ value: "sk-tts", envVar: "GOOGLE_TTS_API_KEY", scoped: true });
  });

  it("falls back to the generic name by default", () => {
    const resolved = resolveScopedEnvApiKey({
      baseEnvKeys: ["OPENAI_API_KEY"],
      scope: "tts",
      env: { OPENAI_API_KEY: "sk-generic" } as NodeJS.ProcessEnv,
      config: ALLOW_GENERIC,
    });
    expect(resolved).toEqual({ value: "sk-generic", envVar: "OPENAI_API_KEY", scoped: false });
  });

  it("ignores the generic name when scoped keys are required", () => {
    const resolved = resolveScopedEnvApiKey({
      baseEnvKeys: ["OPENAI_API_KEY"],
      scope: "tts",
      env: { OPENAI_API_KEY: "sk-generic" } as NodeJS.ProcessEnv,
      config: REQUIRE_SCOPED,
    });
    expect(resolved).toBeUndefined();
  });

  it("still resolves the scoped name when scoped keys are required", () => {
    const resolved = resolveScopedEnvApiKey({
      baseEnvKeys: ["OPENAI_API_KEY"],
      scope: "realtime",
      env: {
        OPENAI_API_KEY: "sk-generic",
        OPENAI_REALTIME_API_KEY: "sk-realtime",
      } as NodeJS.ProcessEnv,
      config: REQUIRE_SCOPED,
    });
    expect(resolved).toEqual({
      value: "sk-realtime",
      envVar: "OPENAI_REALTIME_API_KEY",
      scoped: true,
    });
  });

  it("uses an already-scoped name directly, even when scoped keys are required", () => {
    const resolved = resolveScopedEnvApiKey({
      baseEnvKeys: ["VOLCENGINE_TTS_API_KEY"],
      scope: "tts",
      env: { VOLCENGINE_TTS_API_KEY: "sk-volc" } as NodeJS.ProcessEnv,
      config: REQUIRE_SCOPED,
    });
    expect(resolved).toEqual({
      value: "sk-volc",
      envVar: "VOLCENGINE_TTS_API_KEY",
      scoped: true,
    });
  });

  it("keeps a non-derivable name usable when scoped keys are required", () => {
    // AZURE_SPEECH_KEY has no scoped form to express, so requiring one cannot
    // exclude it — otherwise the credential would be unreachable under the flag.
    const resolved = resolveScopedEnvApiKey({
      baseEnvKeys: ["AZURE_SPEECH_KEY"],
      scope: "tts",
      env: { AZURE_SPEECH_KEY: "sk-azure" } as NodeJS.ProcessEnv,
      config: REQUIRE_SCOPED,
    });
    expect(resolved).toEqual({ value: "sk-azure", envVar: "AZURE_SPEECH_KEY", scoped: false });
  });

  it("still drops derivable generic names alongside a non-derivable one", () => {
    const resolved = resolveScopedEnvApiKey({
      baseEnvKeys: ["AZURE_SPEECH_API_KEY", "AZURE_SPEECH_KEY"],
      scope: "tts",
      env: {
        AZURE_SPEECH_API_KEY: "sk-generic",
        AZURE_SPEECH_KEY: "sk-azure",
      } as NodeJS.ProcessEnv,
      config: REQUIRE_SCOPED,
    });
    expect(resolved).toEqual({ value: "sk-azure", envVar: "AZURE_SPEECH_KEY", scoped: false });
  });

  it("returns undefined when nothing is set", () => {
    const resolved = resolveScopedEnvApiKey({
      baseEnvKeys: ["OPENAI_API_KEY"],
      scope: "tts",
      env: {} as NodeJS.ProcessEnv,
      config: ALLOW_GENERIC,
    });
    expect(resolved).toBeUndefined();
  });
});
