import type { RestWorkspaceState } from "./models";

const DB_NAME = "devx-workspace-db";
const STORE_NAME = "workspace";
const REST_WORKSPACE_KEY = "rest-workspace";

function getIndexedDb() {
  if (typeof indexedDB === "undefined") {
    return null;
  }

  return indexedDB;
}

function openDatabase(): Promise<IDBDatabase> {
  const idb = getIndexedDb();

  if (!idb) {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }

  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
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
  return withStore<RestWorkspaceState | undefined>("readonly", (store) => store.get(REST_WORKSPACE_KEY));
}

export async function saveRestWorkspaceToDb(state: RestWorkspaceState): Promise<void> {
  await withStore<IDBValidKey>("readwrite", (store) => store.put(state, REST_WORKSPACE_KEY));
}
