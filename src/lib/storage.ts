import { getStoredValue, setStoredValue } from "./platform-storage";

export type AppSettings = {
  workspaceName: string;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  persistHistory: boolean;
  defaultToolId: string;
  proxy: {
    api: {
      mode: "none" | "proxy";
      address: string;
    };
    db: {
      mode: "none" | "proxy";
      address: string;
    };
    ssh: {
      mode: "none" | "proxy";
      address: string;
    };
  };
};

export const defaultSettings: AppSettings = {
  workspaceName: "DevX Workspace",
  apiBaseUrl: "",
  requestTimeoutMs: 15000,
  persistHistory: true,
  defaultToolId: "api-client",
  proxy: {
    api: {
      mode: "none",
      address: ""
    },
    db: {
      mode: "none",
      address: ""
    },
    ssh: {
      mode: "none",
      address: ""
    }
  }
};

const SETTINGS_KEY = "app-settings";

export async function loadSettings(): Promise<AppSettings> {
  const stored = await getStoredValue<Partial<AppSettings>>(SETTINGS_KEY, "sync");

  return {
    ...defaultSettings,
    ...stored,
    proxy: {
      api: {
        ...defaultSettings.proxy.api,
        ...stored?.proxy?.api
      },
      db: {
        ...defaultSettings.proxy.db,
        ...stored?.proxy?.db
      },
      ssh: {
        ...defaultSettings.proxy.ssh,
        ...stored?.proxy?.ssh
      }
    }
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
