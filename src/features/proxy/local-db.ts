import { loadIndexedDbValue, saveIndexedDbValue } from "../../lib/indexed-db";
import type { AppSettings } from "../../lib/storage";

const PROXY_SETTINGS_KEY = "proxy-settings";
const LEGACY_DB_NAME = "devx-settings-db";
const LEGACY_STORE_NAME = "settings";

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

export async function loadProxySettingsFromDb(): Promise<AppSettings["proxy"] | undefined> {
  const current = await loadIndexedDbValue<AppSettings["proxy"]>(PROXY_SETTINGS_KEY);

  if (current) {
    return current;
  }

  try {
    const legacy = await withLegacyStore<AppSettings["proxy"] | undefined>("readonly", (store) =>
      store.get(PROXY_SETTINGS_KEY)
    );

    if (legacy) {
      await saveIndexedDbValue(PROXY_SETTINGS_KEY, legacy);
    }

    return legacy;
  } catch {
    return undefined;
  }
}

export async function saveProxySettingsToDb(settings: AppSettings["proxy"]): Promise<void> {
  await saveIndexedDbValue(PROXY_SETTINGS_KEY, settings);
}
