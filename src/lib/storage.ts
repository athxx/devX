export type AppSettings = {
  workspaceName: string;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  persistHistory: boolean;
  defaultToolId: string;
};

export const defaultSettings: AppSettings = {
  workspaceName: "DevOX Workspace",
  apiBaseUrl: "",
  requestTimeoutMs: 15000,
  persistHistory: true,
  defaultToolId: "api-client"
};

const SETTINGS_KEY = "app-settings";

export async function loadSettings(): Promise<AppSettings> {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return {
    ...defaultSettings,
    ...(result[SETTINGS_KEY] as Partial<AppSettings> | undefined)
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.sync.set({
    [SETTINGS_KEY]: settings
  });
}

export async function ensureDefaultSettings(): Promise<void> {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);

  if (!result[SETTINGS_KEY]) {
    await saveSettings(defaultSettings);
  }
}

