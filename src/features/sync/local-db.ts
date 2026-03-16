import type { WorkspaceSnapshot } from "./types";

const DB_NAME = "devox-sync-db";
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "workspace-snapshot";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

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

export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot | undefined> {
  const result = await withStore<WorkspaceSnapshot | undefined>("readonly", (store) =>
    store.get(SNAPSHOT_KEY)
  );

  return result;
}

export async function saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  await withStore<IDBValidKey>("readwrite", (store) => store.put(snapshot, SNAPSHOT_KEY));
}

export async function ensureWorkspaceSnapshot(seed: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
  const existing = await loadWorkspaceSnapshot();

  if (existing) {
    return existing;
  }

  await saveWorkspaceSnapshot(seed);
  return seed;
}
