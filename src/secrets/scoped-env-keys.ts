/**
 * Subsystem-scoped environment key names.
 *
 * A generic variable such as OPENAI_API_KEY is ambiguous: model inference, TTS,
 * realtime voice, transcription, and embeddings can all consume it. A scoped name
 * such as OPENAI_TTS_API_KEY states the intended consumer in the name itself.
 *
 * Lookup order: every scoped candidate is consulted before any generic one, so
 * setting a scoped variable always wins. With `security.requireScopedApiKeys`
 * enabled, generic names are ignored entirely for subsystems that define a scope —
 * a subsystem then uses a credential only when its scoped name (or explicit
 * configuration) provides one.
 */
import { getRuntimeConfigSnapshot } from "../config/runtime-snapshot.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { normalizeOptionalSecretInput } from "../utils/normalize-secret-input.js";

/** Subsystem tokens that may appear inside a scoped variable name. */
export type EnvKeyScope = "tts" | "realtime" | "transcription" | "embedding" | "image" | "video";

const GENERIC_SUFFIX = "_API_KEY";

/**
 * Derives the scoped variable name for a generic one.
 * `OPENAI_API_KEY` + `tts` → `OPENAI_TTS_API_KEY`. Names that do not end in
 * `_API_KEY` have no derivable scoped form and return undefined.
 */
export function deriveScopedEnvKeyName(baseEnvKey: string, scope: EnvKeyScope): string | undefined {
  if (!baseEnvKey.endsWith(GENERIC_SUFFIX)) {
    return undefined;
  }
  const prefix = baseEnvKey.slice(0, -GENERIC_SUFFIX.length);
  return `${prefix}_${scope.toUpperCase()}${GENERIC_SUFFIX}`;
}

export type ScopedEnvApiKeyResult = {
  value: string;
  /** The variable the value came from. */
  envVar: string;
  /** True when a scoped name supplied the value. */
  scoped: boolean;
};

function requireScopedApiKeys(config?: OpenClawConfig): boolean {
  const cfg = config ?? getRuntimeConfigSnapshot() ?? undefined;
  return cfg?.security?.requireScopedApiKeys === true;
}

/**
 * Resolves a credential for one subsystem from environment state.
 *
 * All scoped candidates are consulted before any generic candidate. When
 * `security.requireScopedApiKeys` is enabled, generic candidates are skipped —
 * explicit configuration remains unaffected because callers consult it before
 * reaching environment fallback at all.
 */
export function resolveScopedEnvApiKey(params: {
  baseEnvKeys: readonly string[];
  scope: EnvKeyScope;
  env?: NodeJS.ProcessEnv;
  config?: OpenClawConfig;
}): ScopedEnvApiKeyResult | undefined {
  const env = params.env ?? process.env;
  for (const baseEnvKey of params.baseEnvKeys) {
    const scopedName = deriveScopedEnvKeyName(baseEnvKey, params.scope);
    if (!scopedName) {
      continue;
    }
    const value = normalizeOptionalSecretInput(env[scopedName]);
    if (value) {
      return { value, envVar: scopedName, scoped: true };
    }
  }
  if (requireScopedApiKeys(params.config)) {
    return undefined;
  }
  for (const baseEnvKey of params.baseEnvKeys) {
    const value = normalizeOptionalSecretInput(env[baseEnvKey]);
    if (value) {
      return { value, envVar: baseEnvKey, scoped: false };
    }
  }
  return undefined;
}
