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

export type WorkspaceSnapshot = {
  version: 1;
  updatedAt: string;
  appSettings: AppSettings;
  collections: Array<Record<string, unknown>>;
  environments: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
};

export const defaultSyncSettings: SyncSettings = {
  provider: "none",
  autoSync: true,
  syncIntervalMs: 30000,
  status: "idle",
  dropbox: {
    accessToken: "",
    remotePath: "/Apps/DevX/workspace.json"
  },
  onedrive: {
    accessToken: "",
    remotePath: "/Apps/DevX/workspace.json"
  },
  gdrive: {
    accessToken: "",
    fileName: "devx-workspace.json"
  },
  webdav: {
    endpoint: "",
    username: "",
    password: "",
    remotePath: "/devx/workspace.json"
  }
};

export function buildDefaultWorkspaceSnapshot(
  appSettings: AppSettings = defaultSettings
): WorkspaceSnapshot {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    appSettings,
    collections: [],
    environments: [],
    history: []
  };
}
