import { loadSettings, saveSettings } from "../../lib/storage";
import { getStoredValue, removeStoredValue, setStoredValue } from "../../lib/platform-storage";
import { ensureWorkspaceSnapshot, loadWorkspaceSnapshot, saveWorkspaceSnapshot } from "./local-db";
import { downloadRemoteSnapshot, testProviderConnection, uploadRemoteSnapshot } from "./providers";
import {
  buildDefaultWorkspaceSnapshot,
  defaultSyncSettings,
  type SyncSettings,
  type WorkspaceSnapshot
} from "./types";

const SYNC_SETTINGS_KEY = "sync-settings";
let syncScheduler: number | undefined;
let syncInFlight: Promise<SyncSettings> | undefined;

function stopScheduler() {
  if (syncScheduler) {
    window.clearInterval(syncScheduler);
    syncScheduler = undefined;
  }
}

async function scheduleSync(settings?: SyncSettings) {
  if (typeof window === "undefined") {
    return;
  }

  const nextSettings = settings ?? (await loadSyncSettings());
  stopScheduler();

  syncScheduler = window.setInterval(async () => {
    const latestSettings = await loadSyncSettings();

    if (!latestSettings.autoSync) {
      return;
    }

    await runSyncCycle(false);
  }, nextSettings.syncIntervalMs);
}

function mergeSyncSettings(settings?: Partial<SyncSettings>): SyncSettings {
  return {
    ...defaultSyncSettings,
    ...settings,
    dropbox: {
      ...defaultSyncSettings.dropbox,
      ...settings?.dropbox
    },
    onedrive: {
      ...defaultSyncSettings.onedrive,
      ...settings?.onedrive
    },
    gdrive: {
      ...defaultSyncSettings.gdrive,
      ...settings?.gdrive
    },
    webdav: {
      ...defaultSyncSettings.webdav,
      ...settings?.webdav
    }
  };
}

async function buildSnapshotFromLocalState(): Promise<WorkspaceSnapshot> {
  const appSettings = await loadSettings();
  const existing = await loadWorkspaceSnapshot();

  if (!existing) {
    return buildDefaultWorkspaceSnapshot(appSettings);
  }

  const settingsChanged = JSON.stringify(existing.appSettings) !== JSON.stringify(appSettings);

  if (!settingsChanged) {
    return existing;
  }

  return {
    ...existing,
    appSettings,
    updatedAt: new Date().toISOString()
  };
}

async function applySnapshotLocally(snapshot: WorkspaceSnapshot): Promise<void> {
  await saveWorkspaceSnapshot(snapshot);
  await saveSettings(snapshot.appSettings);
}

async function persistSyncSettings(settings: SyncSettings): Promise<SyncSettings> {
  const normalized = mergeSyncSettings(settings);
  await setStoredValue(SYNC_SETTINGS_KEY, normalized, "local");
  await scheduleSync(normalized);
  return normalized;
}

export async function loadSyncSettings(): Promise<SyncSettings> {
  const stored = await getStoredValue<Partial<SyncSettings>>(SYNC_SETTINGS_KEY, "local");
  return mergeSyncSettings(stored);
}

export async function saveSyncSettings(settings: SyncSettings): Promise<SyncSettings> {
  return persistSyncSettings(settings);
}

export async function connectSyncProvider(settings: SyncSettings): Promise<SyncSettings> {
  const connectingState = await persistSyncSettings({
    ...settings,
    status: "syncing",
    lastError: undefined
  });

  try {
    await testProviderConnection(connectingState);

    const localSnapshot = await ensureWorkspaceSnapshot(await buildSnapshotFromLocalState());
    const remoteSnapshot = await downloadRemoteSnapshot(connectingState);

    if (remoteSnapshot && remoteSnapshot.updatedAt >= localSnapshot.updatedAt) {
      await applySnapshotLocally(remoteSnapshot);
    } else if (connectingState.provider !== "none") {
      await uploadRemoteSnapshot(connectingState, localSnapshot);
    }

    return persistSyncSettings({
      ...connectingState,
      status: "connected",
      lastSyncedAt: new Date().toISOString(),
      lastError: undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to connect sync provider.";

    return persistSyncSettings({
      ...connectingState,
      status: "error",
      lastError: message
    });
  }
}

export async function disconnectSyncProvider(): Promise<SyncSettings> {
  const settings = await loadSyncSettings();

  return persistSyncSettings({
    ...settings,
    status: "idle",
    lastError: undefined
  });
}

export async function runSyncCycle(force = false): Promise<SyncSettings> {
  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = (async (): Promise<SyncSettings> => {
    const settings = await loadSyncSettings();

    if (!force && settings.status === "idle") {
      return settings;
    }

    if (settings.provider === "none") {
      const localSnapshot = await ensureWorkspaceSnapshot(await buildSnapshotFromLocalState());
      const nextSettings = await persistSyncSettings({
        ...settings,
        status: "connected",
        lastSyncedAt: force ? new Date().toISOString() : settings.lastSyncedAt,
        lastError: undefined
      });

      await saveWorkspaceSnapshot(localSnapshot);
      return nextSettings;
    }

    if (!force && !settings.autoSync) {
      return settings;
    }

    const syncingSettings = await persistSyncSettings({
      ...settings,
      status: "syncing",
      lastError: undefined
    });

    try {
      const localSnapshot = await ensureWorkspaceSnapshot(await buildSnapshotFromLocalState());
      const remoteSnapshot = await downloadRemoteSnapshot(syncingSettings);

      if (remoteSnapshot && remoteSnapshot.updatedAt > localSnapshot.updatedAt) {
        await applySnapshotLocally(remoteSnapshot);
      } else {
        await uploadRemoteSnapshot(syncingSettings, localSnapshot);
      }

      return persistSyncSettings({
        ...syncingSettings,
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        lastError: undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed.";

      return persistSyncSettings({
        ...syncingSettings,
        status: "error",
        lastError: message
      });
    }
  })();

  try {
    const currentSync = syncInFlight;

    if (!currentSync) {
      throw new Error("Sync pipeline failed to start.");
    }

    return await currentSync;
  } finally {
    syncInFlight = undefined;
  }
}

export async function getLocalSnapshotMeta(): Promise<Pick<WorkspaceSnapshot, "updatedAt" | "version"> | undefined> {
  const snapshot = await loadWorkspaceSnapshot();

  if (!snapshot) {
    return undefined;
  }

  return {
    updatedAt: snapshot.updatedAt,
    version: snapshot.version
  };
}

export function startSyncScheduler(): () => void {
  void loadSettings().then((appSettings) =>
    ensureWorkspaceSnapshot(buildDefaultWorkspaceSnapshot(appSettings))
  );
  void scheduleSync();

  return () => {
    stopScheduler();
  };
}

export async function resetLocalSnapshot(): Promise<void> {
  await removeStoredValue(SYNC_SETTINGS_KEY, "local");
  await saveWorkspaceSnapshot(buildDefaultWorkspaceSnapshot(await loadSettings()));
}
