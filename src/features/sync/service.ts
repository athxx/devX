import {
  DEVX_SECTION_STORES,
  type DevxSectionEnvelope,
  loadDevxDocument,
  readDevxSection,
  removeDevxSnapshot,
  saveDevxDocument,
  writeDevxSection,
} from "../../lib/indexed-db";
import { loadSettings } from "../../lib/storage";
import { ensureWorkspaceSnapshot, loadWorkspaceSnapshot, saveWorkspaceSnapshot } from "./local-db";
import { downloadRemoteSnapshot, testProviderConnection, uploadRemoteSnapshot } from "./providers";
import {
  buildDefaultWorkspaceSnapshot,
  buildSnapshotFromDocument,
  defaultSyncSettings,
  snapshotToDocument,
  type SettingsStoreData,
  type SyncSettings,
  type WorkspaceSnapshot,
} from "./types";

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

  if (!nextSettings.autoSync || nextSettings.provider === "none") {
    return;
  }

  syncScheduler = window.setInterval(async () => {
    const latestSettings = await loadSyncSettings();

    if (!latestSettings.autoSync || latestSettings.provider === "none") {
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
      ...settings?.dropbox,
    },
    onedrive: {
      ...defaultSyncSettings.onedrive,
      ...settings?.onedrive,
    },
    gdrive: {
      ...defaultSyncSettings.gdrive,
      ...settings?.gdrive,
    },
    webdav: {
      ...defaultSyncSettings.webdav,
      ...settings?.webdav,
    },
  };
}

function isSectionEnvelope(value: unknown): value is DevxSectionEnvelope<unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DevxSectionEnvelope<unknown>>;
  return (
    !!candidate.meta &&
    candidate.meta.version === 1 &&
    typeof candidate.meta.updatedAt === "string" &&
    "data" in candidate
  );
}

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkspaceSnapshot>;

  if (candidate.version !== 1 || typeof candidate.updatedAt !== "string") {
    return false;
  }

  return DEVX_SECTION_STORES.every((storeName) => {
    const section = candidate[storeName];
    return section === undefined || isSectionEnvelope(section);
  });
}

function getSectionUpdatedAt(section?: DevxSectionEnvelope<unknown>) {
  return section?.meta.updatedAt ?? "";
}

function setSnapshotSection(
  snapshot: WorkspaceSnapshot,
  storeName: (typeof DEVX_SECTION_STORES)[number],
  section: DevxSectionEnvelope<unknown> | undefined,
) {
  (
    snapshot as unknown as Record<
      string,
      DevxSectionEnvelope<unknown> | undefined
    >
  )[storeName] = section;
}

function createSettingsSection(settings: SettingsStoreData): DevxSectionEnvelope<SettingsStoreData> {
  return {
    meta: {
      version: 1,
      updatedAt: new Date().toISOString(),
    },
    data: settings,
  };
}

async function buildSnapshotFromLocalState(): Promise<WorkspaceSnapshot> {
  const document = await loadDevxDocument();
  const snapshot = buildSnapshotFromDocument(document);

  if (!snapshot.settings) {
    const settings = await loadSettings();
    const sync = await loadSyncSettings();
    snapshot.settings = createSettingsSection({
      ...settings,
      sync,
    });
  }

  if (!snapshot.api && !snapshot.db && !snapshot.ssh && !snapshot.vault) {
    return buildDefaultWorkspaceSnapshot(snapshot.settings.data);
  }

  snapshot.updatedAt =
    [
      snapshot.settings,
      snapshot.api,
      snapshot.db,
      snapshot.ssh,
      snapshot.vault,
    ]
      .map((section) => section?.meta.updatedAt)
      .filter((value): value is string => typeof value === "string")
      .sort((left, right) => right.localeCompare(left))[0] ??
    new Date().toISOString();

  return snapshot;
}

async function applySnapshotLocally(snapshot: WorkspaceSnapshot): Promise<void> {
  await saveDevxDocument(snapshotToDocument(snapshot));
  await saveWorkspaceSnapshot(snapshot);
}

async function persistSyncSettings(settings: SyncSettings): Promise<SyncSettings> {
  const normalized = mergeSyncSettings(settings);
  await writeDevxSection(["settings", "sync"], normalized);
  await scheduleSync(normalized);
  return normalized;
}

function mergeWorkspaceSnapshots(
  localSnapshot: WorkspaceSnapshot,
  remoteSnapshot?: WorkspaceSnapshot,
) {
  if (!remoteSnapshot) {
    return {
      mergedSnapshot: localSnapshot,
      localChanged: false,
      remoteChanged: false,
    };
  }

  const mergedSnapshot: WorkspaceSnapshot = {
    version: 1,
    updatedAt: localSnapshot.updatedAt,
  };
  let localChanged = false;
  let remoteChanged = false;

  for (const storeName of DEVX_SECTION_STORES) {
    const localSection = localSnapshot[storeName];
    const remoteSection = remoteSnapshot[storeName];
    const localUpdatedAt = getSectionUpdatedAt(localSection);
    const remoteUpdatedAt = getSectionUpdatedAt(remoteSection);

    if (!localSection && remoteSection) {
      setSnapshotSection(mergedSnapshot, storeName, remoteSection);
      localChanged = true;
      continue;
    }

    if (localSection && !remoteSection) {
      setSnapshotSection(mergedSnapshot, storeName, localSection);
      remoteChanged = true;
      continue;
    }

    if (!localSection && !remoteSection) {
      continue;
    }

    if (remoteUpdatedAt > localUpdatedAt) {
      setSnapshotSection(mergedSnapshot, storeName, remoteSection);
      localChanged = true;
    } else {
      setSnapshotSection(mergedSnapshot, storeName, localSection);
      remoteChanged ||= localUpdatedAt > remoteUpdatedAt;
    }
  }

  mergedSnapshot.updatedAt =
    DEVX_SECTION_STORES.map((storeName) =>
      getSectionUpdatedAt(mergedSnapshot[storeName]),
    )
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left))[0] ??
    new Date().toISOString();

  return {
    mergedSnapshot,
    localChanged,
    remoteChanged,
  };
}

export async function loadSyncSettings(): Promise<SyncSettings> {
  const stored = await readDevxSection<Partial<SyncSettings>>(["settings", "sync"]);
  return mergeSyncSettings(stored);
}

export async function saveSyncSettings(settings: SyncSettings): Promise<SyncSettings> {
  return persistSyncSettings(settings);
}

export async function connectSyncProvider(settings: SyncSettings): Promise<SyncSettings> {
  const connectingState = await persistSyncSettings({
    ...settings,
    status: "syncing",
    lastError: undefined,
  });

  try {
    await testProviderConnection(connectingState);

    const localSnapshot = await ensureWorkspaceSnapshot(await buildSnapshotFromLocalState());
    const remoteSnapshot = await downloadRemoteSnapshot(connectingState);
    const { mergedSnapshot, localChanged, remoteChanged } =
      mergeWorkspaceSnapshots(localSnapshot, remoteSnapshot);

    if (localChanged) {
      await applySnapshotLocally(mergedSnapshot);
    } else {
      await saveWorkspaceSnapshot(mergedSnapshot);
    }

    if (connectingState.provider !== "none" && (remoteChanged || !remoteSnapshot)) {
      await uploadRemoteSnapshot(connectingState, mergedSnapshot);
    }

    return persistSyncSettings({
      ...connectingState,
      status: "connected",
      lastSyncedAt: new Date().toISOString(),
      lastError: undefined,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to connect sync provider.";

    return persistSyncSettings({
      ...connectingState,
      status: "error",
      lastError: message,
    });
  }
}

export async function disconnectSyncProvider(): Promise<SyncSettings> {
  const settings = await loadSyncSettings();

  return persistSyncSettings({
    ...settings,
    status: "idle",
    lastError: undefined,
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
      const localSnapshot = await ensureWorkspaceSnapshot(
        await buildSnapshotFromLocalState(),
      );
      const nextSettings = await persistSyncSettings({
        ...settings,
        status: "connected",
        lastSyncedAt: force ? new Date().toISOString() : settings.lastSyncedAt,
        lastError: undefined,
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
      lastError: undefined,
    });

    try {
      const localSnapshot = await ensureWorkspaceSnapshot(
        await buildSnapshotFromLocalState(),
      );
      const remoteSnapshot = await downloadRemoteSnapshot(syncingSettings);
      const { mergedSnapshot, localChanged, remoteChanged } =
        mergeWorkspaceSnapshots(localSnapshot, remoteSnapshot);

      if (localChanged) {
        await applySnapshotLocally(mergedSnapshot);
      } else {
        await saveWorkspaceSnapshot(mergedSnapshot);
      }

      if (remoteChanged || !remoteSnapshot) {
        await uploadRemoteSnapshot(syncingSettings, mergedSnapshot);
      }

      return persistSyncSettings({
        ...syncingSettings,
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        lastError: undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed.";

      return persistSyncSettings({
        ...syncingSettings,
        status: "error",
        lastError: message,
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

export async function getLocalSnapshotMeta(): Promise<
  Pick<WorkspaceSnapshot, "updatedAt" | "version"> | undefined
> {
  const snapshot = await loadWorkspaceSnapshot();

  if (!snapshot) {
    return undefined;
  }

  return {
    updatedAt: snapshot.updatedAt,
    version: snapshot.version,
  };
}

export async function exportLocalSnapshot(): Promise<WorkspaceSnapshot> {
  const snapshot = await buildSnapshotFromLocalState();
  await saveWorkspaceSnapshot(snapshot);
  return snapshot;
}

export async function importLocalSnapshot(payload: unknown): Promise<WorkspaceSnapshot> {
  if (!isWorkspaceSnapshot(payload)) {
    throw new Error("Imported file is not a valid DevX workspace snapshot.");
  }

  const snapshot: WorkspaceSnapshot = {
    ...payload,
    updatedAt: payload.updatedAt || new Date().toISOString(),
  };

  await applySnapshotLocally(snapshot);
  return snapshot;
}

export function startSyncScheduler(): () => void {
  void ensureWorkspaceSnapshot(buildDefaultWorkspaceSnapshot());
  void scheduleSync();

  return () => {
    stopScheduler();
  };
}

export async function resetLocalSnapshot(): Promise<void> {
  await writeDevxSection(["settings", "sync"], defaultSyncSettings);
  await removeDevxSnapshot();
  await saveWorkspaceSnapshot(await buildSnapshotFromLocalState());
}
