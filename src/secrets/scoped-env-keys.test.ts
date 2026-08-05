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

  it("returns undefined for names without the generic suffix", () => {
    expect(deriveScopedEnvKeyName("ANTHROPIC_OAUTH_TOKEN", "tts")).toBeUndefined();
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
