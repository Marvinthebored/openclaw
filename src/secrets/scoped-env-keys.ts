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
export type EnvKeyScope =
  | "tts"
  | "realtime"
  | "transcription"
  | "embedding"
  | "video"
  | "media"
  | "search";

const GENERIC_SUFFIX = "_API_KEY";

/** True when the name already carries the subsystem token, e.g. VOLCENGINE_TTS_TOKEN under `tts`. */
function hasScopeToken(baseEnvKey: string, scope: EnvKeyScope): boolean {
  const token = scope.toUpperCase();
  return baseEnvKey.split("_").includes(token);
}

/**
 * Derives the scoped variable name for a base one.
 *
 * `OPENAI_API_KEY` + `tts` → `OPENAI_TTS_API_KEY`. A name that already carries the
 * subsystem token (`VOLCENGINE_TTS_API_KEY`, `VOLCENGINE_TTS_TOKEN`) is returned
 * unchanged — it is already scoped, and deriving again would invent
 * `VOLCENGINE_TTS_TTS_API_KEY`.
 *
 * A name with neither the `_API_KEY` suffix nor the subsystem token (`AZURE_SPEECH_KEY`,
 * `SPEECH_KEY`) has no scoped form at all and returns undefined. Such names stay usable
 * even when `security.requireScopedApiKeys` is enabled: a scoped name cannot be required
 * where none can be expressed.
 */
export function deriveScopedEnvKeyName(baseEnvKey: string, scope: EnvKeyScope): string | undefined {
  if (hasScopeToken(baseEnvKey, scope)) {
    return baseEnvKey;
  }
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
 * reaching environment fallback at all. A base name with no expressible scoped
 * form is exempt from that rule and stays usable.
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
  const requireScoped = requireScopedApiKeys(params.config);
  for (const baseEnvKey of params.baseEnvKeys) {
    // Under the flag only names with no expressible scoped form remain eligible.
    if (requireScoped && deriveScopedEnvKeyName(baseEnvKey, params.scope)) {
      continue;
    }
    const value = normalizeOptionalSecretInput(env[baseEnvKey]);
    if (value) {
      return { value, envVar: baseEnvKey, scoped: false };
    }
  }
  return undefined;
}
