import { getStoredValue, setStoredValue } from "./platform-storage";

export type AppSettings = {
  workspaceName: string;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  persistHistory: boolean;
  defaultToolId: string;
};

export const defaultSettings: AppSettings = {
  workspaceName: "DevX Workspace",
  apiBaseUrl: "",
  requestTimeoutMs: 15000,
  persistHistory: true,
  defaultToolId: "api-client"
};

const SETTINGS_KEY = "app-settings";

export async function loadSettings(): Promise<AppSettings> {
  const stored = await getStoredValue<Partial<AppSettings>>(SETTINGS_KEY, "sync");

  return {
    ...defaultSettings,
    ...stored
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await setStoredValue(SETTINGS_KEY, settings, "sync");
}

export async function ensureDefaultSettings(): Promise<void> {
  const stored = await getStoredValue<Partial<AppSettings>>(SETTINGS_KEY, "sync");

  if (!stored) {
    await saveSettings(defaultSettings);
  }
}
