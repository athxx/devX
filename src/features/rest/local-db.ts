import { loadIndexedDbValue, saveIndexedDbValue } from "../../lib/indexed-db";
import { withLegacyStore } from "../../lib/legacy-db";
import type { RestWorkspaceState } from "./models";

const REST_WORKSPACE_KEY = "rest-workspace";
const LEGACY_DB_NAME = "devx-workspace-db";
const LEGACY_STORE_NAME = "workspace";

export async function loadRestWorkspaceFromDb(): Promise<RestWorkspaceState | undefined> {
  const current = await loadIndexedDbValue<RestWorkspaceState>(REST_WORKSPACE_KEY);

  if (current) {
    return current;
  }

  try {
    const legacy = await withLegacyStore<RestWorkspaceState | undefined>(LEGACY_DB_NAME, LEGACY_STORE_NAME, "readonly", (store) =>
      store.get(REST_WORKSPACE_KEY)
    );

    if (legacy) {
      await saveIndexedDbValue(REST_WORKSPACE_KEY, legacy);
    }

    return legacy;
  } catch {
    return undefined;
  }
}

export async function saveRestWorkspaceToDb(state: RestWorkspaceState): Promise<void> {
  await saveIndexedDbValue(REST_WORKSPACE_KEY, state);
}
