import { getStoredValue, setStoredValue } from "../../lib/platform-storage";
import { loadRestWorkspaceFromDb, saveRestWorkspaceToDb } from "./local-db";
import type {
  Collection,
  CollectionFolder,
  Environment,
  HistoryEntry,
  KeyValueEntry,
  RequestAuth,
  RequestBody,
  RequestDraft,
  ResponseSummary,
  RestWorkspaceState
} from "./models";

const REST_WORKSPACE_KEY = "rest-workspace";

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createKeyValueEntry(
  partial: Partial<KeyValueEntry> = {}
): KeyValueEntry {
  return {
    id: partial.id ?? makeId("kv"),
    key: partial.key ?? "",
    value: partial.value ?? "",
    enabled: partial.enabled ?? true
  };
}

export function createRequestDraft(collectionId: string, partial: Partial<RequestDraft> = {}): RequestDraft {
  return {
    id: partial.id ?? makeId("request"),
    name: partial.name ?? "Untitled Request",
    createdAt: partial.createdAt ?? new Date().toISOString(),
    collectionId,
    folderId: partial.folderId ?? null,
    kind: partial.kind ?? "http",
    method: partial.method ?? "GET",
    url: partial.url ?? "{{baseUrl}}/users",
    query: partial.query ?? [],
    headers: partial.headers ?? [createKeyValueEntry({ key: "Accept", value: "application/json" })],
    body: partial.body ?? { type: "none" },
    auth: partial.auth ?? { type: "none" }
  };
}

export function createDefaultRestWorkspace(): RestWorkspaceState {
  const coreCollectionId = makeId("collection");
  const envDevelopmentId = makeId("env");
  const envStagingId = makeId("env");
  const request = createRequestDraft(coreCollectionId, {
    name: "List Users",
    method: "GET",
    url: "{{baseUrl}}/users",
    query: [createKeyValueEntry({ key: "_limit", value: "{{limit}}" })]
  });

  return {
    collections: [
      {
        id: coreCollectionId,
        name: "Core APIs",
        folders: [],
        requestIds: [request.id]
      }
    ],
    requests: [request],
    environments: [
      {
        id: envDevelopmentId,
        name: "Development",
        variables: [
          createKeyValueEntry({
            key: "baseUrl",
            value: "https://jsonplaceholder.typicode.com"
          }),
          createKeyValueEntry({
            key: "limit",
            value: "5"
          })
        ]
      },
      {
        id: envStagingId,
        name: "Staging",
        variables: [
          createKeyValueEntry({
            key: "baseUrl",
            value: "https://jsonplaceholder.typicode.com"
          }),
          createKeyValueEntry({
            key: "limit",
            value: "10"
          })
        ]
      }
    ],
    history: [],
    openRequestIds: [request.id],
    pinnedRequestIds: [],
    activeCollectionId: coreCollectionId,
    activeRequestId: request.id,
    activeEnvironmentId: envDevelopmentId
  };
}

export async function loadRestWorkspace(): Promise<RestWorkspaceState> {
  const localState = await getStoredValue<RestWorkspaceState>(REST_WORKSPACE_KEY, "local");

  if (localState) {
    const normalized = normalizeRestWorkspace(localState);

    try {
      await saveRestWorkspaceToDb(normalized);
    } catch {
      // Keep the local mirror as the fallback source of truth.
    }

    return normalized;
  }

  try {
    const indexedDbState = await loadRestWorkspaceFromDb();

    if (indexedDbState) {
      const normalized = normalizeRestWorkspace(indexedDbState);
      await setStoredValue(REST_WORKSPACE_KEY, normalized, "local");
      return normalized;
    }
  } catch {
    // Fall through to default workspace seed.
  }

  const seed = createDefaultRestWorkspace();

  try {
    await saveRestWorkspaceToDb(seed);
  } catch {
    // Local mirror below remains the fallback.
  }

  await setStoredValue(REST_WORKSPACE_KEY, seed, "local");

  return seed;
}

export async function saveRestWorkspace(state: RestWorkspaceState): Promise<void> {
  try {
    await saveRestWorkspaceToDb(state);
  } catch {
    // Local mirror below remains the fallback.
  }

  await setStoredValue(REST_WORKSPACE_KEY, state, "local");
}

function normalizeCollectionFolders(
  collection: Collection,
  collectionRequests: RequestDraft[]
): CollectionFolder[] {
  const requestIds = new Set(collectionRequests.map((request) => request.id));

  return (collection.folders ?? []).map((folder) => ({
    id: folder.id,
    name: folder.name,
    requestIds: (folder.requestIds ?? []).filter((requestId) => requestIds.has(requestId))
  }));
}

function normalizeRestWorkspace(state: RestWorkspaceState): RestWorkspaceState {
  const collections = state.collections.map((collection) => {
    const collectionRequests = state.requests
      .filter((request) => request.collectionId === collection.id)
      .map((request) => ({
        ...request,
        kind: request.kind ?? "http",
        folderId: request.folderId ?? null
      }));
    const folders = normalizeCollectionFolders(collection, collectionRequests);
    const folderIds = new Set(folders.map((folder) => folder.id));

    return {
      ...collection,
      folders,
      requestIds: collection.requestIds.filter((requestId) =>
        collectionRequests.some((request) => request.id === requestId)
      )
    };
  });

  const collectionIds = new Set(collections.map((collection) => collection.id));
  const requests = state.requests
      .filter((request) => collectionIds.has(request.collectionId))
    .map((request) => {
      const owner = collections.find((collection) => collection.id === request.collectionId);
      const folderIds = new Set(owner?.folders.map((folder) => folder.id) ?? []);

      return {
        ...request,
        createdAt: request.createdAt ?? new Date().toISOString(),
        kind: request.kind ?? "http",
        folderId: request.folderId && folderIds.has(request.folderId) ? request.folderId : null
      };
    });
  const activeCollectionId =
    collections.find((collection) => collection.id === state.activeCollectionId)?.id ?? collections[0]?.id ?? "";
  const activeRequestId =
    requests.find((request) => request.id === state.activeRequestId)?.id ?? requests[0]?.id ?? "";
  const requestIds = new Set(requests.map((request) => request.id));
  const openRequestIds = (state.openRequestIds ?? []).filter((requestId) => requestIds.has(requestId));
  const pinnedRequestIds = (state.pinnedRequestIds ?? []).filter((requestId) => requestIds.has(requestId));
  const activeEnvironmentId =
    state.environments.find((environment) => environment.id === state.activeEnvironmentId)?.id ??
    state.environments[0]?.id ??
    "";

  return {
    ...state,
    collections,
    requests,
    openRequestIds: openRequestIds.length > 0 ? openRequestIds : activeRequestId ? [activeRequestId] : [],
    pinnedRequestIds,
    activeCollectionId,
    activeRequestId,
    activeEnvironmentId
  };
}

export function resolveTemplate(value: string, environment?: Environment): string {
  if (!environment) {
    return value;
  }

  return value.replace(/\{\{(.*?)\}\}/g, (_, rawKey: string) => {
    const key = rawKey.trim();
    const match = environment.variables.find((item) => item.enabled && item.key === key);
    return match?.value ?? "";
  });
}

function toResolvedEntries(entries: KeyValueEntry[], environment?: Environment) {
  return entries
    .filter((entry) => entry.enabled && entry.key.trim())
    .map((entry) => ({
      key: resolveTemplate(entry.key, environment),
      value: resolveTemplate(entry.value, environment)
    }));
}

function applyAuth(
  auth: RequestAuth,
  headers: Headers,
  url: URL,
  environment?: Environment
) {
  switch (auth.type) {
    case "bearer":
      headers.set("Authorization", `Bearer ${resolveTemplate(auth.token, environment)}`);
      return;
    case "basic":
      headers.set(
        "Authorization",
        `Basic ${btoa(
          `${resolveTemplate(auth.username, environment)}:${resolveTemplate(auth.password, environment)}`
        )}`
      );
      return;
    case "api-key": {
      const key = resolveTemplate(auth.key, environment);
      const value = resolveTemplate(auth.value, environment);

      if (!key) {
        return;
      }

      if (auth.addTo === "query") {
        url.searchParams.set(key, value);
      } else {
        headers.set(key, value);
      }

      return;
    }
    case "none":
    default:
      return;
  }
}

function buildRequestBody(
  body: RequestBody,
  headers: Headers,
  environment?: Environment
): BodyInit | undefined {
  switch (body.type) {
    case "none":
      return undefined;
    case "json": {
      headers.set("Content-Type", "application/json");
      return resolveTemplate(body.value, environment);
    }
    case "raw": {
      headers.set("Content-Type", body.contentType || "text/plain");
      return resolveTemplate(body.value, environment);
    }
    case "form-urlencoded": {
      headers.set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
      const params = new URLSearchParams();

      toResolvedEntries(body.entries, environment).forEach((entry) => {
        params.append(entry.key, entry.value);
      });

      return params.toString();
    }
  }
}

export async function executeRestRequest(
  request: RequestDraft,
  environment?: Environment
): Promise<ResponseSummary> {
  const resolvedUrl = resolveTemplate(request.url, environment);
  const url = new URL(resolvedUrl);

  toResolvedEntries(request.query, environment).forEach((entry) => {
    url.searchParams.append(entry.key, entry.value);
  });

  const headers = new Headers();

  toResolvedEntries(request.headers, environment).forEach((entry) => {
    headers.set(entry.key, entry.value);
  });

  applyAuth(request.auth, headers, url, environment);

  const init: RequestInit = {
    method: request.method,
    headers
  };

  if (!["GET", "DELETE"].includes(request.method)) {
    init.body = buildRequestBody(request.body, headers, environment);
  }

  const startedAt = performance.now();
  const response = await fetch(url.toString(), init);
  const finishedAt = performance.now();
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "unknown";
  const sizeBytes = new TextEncoder().encode(text).length;
  let body = text;

  if (contentType.includes("application/json")) {
    try {
      body = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      body = text;
    }
  }

  const serializedHeaders: KeyValueEntry[] = Array.from(response.headers.entries()).map(([key, value]) =>
    createKeyValueEntry({
      key,
      value
    })
  );

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    timeMs: Math.round(finishedAt - startedAt),
    sizeBytes,
    contentType,
    body,
    headers: serializedHeaders,
    finalUrl: response.url || url.toString()
  };
}

export function createHistoryEntry(
  request: RequestDraft,
  response: ResponseSummary | null
): HistoryEntry {
  return {
    id: makeId("history"),
    requestId: request.id,
    requestName: request.name,
    method: request.method,
    status: response?.status ?? null,
    timeMs: response?.timeMs ?? 0,
    createdAt: new Date().toISOString(),
    requestSnapshot: structuredClone(request)
  };
}
