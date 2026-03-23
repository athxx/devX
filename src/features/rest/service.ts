import { cloneValue, makeId } from "../../lib/utils";
import { loadProxySettings } from "../proxy/service";
import {
  loadRestPersistentStateFromDb,
  loadRestTempStateFromDb,
  saveRestPersistentStateToDb,
  saveRestTempStateToDb,
  type RestPersistentState,
  type RestTempState,
} from "./local-db";
import type {
  Collection,
  CollectionFolder,
  Environment,
  HistoryEntry,
  KeyValueEntry,
  RequestAuth,
  RequestBody,
  RequestDraft,
  RequestScripts,
  ResponseSummary,
  RestWorkspaceState
} from "./models";

export function createKeyValueEntry(
  partial: Partial<KeyValueEntry> = {}
): KeyValueEntry {
  return {
    id: partial.id ?? makeId("kv"),
    key: partial.key ?? "",
    value: partial.value ?? "",
    enabled: partial.enabled ?? true,
    valueType: partial.valueType ?? "text",
    fileName: partial.fileName ?? "",
    fileContent: partial.fileContent ?? "",
    fileContentType: partial.fileContentType ?? ""
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
    auth: partial.auth ?? { type: "none" },
    scripts: normalizeRequestScripts(partial.scripts)
  };
}

export function createDefaultRestWorkspace(): RestWorkspaceState {
  const defaultCollectionId = makeId("collection");
  const envDevelopmentId = makeId("env");
  const envStagingId = makeId("env");

  return {
    collections: [
      {
        id: defaultCollectionId,
        name: "Default",
        folders: [],
        requestIds: []
      }
    ],
    requests: [],
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
    lastResponse: null,
    openRequestIds: [],
    pinnedRequestIds: [],
    activeCollectionId: defaultCollectionId,
    activeRequestId: "",
    activeEnvironmentId: envDevelopmentId
  };
}

export async function loadRestWorkspace(): Promise<RestWorkspaceState> {
  const [persistentState, tempState] = await Promise.all([
    loadRestPersistentStateFromDb(),
    loadRestTempStateFromDb(),
  ]);
  const indexedDbState = {
    ...(persistentState ?? {}),
    ...(tempState ?? {}),
  } as RestWorkspaceState;

  if (persistentState) {
    return normalizeRestWorkspace(indexedDbState);
  }

  const seed = createDefaultRestWorkspace();
  await saveRestWorkspace(seed);
  return seed;
}

export async function saveRestWorkspace(state: RestWorkspaceState): Promise<void> {
  await Promise.all([
    saveRestPersistentStateToDb(serializeRestPersistentState(state)),
    saveRestTempStateToDb(serializeRestTempState(state)),
  ]);
}

function serializeRestPersistentState(
  state: RestWorkspaceState,
): RestPersistentState {
  return {
    collections: state.collections,
    requests: state.requests,
    environments: state.environments,
  };
}

function serializeRestTempState(state: RestWorkspaceState): RestTempState {
  return {
    history: state.history,
    lastResponse: state.lastResponse,
    openRequestIds: state.openRequestIds,
    pinnedRequestIds: state.pinnedRequestIds,
    activeCollectionId: state.activeCollectionId,
    activeRequestId: state.activeRequestId,
    activeEnvironmentId: state.activeEnvironmentId,
  };
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

function normalizeKeyValueEntry(entry: KeyValueEntry): KeyValueEntry {
  return {
    ...entry,
    enabled: entry.enabled ?? true,
    valueType: entry.valueType ?? "text",
    fileName: entry.fileName ?? "",
    fileContent: entry.fileContent ?? "",
    fileContentType: entry.fileContentType ?? ""
  };
}

function normalizeRequestScripts(scripts?: Partial<RequestScripts> | null): RequestScripts {
  return {
    preRequest: scripts?.preRequest ?? "",
    postResponse: scripts?.postResponse ?? ""
  };
}

export function normalizeRestWorkspace(state: RestWorkspaceState): RestWorkspaceState {
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
        folderId: request.folderId && folderIds.has(request.folderId) ? request.folderId : null,
        query: request.query.map(normalizeKeyValueEntry),
        headers: request.headers.map(normalizeKeyValueEntry),
        body: normalizeRequestBody(request.body),
        scripts: normalizeRequestScripts(request.scripts)
      };
    });
  const activeCollectionId =
    collections.find((collection) => collection.id === state.activeCollectionId)?.id ?? collections[0]?.id ?? "";
  const activeRequestId =
    requests.find((request) => request.id === state.activeRequestId)?.id ?? "";
  const requestIds = new Set(requests.map((request) => request.id));
  const openRequestIds = (state.openRequestIds ?? []).filter((requestId) => requestIds.has(requestId));
  const pinnedRequestIds = (state.pinnedRequestIds ?? []).filter((requestId) => requestIds.has(requestId));
  const activeEnvironmentId =
    state.environments.find((environment) => environment.id === state.activeEnvironmentId)?.id ??
    state.environments[0]?.id ??
    "";
  const lastResponse =
    state.lastResponse && requestIds.has(state.lastResponse.requestId)
      ? {
          requestId: state.lastResponse.requestId,
          response: {
            ...state.lastResponse.response,
            headers: state.lastResponse.response.headers.map(normalizeKeyValueEntry)
          }
        }
      : null;

  return {
    ...state,
    collections,
    requests,
    lastResponse,
    openRequestIds,
    pinnedRequestIds,
    activeCollectionId,
    activeRequestId,
    activeEnvironmentId
  };
}

function normalizeRequestBody(body: RequestBody): RequestBody {
  switch (body?.type) {
    case "json":
      return { type: "json", value: body.value ?? "" };
    case "form-data":
      return {
        type: "form-data",
        entries: Array.isArray(body.entries) ? body.entries.map(normalizeKeyValueEntry) : [createKeyValueEntry()]
      };
    case "form-urlencoded":
      return {
        type: "form-urlencoded",
        entries: Array.isArray(body.entries) ? body.entries.map(normalizeKeyValueEntry) : [createKeyValueEntry()]
      };
    case "raw":
      return {
        type: "raw",
        value: body.value ?? "",
        contentType: body.contentType || "text/plain"
      };
    case "binary":
      return { type: "binary", value: body.value ?? "" };
    case "none":
    default:
      return { type: "none" };
  }
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
    case "form-data": {
      const formData = new FormData();

      body.entries
        .filter((entry) => entry.enabled && entry.key.trim())
        .forEach((entry) => {
          const key = resolveTemplate(entry.key, environment);

          if (entry.valueType === "file" && entry.fileContent) {
            try {
              const binary = atob(entry.fileContent);
              const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
              const blob = new Blob([bytes], {
                type: entry.fileContentType || "application/octet-stream"
              });
              formData.append(key, blob, entry.fileName || "upload.bin");
              return;
            } catch {
              formData.append(key, resolveTemplate(entry.value, environment));
              return;
            }
          }

          formData.append(key, resolveTemplate(entry.value, environment));
        });

      return formData;
    }
    case "form-urlencoded": {
      headers.set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
      const params = new URLSearchParams();

      toResolvedEntries(body.entries, environment).forEach((entry) => {
        params.append(entry.key, entry.value);
      });

      return params.toString();
    }
    case "binary": {
      headers.set("Content-Type", "application/octet-stream");
      const encoded = resolveTemplate(body.value, environment).trim();

      if (!encoded) {
        return undefined;
      }

      try {
        const normalized = encoded.replace(/\s+/g, "");
        const binary = atob(normalized);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        return bytes;
      } catch {
        throw new Error("Binary body expects a valid base64 payload.");
      }
    }
  }
}

export async function executeRestRequestDirect(
  request: RequestDraft,
  environment?: Environment
): Promise<ResponseSummary> {
  const proxySettings = await loadProxySettings();
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
    headers,
    redirect: "follow",
    cache: "no-store"
  };

  if (!["GET", "DELETE", "HEAD"].includes(request.method)) {
    init.body = buildRequestBody(request.body, headers, environment);
  }

  let requestUrl = url.toString();

  if (proxySettings.api.mode === "proxy" && proxySettings.api.address.trim()) {
    requestUrl = proxySettings.api.address.trim();
    headers.set("x-ason-proxy", "devx");
    headers.set("x-ason-url", url.toString());
  }

  const startedAt = performance.now();
  const response = await fetch(requestUrl, init);
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
    ok: response.ok || response.status === 304,
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

export async function executeRestRequest(
  request: RequestDraft,
  environment?: Environment
): Promise<ResponseSummary> {
  const canUseExtensionRuntime =
    typeof chrome !== "undefined" &&
    Boolean(chrome.runtime?.id) &&
    typeof document !== "undefined";

  if (canUseExtensionRuntime) {
    try {
      const runtimeResponse = await chrome.runtime.sendMessage({
        type: "devx:rest-execute",
        payload: {
          request,
          environment
        }
      }) as
        | { ok: true; result: ResponseSummary }
        | { ok: false; error: string }
        | undefined;

      if (runtimeResponse?.ok) {
        return runtimeResponse.result;
      }

      if (runtimeResponse && !runtimeResponse.ok) {
        throw new Error(runtimeResponse.error || "Extension request failed.");
      }
    } catch {
      // Fall back to direct fetch below.
    }
  }

  try {
    return await executeRestRequestDirect(request, environment);
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message === "Failed to fetch" &&
      typeof chrome === "undefined"
    ) {
      throw new Error(
        "Failed to fetch. In web mode this usually means the target API blocks CORS. Try the Chrome extension build for cross-origin requests."
      );
    }

    throw error;
  }
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
    requestSnapshot: cloneValue(request)
  };
}
