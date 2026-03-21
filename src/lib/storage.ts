import { readDevxSection, writeDevxSection } from "./indexed-db";

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

export async function loadSettings(): Promise<AppSettings> {
  const stored = await readDevxSection<Partial<AppSettings>>(["settings"]);

  return {
    ...defaultSettings,
    ...stored,
    proxy: {
      api: {
        ...defaultSettings.proxy.api,
        ...stored?.proxy?.api,
      },
      db: {
        ...defaultSettings.proxy.db,
        ...stored?.proxy?.db,
      },
      ssh: {
        ...defaultSettings.proxy.ssh,
        ...stored?.proxy?.ssh,
      },
    },
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const current = (await readDevxSection<Record<string, unknown>>(["settings"])) ?? {};
  await writeDevxSection(["settings"], {
    ...current,
    ...settings,
  });
}

export async function ensureDefaultSettings(): Promise<void> {
  const stored = await readDevxSection<Partial<AppSettings>>(["settings"]);

  if (!stored) {
    await saveSettings(defaultSettings);
  }
}
