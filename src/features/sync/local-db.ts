import { loadIndexedDbValue, saveIndexedDbValue } from "../../lib/indexed-db";
import { withLegacyStore } from "../../lib/legacy-db";
import type { WorkspaceSnapshot } from "./types";

const SNAPSHOT_KEY = "workspace-snapshot";
const LEGACY_DB_NAME = "devx-sync-db";
const LEGACY_STORE_NAME = "snapshots";

export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot | undefined> {
  const current = await loadIndexedDbValue<WorkspaceSnapshot>(SNAPSHOT_KEY);

  if (current) {
    return current;
  }

  try {
    const legacy = await withLegacyStore<WorkspaceSnapshot | undefined>(LEGACY_DB_NAME, LEGACY_STORE_NAME, "readonly", (store) =>
      store.get(SNAPSHOT_KEY)
    );

    if (legacy) {
      await saveIndexedDbValue(SNAPSHOT_KEY, legacy);
    }

    return legacy;
  } catch {
    return undefined;
  }
}

export async function saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  await saveIndexedDbValue(SNAPSHOT_KEY, snapshot);
}

export async function ensureWorkspaceSnapshot(seed: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
  const existing = await loadWorkspaceSnapshot();

  if (existing) {
    return existing;
  }

  await saveWorkspaceSnapshot(seed);
  return seed;
}
