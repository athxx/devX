import { loadIndexedDbValue, saveIndexedDbValue } from "../../lib/indexed-db";
import type { RestWorkspaceState } from "./models";

const REST_WORKSPACE_KEY = "rest-workspace";
const LEGACY_DB_NAME = "devx-workspace-db";
const LEGACY_STORE_NAME = "workspace";

function getIndexedDb() {
  if (typeof indexedDB === "undefined") {
    return null;
  }

  return indexedDB;
}

function openLegacyDatabase(): Promise<IDBDatabase> {
  const idb = getIndexedDb();

  if (!idb) {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }

  return new Promise((resolve, reject) => {
    const request = idb.open(LEGACY_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        database.createObjectStore(LEGACY_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

async function withLegacyStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openLegacyDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(LEGACY_STORE_NAME, mode);
    const store = transaction.objectStore(LEGACY_STORE_NAME);
    const request = operation(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
      database.close();
    };
  });
}

export async function loadRestWorkspaceFromDb(): Promise<RestWorkspaceState | undefined> {
  const current = await loadIndexedDbValue<RestWorkspaceState>(REST_WORKSPACE_KEY);

  if (current) {
    return current;
  }

  try {
    const legacy = await withLegacyStore<RestWorkspaceState | undefined>("readonly", (store) =>
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
