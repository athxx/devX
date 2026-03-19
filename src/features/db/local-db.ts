import { loadIndexedDbValue, saveIndexedDbValue } from "../../lib/indexed-db";
import type { DbWorkspaceState } from "./models";

const DB_WORKSPACE_KEY = "db-workspace";

export async function loadDbWorkspaceFromDb(): Promise<DbWorkspaceState | null> {
  return (await loadIndexedDbValue<DbWorkspaceState>(DB_WORKSPACE_KEY)) ?? null;
}

export async function saveDbWorkspaceToDb(workspace: DbWorkspaceState): Promise<void> {
  await saveIndexedDbValue(DB_WORKSPACE_KEY, workspace);
}
