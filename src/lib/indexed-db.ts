const DB_NAME = "devx-db";
const STORE_NAME = "kv";

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

export async function loadIndexedDbValue<T>(key: string): Promise<T | undefined> {
  return withStore<T | undefined>("readonly", (store) => store.get(key));
}

export async function saveIndexedDbValue<T>(key: string, value: T): Promise<void> {
  await withStore<IDBValidKey>("readwrite", (store) => store.put(value, key));
}
