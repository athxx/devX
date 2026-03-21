import { loadDevxSnapshot, saveDevxSnapshot } from "../../lib/indexed-db";
import type { WorkspaceSnapshot } from "./types";

export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot | undefined> {
  return loadDevxSnapshot<WorkspaceSnapshot>();
}

export async function saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  await saveDevxSnapshot(snapshot);
}

export async function ensureWorkspaceSnapshot(seed: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
  const existing = await loadWorkspaceSnapshot();

  if (existing) {
    return existing;
  }

  await saveWorkspaceSnapshot(seed);
  return seed;
}
