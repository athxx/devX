import { readDevxSection, writeDevxSection } from "../../../lib/indexed-db";

// AI SQL Assistant configuration. Persisted under the existing "db" IndexedDB
// section (sub-key "aiSettings") so it travels with the rest of the DB feature
// state and needs no change to the global AppSettings schema. The API key lives
// client-side and is forwarded per-request — matching how devX's REST/API
// tooling already handles credentials.

export type AiProvider = "anthropic" | "openai-compatible";

export type DbAiSettings = {
  provider: AiProvider;
  /** Base URL of the API. Empty falls back to the provider default. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Route the request through the local Go relay (/api proxy) vs. direct fetch. */
  useProxy: boolean;
};

// Latest Claude model by default, per the roadmap.
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8";
export const DEFAULT_OPENAI_MODEL = "gpt-4o";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";

export const defaultDbAiSettings: DbAiSettings = {
  provider: "anthropic",
  baseUrl: "",
  apiKey: "",
  model: DEFAULT_ANTHROPIC_MODEL,
  useProxy: true,
};

export function defaultModelForProvider(provider: AiProvider): string {
  return provider === "anthropic"
    ? DEFAULT_ANTHROPIC_MODEL
    : DEFAULT_OPENAI_MODEL;
}

export function defaultBaseUrlForProvider(provider: AiProvider): string {
  return provider === "anthropic" ? ANTHROPIC_BASE_URL : "";
}

export async function loadDbAiSettings(): Promise<DbAiSettings> {
  const stored = await readDevxSection<Partial<DbAiSettings>>([
    "db",
    "aiSettings",
  ]);
  return { ...defaultDbAiSettings, ...stored };
}

export async function saveDbAiSettings(settings: DbAiSettings): Promise<void> {
  await writeDevxSection(["db", "aiSettings"], settings);
}

/** True when the settings are sufficient to attempt a request. */
export function isAiConfigured(settings: DbAiSettings): boolean {
  if (!settings.model.trim()) return false;
  // Anthropic always needs a key; OpenAI-compatible local servers (Ollama,
  // LM Studio) may not, so only require a base URL there.
  if (settings.provider === "anthropic") return Boolean(settings.apiKey.trim());
  return Boolean(settings.baseUrl.trim());
}
