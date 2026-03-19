import { loadProxySettings } from "../proxy/service";
import { loadDbWorkspaceFromDb, saveDbWorkspaceToDb } from "./local-db";
import type {
  DbConnection,
  DbConnectionConfig,
  DbConnectionKind,
  DbFavoriteQuery,
  DbFolder,
  DbQueryHistoryItem,
  DbResultPayload,
  DbTab,
  DbWorkspaceState
} from "./models";

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function defaultQueryForKind(kind: DbConnectionKind) {
  switch (kind) {
    case "redis":
      return "PING";
    case "mongodb":
      return "db.collection.find({})";
    case "clickhouse":
      return "SELECT 1";
    case "sqlite":
      return "SELECT sqlite_version();";
    case "oracle":
      return "SELECT 1 FROM dual";
    case "mysql":
    case "tidb":
    case "postgresql":
    case "gaussdb":
    case "sqlserver":
    default:
      return "SELECT 1;";
  }
}

function defaultNameForKind(kind: DbConnectionKind) {
  switch (kind) {
    case "redis":
      return "Redis";
    case "postgresql":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "mongodb":
      return "MongoDB";
    case "clickhouse":
      return "ClickHouse";
    case "gaussdb":
      return "GaussDB";
    case "oracle":
      return "Oracle";
    case "sqlite":
      return "SQLite";
    case "sqlserver":
      return "SQL Server";
    case "tidb":
      return "TiDB";
    default:
      return "Database";
  }
}

function defaultPortForKind(kind: DbConnectionKind) {
  switch (kind) {
    case "redis":
      return "6379";
    case "postgresql":
    case "gaussdb":
      return "5432";
    case "mysql":
    case "tidb":
      return "3306";
    case "mongodb":
      return "27017";
    case "clickhouse":
      return "8123";
    case "oracle":
      return "1521";
    case "sqlserver":
      return "1433";
    case "sqlite":
      return "";
    default:
      return "";
  }
}

function defaultDatabaseForKind(kind: DbConnectionKind) {
  switch (kind) {
    case "postgresql":
    case "mysql":
    case "gaussdb":
    case "clickhouse":
    case "sqlserver":
    case "tidb":
      return "devx";
    case "mongodb":
      return "test";
    case "oracle":
      return "FREEPDB1";
    default:
      return "";
  }
}

function defaultConnectionConfig(kind: DbConnectionKind): DbConnectionConfig {
  return {
    host: "127.0.0.1",
    port: defaultPortForKind(kind),
    username: "",
    password: "",
    database: defaultDatabaseForKind(kind),
    filePath: kind === "sqlite" ? "./devx.db" : "",
    authSource: kind === "mongodb" ? "admin" : "",
    serviceName: kind === "oracle" ? "FREEPDB1" : "",
    options: ""
  };
}

function encodeCredentialPart(value: string) {
  return encodeURIComponent(value);
}

function appendOptions(url: URL, options: string) {
  const normalized = options.trim().replace(/^\?/, "");
  if (!normalized) {
    return;
  }
  for (const [key, value] of new URLSearchParams(normalized)) {
    url.searchParams.set(key, value);
  }
}

export function buildDbConnectionUrl(connection: Pick<DbConnection, "kind" | "config" | "url">) {
  const config = connection.config;
  if (connection.kind === "sqlite") {
    return config.filePath.trim() || connection.url.trim();
  }

  const host = config.host.trim();
  const port = config.port.trim();
  const username = config.username.trim();
  const password = config.password.trim();
  const database = config.database.trim();

  if (!host) {
    return connection.url.trim();
  }

  switch (connection.kind) {
    case "redis": {
      const auth =
        username || password
          ? `${encodeCredentialPart(username)}${password ? `:${encodeCredentialPart(password)}` : ""}@`
          : "";
      const dbPath = database ? `/${encodeURIComponent(database)}` : "";
      const url = new URL(`redis://${auth}${host}${port ? `:${port}` : ""}${dbPath}`);
      appendOptions(url, config.options);
      return url.toString();
    }
    case "mongodb": {
      const auth =
        username || password
          ? `${encodeCredentialPart(username)}${password ? `:${encodeCredentialPart(password)}` : ""}@`
          : "";
      const dbPath = database ? `/${encodeURIComponent(database)}` : "";
      const url = new URL(`mongodb://${auth}${host}${port ? `:${port}` : ""}${dbPath}`);
      if (config.authSource.trim()) {
        url.searchParams.set("authSource", config.authSource.trim());
      }
      appendOptions(url, config.options);
      return url.toString();
    }
    case "sqlserver": {
      const auth =
        username || password
          ? `${encodeCredentialPart(username)}${password ? `:${encodeCredentialPart(password)}` : ""}@`
          : "";
      const url = new URL(`sqlserver://${auth}${host}${port ? `:${port}` : ""}`);
      if (database) {
        url.searchParams.set("database", database);
      }
      appendOptions(url, config.options);
      return url.toString();
    }
    case "oracle": {
      const auth =
        username || password
          ? `${encodeCredentialPart(username)}${password ? `:${encodeCredentialPart(password)}` : ""}@`
          : "";
      const serviceName = config.serviceName.trim() || database || "FREEPDB1";
      const url = new URL(`oracle://${auth}${host}${port ? `:${port}` : ""}/${encodeURIComponent(serviceName)}`);
      appendOptions(url, config.options);
      return url.toString();
    }
    default: {
      const scheme =
        connection.kind === "postgresql" ||
        connection.kind === "gaussdb" ||
        connection.kind === "clickhouse" ||
        connection.kind === "mysql" ||
        connection.kind === "tidb"
          ? connection.kind
          : "postgresql";
      const auth =
        username || password
          ? `${encodeCredentialPart(username)}${password ? `:${encodeCredentialPart(password)}` : ""}@`
          : "";
      const dbPath = database ? `/${encodeURIComponent(database)}` : "";
      const url = new URL(`${scheme}://${auth}${host}${port ? `:${port}` : ""}${dbPath}`);
      appendOptions(url, config.options);
      return url.toString();
    }
  }
}

function normalizeFolder(folder: DbFolder): DbFolder {
  return {
    id: folder.id,
    name: folder.name?.trim() || "New Folder"
  };
}

function normalizeConnectionConfig(
  config: Partial<DbConnectionConfig> | undefined,
  kind: DbConnectionKind
): DbConnectionConfig {
  return {
    ...defaultConnectionConfig(kind),
    ...config
  };
}

function normalizeConnection(connection: DbConnection, folderIds: Set<string>): DbConnection {
  const kind = connection.kind ?? "postgresql";
  const config = normalizeConnectionConfig(connection.config, kind);
  const fallbackUrl = connection.url?.trim() || buildDbConnectionUrl({ kind, config, url: "" });
  return {
    id: connection.id,
    name: connection.name?.trim() || defaultNameForKind(kind),
    kind,
    url: fallbackUrl,
    config,
    folderId: connection.folderId && folderIds.has(connection.folderId) ? connection.folderId : null,
    defaultQuery: connection.defaultQuery?.trim() || defaultQueryForKind(kind)
  };
}

function normalizeTab(tab: DbTab, connectionIds: Set<string>, connectionsById: Map<string, DbConnection>): DbTab | null {
  if (!connectionIds.has(tab.connectionId)) {
    return null;
  }
  const connection = connectionsById.get(tab.connectionId);
  return {
    id: tab.id,
    connectionId: tab.connectionId,
    title: tab.title?.trim() || connection?.name || "Query",
    query: tab.query ?? connection?.defaultQuery ?? ""
  };
}

function normalizeWorkspace(workspace: DbWorkspaceState | null | undefined): DbWorkspaceState {
  const folders = (workspace?.folders ?? []).map(normalizeFolder);
  const folderIds = new Set(folders.map((folder) => folder.id));
  const connections = (workspace?.connections ?? []).map((connection) =>
    normalizeConnection(connection, folderIds)
  );
  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  const connectionIds = new Set(connections.map((connection) => connection.id));
  const tabsById = Object.fromEntries(
    Object.entries(workspace?.tabsById ?? {})
      .map(([tabId, tab]) => [tabId, normalizeTab(tab, connectionIds, connectionsById)])
      .filter(([, tab]) => Boolean(tab))
  ) as Record<string, DbTab>;
  const validTabIds = new Set(Object.keys(tabsById));
  const openTabIds = (workspace?.openTabIds ?? []).filter((id) => validTabIds.has(id));
  const pinnedTabIds = (workspace?.pinnedTabIds ?? []).filter((id) => validTabIds.has(id));
  const activeTabId =
    workspace?.activeTabId && validTabIds.has(workspace.activeTabId)
      ? workspace.activeTabId
      : openTabIds.at(-1) ?? null;

  return {
    folders,
    connections,
    openTabIds,
    pinnedTabIds,
    activeTabId,
    tabsById,
    favorites: (workspace?.favorites ?? []).map((item) => ({
      id: item.id,
      connectionId: item.connectionId,
      name: item.name?.trim() || "Favorite Query",
      query: item.query ?? "",
      createdAt: item.createdAt ?? new Date().toISOString()
    })),
    history: (workspace?.history ?? []).map((item) => ({
      id: item.id,
      connectionId: item.connectionId,
      connectionName: item.connectionName?.trim() || "Connection",
      kind: item.kind ?? "postgresql",
      query: item.query ?? "",
      createdAt: item.createdAt ?? new Date().toISOString(),
      status: item.status === "error" ? "error" : "success"
    }))
  };
}

export async function loadDbWorkspace(): Promise<DbWorkspaceState> {
  const stored = await loadDbWorkspaceFromDb();
  const normalized = normalizeWorkspace(stored);
  if (!stored || JSON.stringify(stored) !== JSON.stringify(normalized)) {
    await saveDbWorkspaceToDb(normalized);
  }
  return normalized;
}

export async function saveDbWorkspace(workspace: DbWorkspaceState): Promise<void> {
  await saveDbWorkspaceToDb(normalizeWorkspace(workspace));
}

export function createDbConnection(kind: DbConnectionKind, folderId: string | null = null): DbConnection {
  return {
    id: makeId("db-conn"),
    name: `New ${defaultNameForKind(kind)}`,
    kind,
    url: "",
    config: defaultConnectionConfig(kind),
    folderId,
    defaultQuery: defaultQueryForKind(kind)
  };
}

export function createDbFolder(): DbFolder {
  return {
    id: makeId("db-folder"),
    name: "New Folder"
  };
}

export function createDbTab(connection: DbConnection): DbTab {
  return {
    id: makeId("db-tab"),
    connectionId: connection.id,
    title: connection.name,
    query: connection.defaultQuery
  };
}

export function createDbFavorite(connection: DbConnection, query: string, name?: string): DbFavoriteQuery {
  return {
    id: makeId("db-favorite"),
    connectionId: connection.id,
    name: name?.trim() || `${connection.name} Favorite`,
    query,
    createdAt: new Date().toISOString()
  };
}

export function createDbHistoryItem(
  connection: DbConnection,
  query: string,
  status: "success" | "error"
): DbQueryHistoryItem {
  return {
    id: makeId("db-history"),
    connectionId: connection.id,
    connectionName: connection.name,
    kind: connection.kind,
    query,
    createdAt: new Date().toISOString(),
    status
  };
}

export async function buildDbRelayUrl(): Promise<string | null> {
  const settings = await loadProxySettings();
  if (settings.db.mode !== "proxy" || !settings.db.address.trim()) {
    return null;
  }
  const normalized = settings.db.address
    .trim()
    .replace(/\/+$/, "")
    .replace(/^http:/i, "ws:")
    .replace(/^https:/i, "wss:");

  try {
    const url = new URL(normalized);
    url.searchParams.set("x-ason-proxy", "devx");
    return url.toString();
  } catch {
    const separator = normalized.includes("?") ? "&" : "?";
    return `${normalized}${separator}x-ason-proxy=devx`;
  }
}

function splitRedisCommand(command: string) {
  const matches = command.match(/"[^"]*"|'[^']*'|`[^`]*`|[^\s]+/g) ?? [];
  return matches.map((part) => part.replace(/^['"`]|['"`]$/g, ""));
}

function buildDbCommandMessage(tab: DbTab, connection: DbConnection) {
  if (connection.kind === "redis") {
    const parts = splitRedisCommand(tab.query.trim());
    return {
      id: tab.id,
      type: "redis",
      payload: {
        url: connection.url,
        command: parts[0] ?? "",
        arguments: parts.slice(1)
      }
    };
  }

  if (connection.kind === "mongodb") {
    return {
      id: tab.id,
      type: "mongoShell",
      payload: {
        url: connection.url,
        command: tab.query
      }
    };
  }

  return {
    id: tab.id,
    type: "sql",
    payload: {
      driver: connection.kind,
      dsn: connection.url,
      query: tab.query
    }
  };
}

type DbSocketResponse = {
  id?: string;
  type?: string;
  error?: string;
  data?: unknown;
};

export async function executeDbTab(tab: DbTab, connection: DbConnection): Promise<DbResultPayload> {
  const relayUrl = await buildDbRelayUrl();
  if (!relayUrl) {
    throw new Error("未配置 DB Proxy，请先到 Settings → Proxy 填写地址。");
  }

  const payload = buildDbCommandMessage(tab, connection);

  return new Promise<DbResultPayload>((resolve, reject) => {
    const ws = new WebSocket(relayUrl);
    let settled = false;

    const cleanup = () => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    ws.onopen = () => {
      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (event) => {
      let message: DbSocketResponse;
      try {
        message = JSON.parse(event.data as string) as DbSocketResponse;
      } catch {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error("Invalid DB relay response."));
        }
        return;
      }

      if (message.type === "error") {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(message.error || "DB relay error"));
        }
        return;
      }

      if (message.id !== tab.id) {
        return;
      }

      if (!settled) {
        settled = true;
        cleanup();
        resolve({
          kind:
            connection.kind === "redis"
              ? "redis"
              : connection.kind === "mongodb"
                ? "mongo"
                : "sql",
          data: (message.data ?? {}) as Record<string, unknown>
        } as DbResultPayload);
      }
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("DB websocket error"));
      }
    };

    ws.onclose = () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("DB websocket closed unexpectedly"));
      }
    };
  });
}
