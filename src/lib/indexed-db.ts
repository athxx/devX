const DB_NAME = "devx";
const SECTION_RECORD_KEY = "current";
const SNAPSHOT_LIMIT = 5;

export const DEVX_SECTION_STORES = [
  "settings",
  "api",
  "db",
  "ssh",
  "vault",
] as const;

const SNAPSHOT_STORE = "snapshot";
const ALL_STORES = [...DEVX_SECTION_STORES, SNAPSHOT_STORE] as const;

export type DevxSectionStoreName = (typeof DEVX_SECTION_STORES)[number];

export type DevxSectionMeta = {
  version: 1;
  updatedAt: string;
};

export type DevxSectionEnvelope<T = unknown> = {
  meta: DevxSectionMeta;
  data: T;
};

export type DevxIndexedDocument = Partial<
  Record<DevxSectionStoreName, DevxSectionEnvelope<unknown>>
>;

type SnapshotRecord<T = unknown> = {
  id: string;
  createdAt: string;
  value: T;
};

function getIndexedDb() {
  if (typeof indexedDB === "undefined") {
    return null;
  }

  return indexedDB;
}

function isSectionStoreName(value: string): value is DevxSectionStoreName {
  return DEVX_SECTION_STORES.includes(value as DevxSectionStoreName);
}

function createSectionEnvelope<T>(data: T): DevxSectionEnvelope<T> {
  return {
    meta: {
      version: 1,
      updatedAt: new Date().toISOString(),
    },
    data,
  };
}

function makeSnapshotId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function openDatabase(): Promise<IDBDatabase> {
  const idb = getIndexedDb();

  if (!idb) {
    return Promise.reject(
      new Error("IndexedDB is not available in this environment."),
    );
  }

  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      const existingStores = Array.from(database.objectStoreNames);

      for (const storeName of existingStores) {
        database.deleteObjectStore(storeName);
      }

      for (const storeName of DEVX_SECTION_STORES) {
        database.createObjectStore(storeName);
      }

      database.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

async function withStore<T>(
  storeName: typeof ALL_STORES[number],
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = operation(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
      database.close();
    };
  });
}

async function loadSectionEnvelope<T>(
  storeName: DevxSectionStoreName,
): Promise<DevxSectionEnvelope<T> | undefined> {
  return withStore<DevxSectionEnvelope<T> | undefined>(
    storeName,
    "readonly",
    (store) => store.get(SECTION_RECORD_KEY),
  );
}

async function saveSectionEnvelope<T>(
  storeName: DevxSectionStoreName,
  envelope: DevxSectionEnvelope<T>,
): Promise<void> {
  await withStore<IDBValidKey>(storeName, "readwrite", (store) =>
    store.put(envelope, SECTION_RECORD_KEY),
  );
}

async function clearSectionStore(storeName: DevxSectionStoreName): Promise<void> {
  await withStore<undefined>(storeName, "readwrite", (store) => store.clear());
}

function readNestedValue<T>(
  root: unknown,
  path: string[],
): T | undefined {
  let current = root;

  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current as T | undefined;
}

function writeNestedValue<T>(
  root: unknown,
  path: string[],
  value: T,
): unknown {
  if (path.length === 0) {
    return value;
  }

  const nextRoot =
    root && typeof root === "object" && !Array.isArray(root)
      ? (structuredClone(root) as Record<string, unknown>)
      : {};
  let cursor = nextRoot;

  for (const segment of path.slice(0, -1)) {
    const current = cursor[segment];

    if (!current || typeof current !== "object" || Array.isArray(current)) {
      cursor[segment] = {};
    }

    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[path[path.length - 1]!] = value;
  return nextRoot;
}

function removeNestedValue(root: unknown, path: string[]): unknown {
  if (path.length === 0) {
    return undefined;
  }

  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return root;
  }

  const nextRoot = structuredClone(root) as Record<string, unknown>;
  let cursor: Record<string, unknown> | undefined = nextRoot;

  for (const segment of path.slice(0, -1)) {
    const current = cursor?.[segment];

    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return nextRoot;
    }

    cursor = current as Record<string, unknown>;
  }

  if (cursor) {
    delete cursor[path[path.length - 1]!];
  }

  return nextRoot;
}

export async function loadDevxDocument(): Promise<DevxIndexedDocument> {
  const entries = await Promise.all(
    DEVX_SECTION_STORES.map(async (storeName) => {
      const envelope = await loadSectionEnvelope(storeName);
      return [storeName, envelope] as const;
    }),
  );

  return Object.fromEntries(
    entries.filter(([, envelope]) => envelope !== undefined),
  ) as DevxIndexedDocument;
}

export async function saveDevxDocument(
  document: DevxIndexedDocument,
): Promise<void> {
  for (const storeName of DEVX_SECTION_STORES) {
    const envelope = document[storeName];

    if (envelope) {
      await saveSectionEnvelope(storeName, envelope);
    } else {
      await clearSectionStore(storeName);
    }
  }
}

export async function readDevxSection<T>(
  path: string[],
): Promise<T | undefined> {
  const [storeName, ...nestedPath] = path;

  if (!storeName || !isSectionStoreName(storeName)) {
    return undefined;
  }

  const envelope = await loadSectionEnvelope(storeName);

  if (!envelope) {
    return undefined;
  }

  if (nestedPath.length === 0) {
    return envelope.data as T;
  }

  return readNestedValue<T>(envelope.data, nestedPath);
}

export async function writeDevxSection<T>(
  path: string[],
  value: T,
): Promise<void> {
  const [storeName, ...nestedPath] = path;

  if (!storeName || !isSectionStoreName(storeName)) {
    return;
  }

  if (nestedPath.length === 0) {
    await saveSectionEnvelope(storeName, createSectionEnvelope(value));
    return;
  }

  const current = await loadSectionEnvelope<Record<string, unknown>>(storeName);
  const nextData = writeNestedValue(current?.data, nestedPath, value);
  await saveSectionEnvelope(storeName, createSectionEnvelope(nextData));
}

export async function removeDevxSection(path: string[]): Promise<void> {
  const [storeName, ...nestedPath] = path;

  if (!storeName || !isSectionStoreName(storeName)) {
    return;
  }

  if (nestedPath.length === 0) {
    await clearSectionStore(storeName);
    return;
  }

  const current = await loadSectionEnvelope<Record<string, unknown>>(storeName);

  if (!current) {
    return;
  }

  const nextData = removeNestedValue(current.data, nestedPath);
  await saveSectionEnvelope(storeName, createSectionEnvelope(nextData));
}

export async function loadDevxSnapshot<T>(): Promise<T | undefined> {
  const snapshots = await withStore<Array<SnapshotRecord<T>>>(
    SNAPSHOT_STORE,
    "readonly",
    (store) => store.getAll(),
  );

  const latest = snapshots.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )[0];

  return latest?.value;
}

export async function saveDevxSnapshot<T>(snapshot: T): Promise<void> {
  const createdAt = new Date().toISOString();

  const database = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
    const store = transaction.objectStore(SNAPSHOT_STORE);

    store.put({
      id: makeSnapshotId(),
      createdAt,
      value: snapshot,
    } satisfies SnapshotRecord<T>);

    const getAllRequest = store.getAll();

    getAllRequest.onerror = () =>
      reject(getAllRequest.error ?? new Error("Failed to read snapshot history."));

    getAllRequest.onsuccess = () => {
      const snapshots = (getAllRequest.result as Array<SnapshotRecord<T>>).sort(
        (left, right) => right.createdAt.localeCompare(left.createdAt),
      );
      const overflow = snapshots.slice(SNAPSHOT_LIMIT);

      for (const record of overflow) {
        store.delete(record.id);
      }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    };
  });

  database.close();
}

export async function removeDevxSnapshot(): Promise<void> {
  await withStore<undefined>(SNAPSHOT_STORE, "readwrite", (store) =>
    store.clear(),
  );
}

export async function listIndexedDbEntries(): Promise<
  Array<{ key: string; value: unknown }>
> {
  const document = await loadDevxDocument();
  const snapshots = await withStore<Array<SnapshotRecord>>(
    SNAPSHOT_STORE,
    "readonly",
    (store) => store.getAll(),
  );

  const entries: Array<{ key: string; value: unknown }> = DEVX_SECTION_STORES.map((storeName) => ({
    key: storeName,
    value: document[storeName],
  })).filter((entry) => entry.value !== undefined);

  if (snapshots.length > 0) {
    entries.push({
      key: SNAPSHOT_STORE,
      value: snapshots.sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    });
  }

  return entries;
}
