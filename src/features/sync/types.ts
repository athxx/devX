import type {
  DevxIndexedDocument,
  DevxSectionEnvelope,
  DevxSectionStoreName,
} from "../../lib/indexed-db";
import type { AppSettings } from "../../lib/storage";
import { defaultSettings } from "../../lib/storage";

export type SyncProviderType = "none" | "dropbox" | "onedrive" | "gdrive" | "webdav";
export type SyncConnectionState = "idle" | "connected" | "syncing" | "error";

export type DropboxProviderConfig = {
  accessToken: string;
  remotePath: string;
};

export type OneDriveProviderConfig = {
  accessToken: string;
  remotePath: string;
};

export type GoogleDriveProviderConfig = {
  accessToken: string;
  fileName: string;
};

export type WebDavProviderConfig = {
  endpoint: string;
  username: string;
  password: string;
  remotePath: string;
};

export type SyncSettings = {
  provider: SyncProviderType;
  autoSync: boolean;
  syncIntervalMs: number;
  status: SyncConnectionState;
  lastSyncedAt?: string;
  lastError?: string;
  dropbox: DropboxProviderConfig;
  onedrive: OneDriveProviderConfig;
  gdrive: GoogleDriveProviderConfig;
  webdav: WebDavProviderConfig;
};

export type SettingsStoreData = AppSettings & {
  sync?: SyncSettings;
};

export type WorkspaceSnapshot = {
  version: 1;
  updatedAt: string;
  settings?: DevxSectionEnvelope<SettingsStoreData>;
  api?: DevxSectionEnvelope<unknown>;
  db?: DevxSectionEnvelope<unknown>;
  ssh?: DevxSectionEnvelope<unknown>;
  vault?: DevxSectionEnvelope<unknown>;
};

export const defaultSyncSettings: SyncSettings = {
  provider: "none",
  autoSync: true,
  syncIntervalMs: 30000,
  status: "idle",
  dropbox: {
    accessToken: "",
    remotePath: "/Apps/DevX/workspace.json",
  },
  onedrive: {
    accessToken: "",
    remotePath: "/Apps/DevX/workspace.json",
  },
  gdrive: {
    accessToken: "",
    fileName: "devx-workspace.json",
  },
  webdav: {
    endpoint: "",
    username: "",
    password: "",
    remotePath: "/devx/workspace.json",
  },
};

function createSection<T>(data: T): DevxSectionEnvelope<T> {
  return {
    meta: {
      version: 1,
      updatedAt: new Date().toISOString(),
    },
    data,
  };
}

export function buildDefaultWorkspaceSnapshot(
  appSettings: AppSettings = defaultSettings,
): WorkspaceSnapshot {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    settings: createSection({
      ...appSettings,
      sync: defaultSyncSettings,
    }),
    api: createSection({}),
    db: createSection({}),
    ssh: createSection({}),
    vault: createSection({ items: [] }),
  };
}

export function buildSnapshotFromDocument(
  document: DevxIndexedDocument,
): WorkspaceSnapshot {
  const updatedAt = (
    Object.values(document)
      .map((section) => section?.meta.updatedAt)
      .filter((value): value is string => typeof value === "string")
      .sort((left, right) => right.localeCompare(left))[0] ??
    new Date().toISOString()
  );

  return {
    version: 1,
    updatedAt,
    settings: document.settings as WorkspaceSnapshot["settings"],
    api: document.api as WorkspaceSnapshot["api"],
    db: document.db as WorkspaceSnapshot["db"],
    ssh: document.ssh as WorkspaceSnapshot["ssh"],
    vault: document.vault as WorkspaceSnapshot["vault"],
  };
}

export function snapshotToDocument(snapshot: WorkspaceSnapshot): DevxIndexedDocument {
  const document: DevxIndexedDocument = {};

  for (const storeName of [
    "settings",
    "api",
    "db",
    "ssh",
    "vault",
  ] as const satisfies DevxSectionStoreName[]) {
    const section = snapshot[storeName];

    if (section) {
      document[storeName] = section;
    }
  }

  return document;
}
