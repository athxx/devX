import { makeId } from "../../lib/utils";
import { loadProxySettings } from "../proxy/service";
import { loadDbWorkspaceFromDb, saveDbWorkspaceToDb } from "./local-db";
import type {
  DbConnection,
  DbConnectionConfig,
  DbExplorerNode,
  DbConnectionKind,
  DbFavoriteQuery,
  DbQueryHistoryItem,
  DbResultPayload,
  DbTab,
  DbWorkspaceState,
} from "./models";

type LegacyDbWorkspaceState = Partial<DbWorkspaceState> & {
  connections?: DbConnection[];
  folders?: unknown[];
};

type DbSocketResponse = {
  id?: string;
  type?: string;
  error?: string;
  data?: unknown;
};

type DbSocketCommandMessage = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
};

type SqlExplorerRow = {
  schema_name?: unknown;
  table_name?: unknown;
  table_type?: unknown;
};

type SqlExplorerRoutineRow = {
  schema_name?: unknown;
  routine_name?: unknown;
};

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
      return "";
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
    filePath: kind === "sqlite" ? "./asonx.db" : "",
    authSource: kind === "mongodb" ? "admin" : "",
    serviceName: kind === "oracle" ? "FREEPDB1" : "",
    options: "",
  };
}

function encodeCredentialPart(value: string) {
  return encodeURIComponent(value);
}

function parseOptionEntries(options: string) {
  const normalized = options.trim().replace(/^\?/, "");
  if (!normalized) {
    return [] as Array<[string, string]>;
  }
  return Array.from(new URLSearchParams(normalized).entries()).filter(
    ([key]) => key.trim().length > 0,
  );
}

function appendUrlOptions(url: URL, options: string) {
  for (const [key, value] of parseOptionEntries(options)) {
    url.searchParams.set(key, value);
  }
}

function formatKeywordValue(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  if (/[\s'"]/u.test(normalized)) {
    return `'${normalized.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }
  return normalized;
}

function buildKeywordDsn(parts: Array<[string, string]>, options: string) {
  const result: string[] = [];

  for (const [key, value] of parts) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    result.push(`${key}=${formatKeywordValue(normalized)}`);
  }

  for (const [key, value] of parseOptionEntries(options)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      continue;
    }
    result.push(`${normalizedKey}=${formatKeywordValue(value)}`);
  }

  return result.join(" ");
}

function buildMySqlStyleDsn(
  connection: Pick<DbConnection, "config" | "url">,
  treatAsTiDb = false,
) {
  const config = connection.config;
  const host = config.host.trim();
  const port = config.port.trim();
  const username = config.username.trim();
  const password = config.password.trim();
  const database = config.database.trim();

  if (!host) {
    return connection.url.trim();
  }

  const auth =
    username || password
      ? `${username}${password ? `:${password}` : ""}@`
      : "";
  const params = new URLSearchParams(parseOptionEntries(config.options));
  if (treatAsTiDb && !params.has("charset")) {
    params.set("charset", "utf8mb4");
  }

  return `${auth}tcp(${host}${port ? `:${port}` : ""})/${database}${
    params.toString() ? `?${params.toString()}` : ""
  }`;
}

export function buildDbConnectionUrl(
  connection: Pick<DbConnection, "kind" | "config" | "url">,
) {
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
          ? `${encodeCredentialPart(username)}${
              password ? `:${encodeCredentialPart(password)}` : ""
            }@`
          : "";
      const dbPath = database ? `/${encodeURIComponent(database)}` : "";
      const url = new URL(
        `redis://${auth}${host}${port ? `:${port}` : ""}${dbPath}`,
      );
      appendUrlOptions(url, config.options);
      return url.toString();
    }
    case "mongodb": {
      const auth =
        username || password
          ? `${encodeCredentialPart(username)}${
              password ? `:${encodeCredentialPart(password)}` : ""
            }@`
          : "";
      const dbPath = database ? `/${encodeURIComponent(database)}` : "";
      const url = new URL(
        `mongodb://${auth}${host}${port ? `:${port}` : ""}${dbPath}`,
      );
      if (config.authSource.trim()) {
        url.searchParams.set("authSource", config.authSource.trim());
      }
      appendUrlOptions(url, config.options);
      return url.toString();
    }
    case "mysql":
      return buildMySqlStyleDsn(connection);
    case "tidb":
      return buildMySqlStyleDsn(connection, true);
    case "postgresql":
      return buildKeywordDsn(
        [
          ["host", host],
          ["port", port],
          ["user", username],
          ["password", password],
          ["dbname", database],
        ],
        config.options,
      );
    case "gaussdb":
      return buildKeywordDsn(
        [
          ["host", host],
          ["port", port],
          ["user", username],
          ["password", password],
          ["dbname", database],
        ],
        config.options,
      );
    case "sqlserver": {
      const auth =
        username || password
          ? `${encodeCredentialPart(username)}${
              password ? `:${encodeCredentialPart(password)}` : ""
            }@`
          : "";
      const url = new URL(`sqlserver://${auth}${host}${port ? `:${port}` : ""}`);
      if (database) {
        url.searchParams.set("database", database);
      }
      appendUrlOptions(url, config.options);
      return url.toString();
    }
    case "oracle": {
      const auth =
        username || password
          ? `${encodeCredentialPart(username)}${
              password ? `:${encodeCredentialPart(password)}` : ""
            }@`
          : "";
      const serviceName = config.serviceName.trim() || database || "FREEPDB1";
      const url = new URL(
        `oracle://${auth}${host}${port ? `:${port}` : ""}/${encodeURIComponent(
          serviceName,
        )}`,
      );
      appendUrlOptions(url, config.options);
      return url.toString();
    }
    case "clickhouse":
    default: {
      const auth =
        username || password
          ? `${encodeCredentialPart(username)}${
              password ? `:${encodeCredentialPart(password)}` : ""
            }@`
          : "";
      const dbPath = database ? `/${encodeURIComponent(database)}` : "";
      const url = new URL(
        `${connection.kind}://${auth}${host}${port ? `:${port}` : ""}${dbPath}`,
      );
      appendUrlOptions(url, config.options);
      return url.toString();
    }
  }
}

function normalizeConnectionConfig(
  config: Partial<DbConnectionConfig> | undefined,
  kind: DbConnectionKind,
): DbConnectionConfig {
  return {
    ...defaultConnectionConfig(kind),
    ...config,
  };
}

function normalizeConnection(connection: Partial<DbConnection> | null | undefined) {
  const safeConnection: Partial<DbConnection> = connection ?? {};
  const kind = safeConnection.kind ?? "postgresql";
  const config = normalizeConnectionConfig(safeConnection.config, kind);
  const fallbackUrl =
    safeConnection.url?.trim() || buildDbConnectionUrl({ kind, config, url: "" });

  return {
    id: safeConnection.id ?? makeId("db-conn"),
    name: safeConnection.name?.trim() || defaultNameForKind(kind),
    kind,
    url: fallbackUrl,
    config,
    defaultQuery:
      safeConnection.defaultQuery?.trim() || defaultQueryForKind(kind),
  };
}

function normalizeTab(
  tab: Partial<DbTab> | null | undefined,
  connectionIds: Set<string>,
  connectionsById: Map<string, DbConnection>,
): DbTab | null {
  if (!tab?.connectionId || !connectionIds.has(tab.connectionId)) {
    return null;
  }

  const connection = connectionsById.get(tab.connectionId);
  return {
    id: tab.id ?? makeId("db-tab"),
    connectionId: tab.connectionId,
    title: tab.title?.trim() || connection?.name || "Query",
    query: tab.query ?? connection?.defaultQuery ?? "",
  };
}

function normalizeWorkspace(
  workspace: LegacyDbWorkspaceState | null | undefined,
): DbWorkspaceState {
  const savedConnectionsSource = Array.isArray(workspace?.savedConnections)
    ? workspace.savedConnections
    : Array.isArray(workspace?.connections)
      ? workspace.connections
      : [];
  const savedConnections = savedConnectionsSource.map(normalizeConnection);
  const connectionsById = new Map(
    savedConnections.map((connection) => [connection.id, connection]),
  );
  const connectionIds = new Set(savedConnections.map((connection) => connection.id));

  const tabsById = Object.fromEntries(
    Object.entries(workspace?.tabsById ?? {})
      .map(([tabId, tab]) => [
        tabId,
        normalizeTab(tab, connectionIds, connectionsById),
      ])
      .filter(([, tab]) => Boolean(tab)),
  ) as Record<string, DbTab>;

  const validTabIds = new Set(Object.keys(tabsById));
  const openTabIds = (workspace?.openTabIds ?? []).filter((id) =>
    validTabIds.has(id),
  );
  const pinnedTabIds = (workspace?.pinnedTabIds ?? []).filter((id) =>
    validTabIds.has(id),
  );
  const activeTabId =
    workspace?.activeTabId && validTabIds.has(workspace.activeTabId)
      ? workspace.activeTabId
      : openTabIds.at(-1) ?? null;

  const favorites = (Array.isArray(workspace?.favorites) ? workspace.favorites : [])
    .filter((f): f is DbFavoriteQuery => Boolean(f?.id && f?.connectionId && connectionIds.has(f.connectionId)));

  const MAX_HISTORY = 100;
  const history = (Array.isArray(workspace?.history) ? workspace.history : [])
    .filter((h): h is DbQueryHistoryItem => Boolean(h?.id && h?.connectionId))
    .slice(0, MAX_HISTORY);

  const derivedConnectedConnectionIds = Array.from(
    new Set(
      openTabIds
        .map((tabId) => tabsById[tabId]?.connectionId)
        .filter((id): id is string => Boolean(id) && connectionIds.has(id)),
    ),
  );

  const connectedConnectionIds = (
    workspace?.connectedConnectionIds ?? derivedConnectedConnectionIds
  ).filter((id) => connectionIds.has(id));

  const activeConnectionId =
    workspace?.activeConnectionId && connectionIds.has(workspace.activeConnectionId)
      ? workspace.activeConnectionId
      : activeTabId && tabsById[activeTabId]
        ? tabsById[activeTabId].connectionId
        : connectedConnectionIds[0] ?? null;

  return {
    savedConnections,
    connectedConnectionIds,
    activeConnectionId,
    openTabIds,
    pinnedTabIds,
    activeTabId,
    tabsById,
    favorites,
    history,
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

export function createDbConnection(kind: DbConnectionKind): DbConnection {
  const config = defaultConnectionConfig(kind);
  return {
    id: makeId("db-conn"),
    name: `New ${defaultNameForKind(kind)}`,
    kind,
    url: buildDbConnectionUrl({ kind, config, url: "" }),
    config,
    defaultQuery: defaultQueryForKind(kind),
  };
}

export function createDbTab(connection: DbConnection): DbTab {
  return {
    id: makeId("db-tab"),
    connectionId: connection.id,
    title: connection.name,
    query: connection.defaultQuery,
  };
}

export function createDbFavorite(
  connectionId: string,
  name: string,
  query: string,
): DbFavoriteQuery {
  return {
    id: makeId("db-fav"),
    connectionId,
    name: name.trim() || "Untitled Query",
    query,
  };
}

export function createDbHistoryItem(
  connection: DbConnection,
  query: string,
  status: "success" | "error",
): DbQueryHistoryItem {
  return {
    id: makeId("db-hist"),
    connectionId: connection.id,
    connectionName: connection.name,
    kind: connection.kind,
    query,
    executedAt: new Date().toISOString(),
    status,
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

function makeExplorerGroup(
  label: string,
  groupKind: "database" | "schema" | "category",
  children: DbExplorerNode[],
  description?: string,
  lazy?: boolean,
): DbExplorerNode {
  return {
    id: makeId("db-tree-group"),
    kind: "group",
    groupKind,
    label,
    description,
    children,
    lazy,
  };
}

function makeExplorerLeaf(
  kind: "table" | "view" | "function" | "collection" | "key",
  label: string,
  query: string,
  description?: string,
  countQuery?: string,
  options?: {
    schemaName?: string;
    qualifiedName?: string;
  },
): DbExplorerNode {
  return {
    id: makeId("db-tree-leaf"),
    kind,
    label,
    query,
    description,
    countQuery,
    schemaName: options?.schemaName,
    qualifiedName: options?.qualifiedName,
  };
}

function escapeSqlIdentifier(kind: DbConnectionKind, value: string) {
  switch (kind) {
    case "mysql":
    case "tidb":
    case "clickhouse":
      return `\`${value.replace(/`/g, "``")}\``;
    case "sqlserver":
      return `[${value.replace(/]/g, "]]")}]`;
    default:
      return `"${value.replace(/"/g, '""')}"`;
  }
}

function buildQualifiedSqlName(
  kind: DbConnectionKind,
  schemaName: string,
  objectName: string,
) {
  const quotedObjectName = escapeSqlIdentifier(kind, objectName);
  const normalizedSchemaName = schemaName.trim();

  if (
    !normalizedSchemaName ||
    (kind === "sqlite" && normalizedSchemaName === "main")
  ) {
    return quotedObjectName;
  }

  return `${escapeSqlIdentifier(kind, normalizedSchemaName)}.${quotedObjectName}`;
}

function buildSqlObjectQuery(
  connection: DbConnection,
  schemaName: string,
  objectName: string,
) {
  const qualifiedName = buildQualifiedSqlName(
    connection.kind,
    schemaName,
    objectName,
  );

  switch (connection.kind) {
    case "sqlserver":
      return `SELECT TOP 200 * FROM ${qualifiedName};`;
    case "oracle":
      return `SELECT * FROM ${qualifiedName} FETCH FIRST 200 ROWS ONLY;`;
    default:
      return `SELECT * FROM ${qualifiedName} LIMIT 200;`;
  }
}

function buildSqlCountQuery(
  connection: DbConnection,
  schemaName: string,
  objectName: string,
) {
  return `SELECT COUNT(*) AS total FROM ${buildQualifiedSqlName(
    connection.kind,
    schemaName,
    objectName,
  )};`;
}

function buildSqlFunctionQuery(
  connection: DbConnection,
  schemaName: string,
  functionName: string,
) {
  const qualifiedName = buildQualifiedSqlName(
    connection.kind,
    schemaName,
    functionName,
  );

  switch (connection.kind) {
    case "sqlserver":
      return `-- Replace parameters as needed\nSELECT ${qualifiedName}();`;
    case "oracle":
      return `-- Replace parameters as needed\nSELECT ${qualifiedName}() FROM dual;`;
    default:
      return `-- Replace parameters as needed\nSELECT ${qualifiedName}();`;
  }
}

function normalizeExplorerTableType(value: unknown) {
  const normalized = String(value ?? "").toUpperCase();
  return normalized.includes("VIEW") ? "view" : "table";
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function buildSqlExplorerNodes(
  connection: DbConnection,
  rows: SqlExplorerRow[],
  routineRows: SqlExplorerRoutineRow[] = [],
): DbExplorerNode[] {
  const schemas = new Map<
    string,
    {
      tables: DbExplorerNode[];
      views: DbExplorerNode[];
      functions: DbExplorerNode[];
    }
  >();

  for (const row of rows) {
    const objectName = asString(row.table_name);
    if (!objectName) {
      continue;
    }

    const schemaName =
      asString(row.schema_name) ||
      connection.config.database.trim() ||
      (connection.kind === "sqlite" ? "main" : "default");
    const bucket =
      schemas.get(schemaName) ??
      {
        tables: [],
        views: [],
        functions: [],
      };
    const objectType = normalizeExplorerTableType(row.table_type);
    const leaf = makeExplorerLeaf(
      objectType,
      objectName,
      buildSqlObjectQuery(connection, schemaName, objectName),
      objectType === "view" ? "View" : "Table",
      buildSqlCountQuery(connection, schemaName, objectName),
      {
        schemaName,
        qualifiedName: buildQualifiedSqlName(
          connection.kind,
          schemaName,
          objectName,
        ),
      },
    );

    if (objectType === "view") {
      bucket.views.push(leaf);
    } else {
      bucket.tables.push(leaf);
    }

    schemas.set(schemaName, bucket);
  }

  for (const row of routineRows) {
    const functionName = asString(row.routine_name);
    if (!functionName) {
      continue;
    }

    const schemaName =
      asString(row.schema_name) ||
      connection.config.database.trim() ||
      (connection.kind === "sqlite" ? "main" : "default");
    const bucket =
      schemas.get(schemaName) ??
      {
        tables: [],
        views: [],
        functions: [],
      };

    bucket.functions.push(
      makeExplorerLeaf(
        "function",
        functionName,
        buildSqlFunctionQuery(connection, schemaName, functionName),
        "Function",
        undefined,
        {
          schemaName,
          qualifiedName: buildQualifiedSqlName(
            connection.kind,
            schemaName,
            functionName,
          ),
        },
      ),
    );

    schemas.set(schemaName, bucket);
  }

  const schemaNodes = Array.from(schemas.entries())
    .sort(([schemaA], [schemaB]) => schemaA.localeCompare(schemaB))
    .map(([schemaName, bucket]) => {
      const children: DbExplorerNode[] = [];
      if (bucket.tables.length > 0) {
        children.push(
          makeExplorerGroup(
            "Tables",
            "category",
            bucket.tables.sort((a, b) => a.label.localeCompare(b.label)),
            `${bucket.tables.length} objects`,
          ),
        );
      }
      if (bucket.views.length > 0) {
        children.push(
          makeExplorerGroup(
            "Views",
            "category",
            bucket.views.sort((a, b) => a.label.localeCompare(b.label)),
            `${bucket.views.length} objects`,
          ),
        );
      }
      if (bucket.functions.length > 0) {
        children.push(
          makeExplorerGroup(
            "Functions",
            "category",
            bucket.functions.sort((a, b) => a.label.localeCompare(b.label)),
            `${bucket.functions.length} objects`,
          ),
        );
      }

      return makeExplorerGroup(
        schemaName,
        connection.kind === "mysql" ||
          connection.kind === "tidb" ||
          connection.kind === "clickhouse"
          ? "database"
          : "schema",
        children,
      );
    });

  return schemaNodes;
}

function buildMongoCollectionQuery(collectionName: string) {
  return `db.${collectionName}.find({})`;
}

function buildMongoCollectionCountQuery(collectionName: string) {
  return `db.${collectionName}.aggregate([{ $count: "total" }])`;
}

function quoteRedisArgument(value: string) {
  return /[\s"'`]/u.test(value)
    ? JSON.stringify(value)
    : value;
}

function buildRedisKeyQuery(keyName: string) {
  return `TYPE ${quoteRedisArgument(keyName)}`;
}

function buildSqlExplorerQuery(kind: DbConnectionKind) {
  switch (kind) {
    case "postgresql":
    case "gaussdb":
      return `
        SELECT
          table_schema AS schema_name,
          table_name,
          table_type
        FROM information_schema.tables
        WHERE table_schema NOT IN (
          'pg_catalog', 'information_schema',
          'tiger', 'tiger_data', 'topology',
          'pg_toast', 'pg_temp_1', 'pg_toast_temp_1'
        )
        ORDER BY table_schema, table_type, table_name;
      `;
    case "mysql":
    case "tidb":
      return `
        SELECT
          table_schema AS schema_name,
          table_name,
          table_type
        FROM information_schema.tables
        WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        ORDER BY table_schema, table_type, table_name;
      `;
    case "sqlserver":
      return `
        SELECT
          TABLE_SCHEMA AS schema_name,
          TABLE_NAME AS table_name,
          TABLE_TYPE AS table_type
        FROM INFORMATION_SCHEMA.TABLES
        ORDER BY TABLE_SCHEMA, TABLE_TYPE, TABLE_NAME;
      `;
    case "sqlite":
      return `
        SELECT
          'main' AS schema_name,
          name AS table_name,
          CASE
            WHEN type = 'view' THEN 'VIEW'
            ELSE 'BASE TABLE'
          END AS table_type
        FROM sqlite_master
        WHERE type IN ('table', 'view')
          AND name NOT LIKE 'sqlite_%'
        ORDER BY type, name;
      `;
    case "clickhouse":
      return `
        SELECT
          database AS schema_name,
          name AS table_name,
          if(engine = 'View', 'VIEW', 'BASE TABLE') AS table_type
        FROM system.tables
        WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
        ORDER BY database, table_type, table_name;
      `;
    case "oracle":
      return `
        SELECT USER AS schema_name, table_name, 'BASE TABLE' AS table_type
        FROM user_tables
        UNION ALL
        SELECT USER AS schema_name, view_name AS table_name, 'VIEW' AS table_type
        FROM user_views
        ORDER BY schema_name, table_type, table_name;
      `;
    default:
      return "SELECT 1;";
  }
}

function buildSqlRoutineExplorerQuery(kind: DbConnectionKind) {
  switch (kind) {
    case "postgresql":
    case "gaussdb":
      return `
        SELECT
          routine_schema AS schema_name,
          routine_name
        FROM information_schema.routines
        WHERE routine_type = 'FUNCTION'
          AND routine_schema NOT IN (
            'pg_catalog', 'information_schema',
            'tiger', 'tiger_data', 'topology',
            'pg_toast', 'pg_temp_1', 'pg_toast_temp_1'
          )
        ORDER BY routine_schema, routine_name;
      `;
    case "mysql":
    case "tidb":
      return `
        SELECT
          routine_schema AS schema_name,
          routine_name
        FROM information_schema.routines
        WHERE routine_type = 'FUNCTION'
          AND routine_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        ORDER BY routine_schema, routine_name;
      `;
    case "sqlserver":
      return `
        SELECT
          ROUTINE_SCHEMA AS schema_name,
          ROUTINE_NAME AS routine_name
        FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_TYPE = 'FUNCTION'
        ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME;
      `;
    case "oracle":
      return `
        SELECT USER AS schema_name, OBJECT_NAME AS routine_name
        FROM USER_OBJECTS
        WHERE OBJECT_TYPE = 'FUNCTION'
        ORDER BY OBJECT_NAME;
      `;
    default:
      return null;
  }
}

function buildDbCommandMessage(tab: DbTab, connection: DbConnection): DbSocketCommandMessage {
  if (connection.kind === "redis") {
    const parts = splitRedisCommand(tab.query.trim());
    return {
      id: tab.id,
      type: "redis",
      payload: {
        url: connection.url,
        command: parts[0] ?? "",
        arguments: parts.slice(1),
      },
    };
  }

  if (connection.kind === "mongodb") {
    return {
      id: tab.id,
      type: "mongoShell",
      payload: {
        url: connection.url,
        command: tab.query,
      },
    };
  }

  return {
    id: tab.id,
    type: "sql",
    payload: {
      driver: connection.kind,
      dsn: connection.url,
      query: tab.query,
    },
  };
}

function buildDbTestCommandMessage(connection: DbConnection): DbSocketCommandMessage {
  const commandId = makeId("db-connect");

  if (connection.kind === "redis") {
    return {
      id: commandId,
      type: "redis",
      payload: {
        url: connection.url,
        command: "PING",
        arguments: [],
      },
    };
  }

  if (connection.kind === "mongodb") {
    return {
      id: commandId,
      type: "mongoPing",
      payload: {
        uri: connection.url,
        database: connection.config.database.trim() || "admin",
      },
    };
  }

  return {
    id: commandId,
    type: "sql",
    payload: {
      driver: connection.kind,
      dsn: connection.url,
      query: defaultQueryForKind(connection.kind),
    },
  };
}

async function executeDbSocketCommand(
  message: DbSocketCommandMessage,
  connection: Pick<DbConnection, "kind">,
): Promise<DbResultPayload> {
  const relayUrl = await buildDbRelayUrl();
  if (!relayUrl) {
    throw new Error("未配置 DB Proxy，请先到 Settings → Proxy 填写地址。");
  }

  return new Promise<DbResultPayload>((resolve, reject) => {
    const ws = new WebSocket(relayUrl);
    let settled = false;

    const cleanup = () => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;

      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    };

    ws.onopen = () => {
      ws.send(JSON.stringify(message));
    };

    ws.onmessage = (event) => {
      let response: DbSocketResponse;

      try {
        response = JSON.parse(event.data as string) as DbSocketResponse;
      } catch {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error("Invalid DB relay response."));
        }
        return;
      }

      if (response.type === "error") {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(response.error || "DB relay error"));
        }
        return;
      }

      if (response.id !== message.id) {
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
          data: (response.data ?? {}) as Record<string, unknown>,
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

async function loadSqlExplorer(connection: DbConnection) {
  // For PostgreSQL/GaussDB: list databases first, return lazy groups
  if (connection.kind === "postgresql" || connection.kind === "gaussdb") {
    const listDbResult = await executeDbSocketCommand(
      {
        id: makeId("db-tree"),
        type: "sql",
        payload: {
          driver: connection.kind,
          dsn: connection.url,
          query: "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;",
        },
      },
      connection,
    );

    if (
      listDbResult.kind === "sql" &&
      Array.isArray(listDbResult.data.rows) &&
      listDbResult.data.rows.length > 0
    ) {
      return (listDbResult.data.rows as Array<Record<string, unknown>>)
        .map((row) => asString(row.datname))
        .filter(Boolean)
        .map((dbName) =>
          makeExplorerGroup(dbName, "database", [], undefined, true),
        );
    }
  }

  const result = await executeDbSocketCommand(
    {
      id: makeId("db-tree"),
      type: "sql",
      payload: {
        driver: connection.kind,
        dsn: connection.url,
        query: buildSqlExplorerQuery(connection.kind),
      },
    },
    connection,
  );

  if (result.kind !== "sql") {
    return [] as DbExplorerNode[];
  }

  const routineQuery = buildSqlRoutineExplorerQuery(connection.kind);
  let routineRows: SqlExplorerRoutineRow[] = [];

  if (routineQuery) {
    const routineResult = await executeDbSocketCommand(
      {
        id: makeId("db-tree"),
        type: "sql",
        payload: {
          driver: connection.kind,
          dsn: connection.url,
          query: routineQuery,
        },
      },
      connection,
    );

    if (routineResult.kind === "sql" && Array.isArray(routineResult.data.rows)) {
      routineRows = routineResult.data.rows as SqlExplorerRoutineRow[];
    }
  }

  return buildSqlExplorerNodes(
    connection,
    (result.data.rows ?? []) as SqlExplorerRow[],
    routineRows,
  );
}

async function loadMongoExplorer(connection: DbConnection) {
  const result = await executeDbSocketCommand(
    {
      id: makeId("db-tree"),
      type: "mongoListCollections",
      payload: {
        uri: connection.url,
        database: connection.config.database.trim() || "test",
      },
    },
    connection,
  );

  if (result.kind !== "mongo" || !Array.isArray(result.data.result)) {
    return [] as DbExplorerNode[];
  }

  const collectionNodes = result.data.result
    .map((item) => {
      const name =
        item && typeof item === "object"
          ? asString((item as Record<string, unknown>).name)
          : "";
      if (!name) {
        return null;
      }

      return makeExplorerLeaf(
        "collection",
        name,
        buildMongoCollectionQuery(name),
        "Collection",
        buildMongoCollectionCountQuery(name),
      );
    })
    .filter((node): node is DbExplorerNode => Boolean(node))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    makeExplorerGroup(
      connection.config.database.trim() || "test",
      "database",
      collectionNodes,
      `${collectionNodes.length} collections`,
    ),
  ];
}

async function loadRedisExplorer(connection: DbConnection) {
  const result = await executeDbSocketCommand(
    {
      id: makeId("db-tree"),
      type: "redis",
      payload: {
        url: connection.url,
        command: "KEYS",
        arguments: ["*"],
      },
    },
    connection,
  );

  if (result.kind !== "redis" || !Array.isArray(result.data.result)) {
    return [] as DbExplorerNode[];
  }

  const keys = result.data.result
    .map((item) => asString(item))
    .filter(Boolean)
    .slice(0, 200)
    .map((keyName) =>
      makeExplorerLeaf("key", keyName, buildRedisKeyQuery(keyName), "Key"),
    )
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    makeExplorerGroup("Keys", "category", keys, `${keys.length} loaded`),
  ];
}

export async function loadDbExplorer(connection: DbConnection) {
  const normalizedConnection = {
    ...connection,
    url: buildDbConnectionUrl(connection) || connection.url.trim(),
  };

  if (normalizedConnection.kind === "mongodb") {
    return loadMongoExplorer(normalizedConnection);
  }

  if (normalizedConnection.kind === "redis") {
    return loadRedisExplorer(normalizedConnection);
  }

  return loadSqlExplorer(normalizedConnection);
}

function switchDsnDatabase(
  kind: DbConnectionKind,
  baseDsn: string,
  database: string,
): string {
  if (kind === "postgresql" || kind === "gaussdb") {
    // Keyword DSN format: host=... dbname=old → host=... dbname=new
    if (/dbname\s*=/i.test(baseDsn)) {
      return baseDsn.replace(/dbname\s*=\s*\S*/i, `dbname=${database}`);
    }
    return `${baseDsn} dbname=${database}`;
  }
  return baseDsn;
}

export async function loadDbExplorerDatabaseChildren(
  connection: DbConnection,
  databaseName: string,
): Promise<DbExplorerNode[]> {
  const baseDsn = buildDbConnectionUrl(connection) || connection.url.trim();
  const dsn = switchDsnDatabase(connection.kind, baseDsn, databaseName);

  const result = await executeDbSocketCommand(
    {
      id: makeId("db-tree"),
      type: "sql",
      payload: {
        driver: connection.kind,
        dsn,
        query: buildSqlExplorerQuery(connection.kind),
      },
    },
    connection,
  );

  if (result.kind !== "sql") {
    return [];
  }

  const routineQuery = buildSqlRoutineExplorerQuery(connection.kind);
  let routineRows: SqlExplorerRoutineRow[] = [];

  if (routineQuery) {
    const routineResult = await executeDbSocketCommand(
      {
        id: makeId("db-tree"),
        type: "sql",
        payload: {
          driver: connection.kind,
          dsn,
          query: routineQuery,
        },
      },
      connection,
    );

    if (routineResult.kind === "sql" && Array.isArray(routineResult.data.rows)) {
      routineRows = routineResult.data.rows as SqlExplorerRoutineRow[];
    }
  }

  const modifiedConnection = {
    ...connection,
    config: { ...connection.config, database: databaseName },
  };

  return buildSqlExplorerNodes(
    modifiedConnection,
    (result.data.rows ?? []) as SqlExplorerRow[],
    routineRows,
  );
}

export async function testDbConnection(connection: DbConnection) {
  const normalizedConnection = {
    ...connection,
    url: buildDbConnectionUrl(connection) || connection.url.trim(),
  };
  return executeDbSocketCommand(
    buildDbTestCommandMessage(normalizedConnection),
    normalizedConnection,
  );
}

export async function executeDbTab(
  tab: DbTab,
  connection: DbConnection,
): Promise<DbResultPayload> {
  return executeDbSocketCommand(buildDbCommandMessage(tab, connection), connection);
}
