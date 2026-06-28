import { makeId } from "../../lib/utils";
import {
  loadDbPersistentStateFromDb,
  loadDbTempStateFromDb,
  saveDbPersistentStateToDb,
  saveDbTempStateToDb,
} from "./local-db";
import type {
  DbConnection,
  DbConnectionConfig,
  DbExecutionState,
  DbObjectConstraint,
  DbObjectDetail,
  DbObjectForeignKey,
  DbObjectIndex,
  DbExplorerNode,
  DbConnectionKind,
  DbFavoriteQuery,
  DbQueryHistoryItem,
  DbResultPayload,
  DbSortOrder,
  DbTab,
  DbTabSource,
  DbTabType,
  DbWorkspaceState,
} from "./models";
import { getDbAdapter } from "./adapters";
import {
  sendDbCommand as executeDbSocketCommand,
  type DbSocketCommandMessage,
} from "./lib/db-api";

export { buildDbRelayUrl } from "./lib/db-transport";

type StoredDbConnection = Omit<DbConnection, "config"> & {
  config?: Partial<DbConnectionConfig>;
};

type StoredDbTempState = Omit<DbWorkspaceState, "savedConnections" | "favorites">;

type StoredDbPersistentState = {
  savedConnections?: StoredDbConnection[];
  favorites?: DbFavoriteQuery[];
};

type StoredDbWorkspaceState = StoredDbTempState & StoredDbPersistentState;

type SqlExplorerRow = {
  schema_name?: unknown;
  table_name?: unknown;
  table_type?: unknown;
  SCHEMA_NAME?: unknown;
  TABLE_NAME?: unknown;
  TABLE_TYPE?: unknown;
};

type SqlExplorerRoutineRow = {
  schema_name?: unknown;
  routine_name?: unknown;
  SCHEMA_NAME?: unknown;
  ROUTINE_NAME?: unknown;
};

function defaultQueryForKind(kind: DbConnectionKind) {
  return getDbAdapter(kind).defaultQuery();
}

function defaultConnectionConfig(kind: DbConnectionKind): DbConnectionConfig {
  return getDbAdapter(kind).defaultConnectionConfig();
}

function parseDbConnectionUrl(
  kind: DbConnectionKind,
  raw: string,
): DbConnectionConfig {
  return getDbAdapter(kind).parseConnectionUrl(raw);
}

export function buildDbConnectionUrl(
  connection: Pick<DbConnection, "kind" | "config" | "url">,
) {
  return getDbAdapter(connection.kind).buildConnectionUrl(connection);
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

function normalizeConnection(
  connection:
    | (Omit<Partial<DbConnection>, "config"> & {
        config?: Partial<DbConnectionConfig>;
      })
    | null
    | undefined,
): DbConnection {
  const safeConnection = connection ?? {};
  const kind = safeConnection.kind ?? "postgresql";
  const baseConfig = safeConnection.url?.trim()
    ? parseDbConnectionUrl(kind, safeConnection.url)
    : defaultConnectionConfig(kind);
  const config = normalizeConnectionConfig(
    {
      ...baseConfig,
      ...safeConnection.config,
    },
    kind,
  );
  const fallbackUrl =
    safeConnection.url?.trim() || buildDbConnectionUrl({ kind, config, url: "" });

  return {
    id: safeConnection.id ?? makeId("db-conn"),
    name: safeConnection.name?.trim() || config.host.trim(),
    kind,
    url: fallbackUrl,
    environment: safeConnection.environment ?? "local",
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
    databaseName:
      typeof tab.databaseName === 'string'
        ? tab.databaseName.trim() || null
        : connection?.config.database.trim() || null,
    title: tab.title?.trim() || connection?.name || "Query",
    query: tab.query ?? connection?.defaultQuery ?? "",
    type: normalizeDbTabType(tab.type, connection, tab.source),
    source: normalizeTabSource(tab.source),
  };
}

function defaultDbTabTypeForConnection(connection: DbConnection | undefined): DbTabType {
  return 'query';
}

function normalizeDbTabType(
  type: DbTabType | null | undefined,
  connection: DbConnection | undefined,
  source: Partial<DbTabSource> | null | undefined,
): DbTabType {
  if (
    type === 'query' ||
    type === 'data' ||
    type === 'structure' ||
    type === 'redis' ||
    type === 'mongo' ||
    type === 'raw'
  ) {
    return type;
  }

  if (source?.nodeId && source?.nodeKind && source?.label) {
    if (source.nodeKind === 'table' || source.nodeKind === 'view') {
      return 'data';
    }

    if (source.nodeKind === 'key') {
      return 'redis';
    }

    if (source.nodeKind === 'collection') {
      return 'mongo';
    }
  }

  return defaultDbTabTypeForConnection(connection);
}

function normalizeTabSource(source: Partial<DbTabSource> | null | undefined) {
  if (!source?.nodeId || !source?.nodeKind || !source?.label) {
    return undefined;
  }

  const sort: DbSortOrder | undefined =
    source.sort && typeof source.sort.column === "string" && source.sort.column
      ? {
          column: source.sort.column,
          dir: source.sort.dir === "desc" ? "desc" : "asc",
        }
      : undefined;

  return {
    nodeId: source.nodeId,
    nodeKind: source.nodeKind,
    label: source.label,
    schemaName: source.schemaName,
    qualifiedName: source.qualifiedName,
    page: Number.isFinite(source.page) ? Math.max(1, Number(source.page)) : 1,
    pageSize: Number.isFinite(source.pageSize)
      ? Math.max(1, Number(source.pageSize))
      : 50,
    ...(sort ? { sort } : {}),
  } satisfies DbTabSource;
}

function normalizeWorkspace(
  workspace: StoredDbWorkspaceState | null | undefined,
): DbWorkspaceState {
  const savedConnectionsSource = Array.isArray(workspace?.savedConnections)
    ? workspace.savedConnections
    : [];
  const savedConnections: DbConnection[] =
    savedConnectionsSource.map(normalizeConnection);
  const connectionsById: Map<string, DbConnection> = new Map(
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
  const [storedPersistent, storedTemp] = await Promise.all([
    loadDbPersistentStateFromDb(),
    loadDbTempStateFromDb(),
  ]);
  const stored = {
    ...(storedTemp && typeof storedTemp === 'object' ? storedTemp : {}),
    ...(storedPersistent && typeof storedPersistent === 'object'
      ? storedPersistent
      : {}),
  } as StoredDbWorkspaceState;
  const normalized = normalizeWorkspace(
    stored,
  );

  const serializedPersistent = serializeWorkspaceForStorage(normalized);
  const serializedTemp = serializeDbTempState(normalized);
  if (JSON.stringify(storedPersistent ?? null) !== JSON.stringify(serializedPersistent)) {
    await saveDbPersistentStateToDb(serializedPersistent);
  }
  if (JSON.stringify(storedTemp ?? null) !== JSON.stringify(serializedTemp)) {
    await saveDbTempStateToDb(serializedTemp);
  }

  return normalized;
}

export async function saveDbWorkspace(workspace: DbWorkspaceState): Promise<void> {
  const normalized = normalizeWorkspace(workspace);
  await Promise.all([
    saveDbPersistentStateToDb(serializeWorkspaceForStorage(normalized)),
    saveDbTempStateToDb(serializeDbTempState(normalized)),
  ]);
}

export function createDbConnection(kind: DbConnectionKind): DbConnection {
  const config = defaultConnectionConfig(kind);
  return {
    id: makeId("db-conn"),
    name: ``,
    kind,
    url: buildDbConnectionUrl({ kind, config, url: "" }),
    environment: "local",
    config,
    defaultQuery: defaultQueryForKind(kind),
  };
}

export function createDbTab(
  connection: DbConnection,
  type: DbTabType = defaultDbTabTypeForConnection(connection),
): DbTab {
  return {
    id: makeId("db-tab"),
    connectionId: connection.id,
    databaseName: connection.config.database.trim() || null,
    title: connection.name,
    query: connection.defaultQuery,
    type,
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
  durationMs?: number,
): DbQueryHistoryItem {
  return {
    id: makeId("db-hist"),
    connectionId: connection.id,
    connectionName: connection.name,
    kind: connection.kind,
    query,
    executedAt: new Date().toISOString(),
    status,
    durationMs,
  };
}

function serializeWorkspaceForStorage(
  workspace: DbWorkspaceState,
): StoredDbPersistentState {
  return {
    savedConnections: workspace.savedConnections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      kind: connection.kind,
      url: buildDbConnectionUrl(connection) || connection.url.trim(),
      environment: connection.environment,
      defaultQuery: connection.defaultQuery,
    })),
    favorites: workspace.favorites,
  };
}

function serializeDbTempState(
  workspace: DbWorkspaceState,
): StoredDbTempState {
  return {
    connectedConnectionIds: workspace.connectedConnectionIds,
    activeConnectionId: workspace.activeConnectionId,
    openTabIds: workspace.openTabIds,
    pinnedTabIds: workspace.pinnedTabIds,
    activeTabId: workspace.activeTabId,
    tabsById: workspace.tabsById,
    history: workspace.history,
  };
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
  return getDbAdapter(kind).escapeIdentifier(value);
}

/**
 * Wrap a statement in the connection kind's EXPLAIN form, or null when the kind
 * doesn't offer one (non-SQL adapters, or SQL dialects whose EXPLAIN can't run
 * as a single inline statement — see the adapter overrides).
 */
export function buildExplainSqlQuery(
  connection: DbConnection,
  query: string,
): string | null {
  return getDbAdapter(connection.kind).buildExplainQuery?.(query) ?? null;
}

function buildSqlObjectQuery(
  connection: DbConnection,
  schemaName: string,
  objectName: string,
  page = 1,
  pageSize = 200,
  orderBy?: DbSortOrder,
) {
  return getDbAdapter(connection.kind).buildObjectQuery(
    schemaName,
    objectName,
    page,
    pageSize,
    orderBy,
  );
}

export function buildPagedSqlObjectQuery(
  connection: DbConnection,
  schemaName: string,
  objectName: string,
  page: number,
  pageSize: number,
  orderBy?: DbSortOrder,
) {
  return buildSqlObjectQuery(
    connection,
    schemaName,
    objectName,
    page,
    pageSize,
    orderBy,
  );
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function buildSqlExplorerNodes(
  connection: DbConnection,
  rows: SqlExplorerRow[],
  routineRows: SqlExplorerRoutineRow[] = [],
): DbExplorerNode[] {
  return getDbAdapter(connection.kind).buildExplorerNodes(
    connection,
    rows,
    routineRows,
  );
}

function buildMongoCollectionQuery(collectionName: string) {
  return `db.${collectionName}.find({})`;
}

function buildMongoCollectionCountQuery(collectionName: string) {
  return `db.${collectionName}.aggregate([{ $count: "total" }])`;
}

/** Extract database name from a mongodb:// URL path, if present. */
function mongoDatabaseFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const db = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""))
    return db.trim()
  } catch {
    return ""
  }
}

function buildMongoDatabaseListCommand(): DbSocketCommandMessage {
  return {
    id: makeId("db-tree"),
    type: "mongoListDatabases",
    payload: {
      uri: "",
    },
  };
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
  return getDbAdapter(kind).buildExplorerQuery() ?? "SELECT 1;";
}

function buildSqlRoutineExplorerQuery(kind: DbConnectionKind) {
  return getDbAdapter(kind).buildRoutineExplorerQuery();
}

async function loadSqlExplorerContents(
  connection: DbConnection,
  dsn = connection.url,
) {
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

  return buildSqlExplorerNodes(
    connection,
    (result.data.rows ?? []) as SqlExplorerRow[],
    routineRows,
  );
}

function buildDbCommandMessage(tab: DbTab, connection: DbConnection): DbSocketCommandMessage {
  return getDbAdapter(connection.kind).buildCommandMessage(tab, connection);
}

function buildDbTestCommandMessage(connection: DbConnection): DbSocketCommandMessage {
  return getDbAdapter(connection.kind).buildTestCommandMessage(connection);
}

export async function disconnectDbConnection(connection: DbConnection) {
  const message = getDbAdapter(connection.kind).buildDisconnectMessage(connection);
  await executeDbSocketCommand(message, connection);
}

async function loadSqlExplorer(connection: DbConnection) {
  const listingStrategy = getDbAdapter(connection.kind).databaseListingStrategy();
  // Pg family ("lazy-list"): list databases first, return lazy groups
  if (listingStrategy === "lazy-list") {
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

  // MySQL/TiDB ("explicit-list"): list all databases, filter system schemas
  if (listingStrategy === "explicit-list") {
    const listDbResult = await executeDbSocketCommand(
      {
        id: makeId("db-tree"),
        type: "sql",
        payload: {
          driver: connection.kind,
          dsn: connection.url,
          query: "SHOW DATABASES;",
        },
      },
      connection,
    );

    if (listDbResult.kind === "sql" && Array.isArray(listDbResult.data.rows)) {
      const hiddenDatabases = new Set([
        "information_schema",
        "mysql",
        "performance_schema",
        "sys",
      ]);
      const databases = (listDbResult.data.rows as Array<Record<string, unknown>>)
        .map((row) => asString(row.Database ?? row.database))
        .filter((databaseName) => databaseName && !hiddenDatabases.has(databaseName));

      if (databases.length > 0) {
        return databases.map((databaseName) =>
          makeExplorerGroup(databaseName, "database", [], undefined, true),
        );
      }
    }
  }

  return loadSqlExplorerContents(connection);
}

async function loadMongoCollectionsForDatabase(
  connection: DbConnection,
  databaseName: string,
) {
  const result = await executeDbSocketCommand(
    {
      id: makeId("db-tree"),
      type: "mongoListCollections",
      payload: {
        uri: connection.url,
        database: databaseName,
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
        {
          schemaName: databaseName,
        },
      );
    })
    .filter((node): node is DbExplorerNode => Boolean(node))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    makeExplorerGroup(
      "Collections",
      "category",
      collectionNodes,
      `${collectionNodes.length}`,
    ),
  ];
}

async function loadMongoExplorer(connection: DbConnection) {
  const command = buildMongoDatabaseListCommand();
  command.payload.uri = connection.url;

  const result = await executeDbSocketCommand(command, connection);

  if (result.kind !== "mongo" || !Array.isArray(result.data.result)) {
    return [] as DbExplorerNode[];
  }

  const databaseNodes = result.data.result
    .map((item) => {
      const name =
        item && typeof item === "object"
          ? asString((item as Record<string, unknown>).name)
          : "";
      if (!name) {
        return null;
      }

      return makeExplorerGroup(name, "database", [], undefined, true);
    })
    .filter((node): node is DbExplorerNode => Boolean(node))
    .sort((a, b) => a.label.localeCompare(b.label));

  return databaseNodes;
}

async function loadRedisExplorer(_connection: DbConnection) {
  // Redis defaults to 16 databases (db0–db15). Skip CONFIG GET to avoid
  // hanging when the command times out. Keys are loaded lazily per-database.
  return Array.from({ length: 16 }, (_, index) =>
    makeExplorerGroup(`db${index}`, "database", [], undefined, true),
  );
}

async function loadRedisDatabaseChildren(
  connection: DbConnection,
  databaseName: string,
) {
  const databaseIndex = databaseName.replace(/^db/i, "").trim();
  const scopedConnection = {
    ...connection,
    config: {
      ...connection.config,
      database: databaseIndex,
    },
  };
  const result = await executeDbSocketCommand(
    {
      id: makeId("db-tree"),
      type: "redis",
      payload: {
        url: buildDbConnectionUrl(scopedConnection),
        command: "KEYS",
        arguments: ["*"],
        timeoutMs: 3000,
      },
    },
    scopedConnection,
  );

  if (result.kind !== "redis" || !Array.isArray(result.data.result)) {
    return [] as DbExplorerNode[];
  }

  const keys = result.data.result
    .map((item) => asString(item))
    .filter(Boolean)
    .slice(0, 200)
    .map((keyName) =>
      makeExplorerLeaf("key", keyName, buildRedisKeyQuery(keyName), undefined, undefined, {
        schemaName: databaseName,
      }),
    )
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    makeExplorerGroup("Keys", "category", keys, `${keys.length}`),
  ];
}

/** Default search body used when sampling an Elasticsearch index. */
function buildElasticsearchIndexQuery(): string {
  return '{\n  "query": {\n    "match_all": {}\n  }\n}';
}

/** Build a raw `elasticsearch` wire command against a connection's base address. */
function buildElasticsearchCommand(
  connection: DbConnection,
  action: string,
  extra: Record<string, unknown> = {},
): DbSocketCommandMessage {
  return {
    id: makeId("db-tree"),
    type: "elasticsearch",
    payload: {
      address: buildDbConnectionUrl(connection) || connection.url.trim(),
      username: connection.config.username.trim(),
      password: connection.config.password,
      action,
      ...extra,
    },
  };
}

// Elasticsearch is flat — there is no database nesting, only indices. We list
// them via the `listIndices` action (Cat.Indices) and surface each as a leaf
// (reusing the "collection" leaf kind) under a single "Indices" group, mirroring
// how Redis exposes keys.
async function loadElasticsearchExplorer(connection: DbConnection) {
  const result = await executeDbSocketCommand(
    buildElasticsearchCommand(connection, "listIndices"),
    connection,
  );

  if (result.kind !== "search" || !Array.isArray(result.data.result)) {
    return [] as DbExplorerNode[];
  }

  const indexNodes = result.data.result
    .map((item) => {
      const name =
        item && typeof item === "object"
          ? asString((item as Record<string, unknown>).index)
          : asString(item);
      if (!name || name.startsWith(".")) {
        // Skip system indices (.kibana, .security, …) by default.
        return null;
      }
      return makeExplorerLeaf(
        "collection",
        name,
        buildElasticsearchIndexQuery(),
        "Index",
        undefined,
        { schemaName: name },
      );
    })
    .filter((node): node is DbExplorerNode => Boolean(node))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    makeExplorerGroup("Indices", "category", indexNodes, `${indexNodes.length}`),
  ];
}

/** Build a `bigtable` wire command from a connection's relabelled config slots. */
function buildBigtableCommand(
  connection: DbConnection,
  action: string,
  extra: Record<string, unknown> = {},
): DbSocketCommandMessage {
  return {
    id: makeId("db-tree"),
    type: "bigtable",
    payload: {
      project: connection.config.host.trim(),
      instance: connection.config.database.trim(),
      credentials: connection.config.serviceName,
      endpoint: connection.config.options.trim(),
      action,
      ...extra,
    },
  };
}

// Bigtable is flat — an instance exposes a list of tables, no database nesting.
// We list them via the `listTables` action and surface each as a leaf (reusing
// the "table" leaf kind) under a single "Tables" group, mirroring how ES
// exposes indices.
async function loadBigtableExplorer(connection: DbConnection) {
  const result = await executeDbSocketCommand(
    buildBigtableCommand(connection, "listTables"),
    connection,
  );

  if (result.kind !== "wideColumn" || !result.data.result) {
    return [] as DbExplorerNode[];
  }
  const payload = result.data.result as Record<string, unknown>;
  const tables = Array.isArray(payload.tables) ? payload.tables : [];

  const tableNodes = tables
    .map((item) => {
      const name = asString(item);
      if (!name) return null;
      return makeExplorerLeaf(
        "table",
        name,
        connection.defaultQuery,
        "Table",
        undefined,
        { schemaName: name },
      );
    })
    .filter((node): node is DbExplorerNode => Boolean(node))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    makeExplorerGroup("Tables", "category", tableNodes, `${tableNodes.length}`),
  ];
}

/** Build a `qdrant` wire command from a connection's relabelled config slots. */
function buildQdrantCommand(
  connection: DbConnection,
  action: string,
  extra: Record<string, unknown> = {},
): DbSocketCommandMessage {
  return {
    id: makeId("db-tree"),
    type: "qdrant",
    payload: {
      address: buildDbConnectionUrl(connection) || connection.url.trim(),
      apiKey: connection.config.password,
      action,
      ...extra,
    },
  };
}

// Qdrant is flat — a node exposes a list of collections, no database nesting.
// We list them via the `listCollections` action and surface each as a leaf
// (reusing the "collection" leaf kind) under a single "Collections" group,
// mirroring how ES exposes indices. The runner returns SQL-shaped data (mapped
// to kind "sql"), so the collection list lives at result.data.result.
async function loadQdrantExplorer(connection: DbConnection) {
  const result = await executeDbSocketCommand(
    buildQdrantCommand(connection, "listCollections"),
    connection,
  );

  // qdrant maps to the "sql" result kind; the listCollections payload rides the
  // SQLQueryResponse `result` field as Qdrant's raw {result:{collections:[…]}}.
  if (result.kind !== "sql") {
    return [] as DbExplorerNode[];
  }
  const raw = (result.data as Record<string, unknown>).result;
  const inner =
    raw && typeof raw === "object"
      ? ((raw as Record<string, unknown>).result as Record<string, unknown> | undefined)
      : undefined;
  const collections = inner && Array.isArray(inner.collections) ? inner.collections : [];

  const collectionNodes = collections
    .map((item) => {
      const name =
        item && typeof item === "object"
          ? asString((item as Record<string, unknown>).name)
          : asString(item);
      if (!name) return null;
      return makeExplorerLeaf(
        "collection",
        name,
        connection.defaultQuery,
        "Collection",
        undefined,
        { schemaName: name },
      );
    })
    .filter((node): node is DbExplorerNode => Boolean(node))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    makeExplorerGroup(
      "Collections",
      "category",
      collectionNodes,
      `${collectionNodes.length}`,
    ),
  ];
}

/** Build an `influx` wire command from a connection's relabelled config slots. */
function buildInfluxCommand(
  connection: DbConnection,
  action: string,
  extra: Record<string, unknown> = {},
): DbSocketCommandMessage {
  return {
    id: makeId("db-tree"),
    type: "influx",
    payload: {
      address: buildDbConnectionUrl(connection) || connection.url.trim(),
      org: connection.config.username,
      token: connection.config.password,
      action,
      ...extra,
    },
  };
}

// InfluxDB is flat — an org exposes a list of buckets, no database nesting. We
// list them via the `listBuckets` action and surface each as a leaf (reusing the
// "table" leaf kind) under a single "Buckets" group, mirroring how ES exposes
// indices. The runner returns SQL-shaped data (kind "sql"); the bucket list
// rides the `result` field as Influx's raw {buckets:[…]}.
async function loadInfluxExplorer(connection: DbConnection) {
  const result = await executeDbSocketCommand(
    buildInfluxCommand(connection, "listBuckets"),
    connection,
  );

  if (result.kind !== "sql") {
    return [] as DbExplorerNode[];
  }
  const raw = (result.data as Record<string, unknown>).result;
  const buckets =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).buckets)
      ? ((raw as Record<string, unknown>).buckets as unknown[])
      : [];

  const bucketNodes = buckets
    .map((item) => {
      const name =
        item && typeof item === "object"
          ? asString((item as Record<string, unknown>).name)
          : asString(item);
      // Skip internal system buckets (_monitoring, _tasks).
      if (!name || name.startsWith("_")) return null;
      return makeExplorerLeaf(
        "table",
        name,
        connection.defaultQuery,
        "Bucket",
        undefined,
        { schemaName: name },
      );
    })
    .filter((node): node is DbExplorerNode => Boolean(node))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    makeExplorerGroup("Buckets", "category", bucketNodes, `${bucketNodes.length}`),
  ];
}

/** Build a `weaviate` wire command from a connection's relabelled config slots. */
function buildWeaviateCommand(
  connection: DbConnection,
  action: string,
  extra: Record<string, unknown> = {},
): DbSocketCommandMessage {
  return {
    id: makeId("db-tree"),
    type: "weaviate",
    payload: {
      address: buildDbConnectionUrl(connection) || connection.url.trim(),
      apiKey: connection.config.password,
      action,
      ...extra,
    },
  };
}

// Weaviate is flat — a node exposes a list of classes, no database nesting. We
// list them via the `listClasses` action and surface each as a leaf (reusing the
// "collection" leaf kind) under a single "Classes" group, mirroring how ES
// exposes indices. The runner returns SQL-shaped data (kind "sql"); the class
// list rides the `result` field as Weaviate's raw {classes:[{class:"…"},…]}.
async function loadWeaviateExplorer(connection: DbConnection) {
  const result = await executeDbSocketCommand(
    buildWeaviateCommand(connection, "listClasses"),
    connection,
  );

  if (result.kind !== "sql") {
    return [] as DbExplorerNode[];
  }
  const raw = (result.data as Record<string, unknown>).result;
  const classes =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).classes)
      ? ((raw as Record<string, unknown>).classes as unknown[])
      : [];

  const classNodes = classes
    .map((item) => {
      const name =
        item && typeof item === "object"
          ? asString((item as Record<string, unknown>).class)
          : asString(item);
      if (!name) return null;
      return makeExplorerLeaf(
        "collection",
        name,
        connection.defaultQuery,
        "Class",
        undefined,
        { schemaName: name },
      );
    })
    .filter((node): node is DbExplorerNode => Boolean(node))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    makeExplorerGroup("Classes", "category", classNodes, `${classNodes.length}`),
  ];
}

/** Build a `neo4j` wire command from a connection's relabelled config slots. */
function buildNeo4jCommand(
  connection: DbConnection,
  action: string,
  extra: Record<string, unknown> = {},
): DbSocketCommandMessage {
  return {
    id: makeId("db-tree"),
    type: "neo4j",
    payload: {
      address: buildDbConnectionUrl(connection) || connection.url.trim(),
      username: connection.config.username,
      password: connection.config.password,
      action,
      database: connection.config.database,
      ...extra,
    },
  };
}

// Neo4j is a graph store reached over Bolt; it has no SQL surface. The explorer
// surfaces node labels (via the `listLabels` action) as leaves under a single
// "Node Labels" group, mirroring how ES exposes indices. Selecting a label opens
// a Cypher tab that fetches a sample of those nodes. The runner returns SQL-shaped
// data (kind "sql") — listLabels rides the `rows` field as [{label:"…"}, …].
async function loadNeo4jExplorer(connection: DbConnection) {
  const result = await executeDbSocketCommand(
    buildNeo4jCommand(connection, "listLabels"),
    connection,
  );

  if (result.kind !== "sql") {
    return [] as DbExplorerNode[];
  }
  const rows = (result.data as Record<string, unknown>).rows;
  const labels = Array.isArray(rows) ? (rows as unknown[]) : [];

  const labelNodes = labels
    .map((item) => {
      const name =
        item && typeof item === "object"
          ? asString((item as Record<string, unknown>).label)
          : asString(item);
      if (!name) return null;
      // Each label leaf opens a Cypher sample over that label's nodes.
      const sample = `MATCH (n:\`${name}\`)\nRETURN n\nLIMIT 100`;
      return makeExplorerLeaf("table", name, sample, "Label", undefined, {
        schemaName: name,
      });
    })
    .filter((node): node is DbExplorerNode => Boolean(node))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    makeExplorerGroup(
      "Node Labels",
      "category",
      labelNodes,
      `${labelNodes.length}`,
    ),
  ];
}

/** Build a `cassandra` wire command from a connection's relabelled config slots. */
function buildCassandraCommand(
  connection: DbConnection,
  action: string,
  extra: Record<string, unknown> = {},
): DbSocketCommandMessage {
  return {
    id: makeId("db-tree"),
    type: "cassandra",
    payload: {
      address: buildDbConnectionUrl(connection) || connection.url.trim(),
      username: connection.config.username,
      password: connection.config.password,
      action,
      keyspace: connection.config.database,
      ...extra,
    },
  };
}

// Cassandra speaks CQL over its native binary protocol. The explorer is two-level
// (keyspace → tables): we list keyspaces via `listKeyspaces`, then list each
// non-system keyspace's tables via `listTables`, surfacing one group per keyspace.
// Selecting a table opens a CQL sample. The runner returns SQL-shaped data
// (kind "sql"); both listings ride the `rows` field ([{keyspace_name|table_name}]).
async function loadCassandraExplorer(connection: DbConnection) {
  const keyspaceResult = await executeDbSocketCommand(
    buildCassandraCommand(connection, "listKeyspaces"),
    connection,
  );
  if (keyspaceResult.kind !== "sql") {
    return [] as DbExplorerNode[];
  }
  const keyspaceRows = (keyspaceResult.data as Record<string, unknown>).rows;
  const keyspaces = (Array.isArray(keyspaceRows) ? keyspaceRows : [])
    .map((item) =>
      item && typeof item === "object"
        ? asString((item as Record<string, unknown>).keyspace_name)
        : asString(item),
    )
    // Hide Cassandra's internal keyspaces (system, system_schema, system_auth, …).
    .filter((name) => name && !name.startsWith("system"))
    .sort((a, b) => a.localeCompare(b));

  // Fetch each keyspace's tables in parallel, then build a group per keyspace.
  const groups = await Promise.all(
    keyspaces.map(async (keyspace) => {
      const tableResult = await executeDbSocketCommand(
        buildCassandraCommand(connection, "listTables", { keyspace }),
        connection,
      );
      const tableRows =
        tableResult.kind === "sql"
          ? (tableResult.data as Record<string, unknown>).rows
          : [];
      const tableNodes = (Array.isArray(tableRows) ? tableRows : [])
        .map((item) => {
          const name =
            item && typeof item === "object"
              ? asString((item as Record<string, unknown>).table_name)
              : asString(item);
          if (!name) return null;
          const qualified = `${keyspace}.${name}`;
          const sample = `SELECT * FROM ${qualified} LIMIT 100`;
          return makeExplorerLeaf("table", name, sample, "Table", undefined, {
            schemaName: keyspace,
            qualifiedName: qualified,
          });
        })
        .filter((node): node is DbExplorerNode => Boolean(node))
        .sort((a, b) => a.label.localeCompare(b.label));

      return makeExplorerGroup(
        keyspace,
        "schema",
        tableNodes,
        `${tableNodes.length}`,
      );
    }),
  );

  return groups;
}

/** Build a `milvus` wire command from a connection's relabelled config slots. */
function buildMilvusCommand(
  connection: DbConnection,
  action: string,
  extra: Record<string, unknown> = {},
): DbSocketCommandMessage {
  return {
    id: makeId("db-tree"),
    type: "milvus",
    payload: {
      address: buildDbConnectionUrl(connection) || connection.url.trim(),
      username: connection.config.username,
      password: connection.config.password,
      apiKey: connection.config.options,
      database: connection.config.database,
      action,
      ...extra,
    },
  };
}

// Milvus is a vector database reached over gRPC; it has no SQL surface. The
// explorer is flat: list collections via `listCollections` under a single
// "Collections" group, mirroring how Qdrant exposes collections. Selecting a
// collection opens a query tab with an empty filter (all rows up to the limit).
// The runner returns SQL-shaped data (kind "sql"); listCollections rides the
// `rows` field as [{collection_name:"…"}, …].
async function loadMilvusExplorer(connection: DbConnection) {
  const result = await executeDbSocketCommand(
    buildMilvusCommand(connection, "listCollections"),
    connection,
  );

  if (result.kind !== "sql") {
    return [] as DbExplorerNode[];
  }
  const rows = (result.data as Record<string, unknown>).rows;
  const collections = Array.isArray(rows) ? (rows as unknown[]) : [];

  const collectionNodes = collections
    .map((item) => {
      const name =
        item && typeof item === "object"
          ? asString((item as Record<string, unknown>).collection_name)
          : asString(item);
      if (!name) return null;
      // Each collection leaf opens a query tab; an empty expr fetches all rows
      // (the runner bounds it with a default limit).
      return makeExplorerLeaf("table", name, "", "Collection", undefined, {
        schemaName: name,
      });
    })
    .filter((node): node is DbExplorerNode => Boolean(node))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    makeExplorerGroup(
      "Collections",
      "category",
      collectionNodes,
      `${collectionNodes.length}`,
    ),
  ];
}

export async function loadDbExplorer(connection: DbConnection) {
  const normalizedConnection = {
    ...connection,
    url: buildDbConnectionUrl(connection) || connection.url.trim(),
  };

  let nodes: DbExplorerNode[];

  const adapter = getDbAdapter(normalizedConnection.kind);
  if (adapter.isDocumentStore()) {
    nodes = await loadMongoExplorer(normalizedConnection);
  } else if (adapter.isKeyValueStore()) {
    nodes = await loadRedisExplorer(normalizedConnection);
  } else if (normalizedConnection.kind === "qdrant") {
    // Qdrant is also a search-store but speaks its own REST protocol; it is flat
    // (collections only). Dispatch before the ES-hardcoded isSearchStore branch.
    return loadQdrantExplorer(normalizedConnection);
  } else if (normalizedConnection.kind === "influxdb") {
    // InfluxDB is a time-series store over its own HTTP protocol; flat (buckets).
    return loadInfluxExplorer(normalizedConnection);
  } else if (normalizedConnection.kind === "weaviate") {
    // Weaviate is also a search-store but speaks its own REST protocol; it is
    // flat (classes only). Dispatch before the ES-hardcoded isSearchStore branch.
    return loadWeaviateExplorer(normalizedConnection);
  } else if (normalizedConnection.kind === "neo4j") {
    // Neo4j is a graph store over Bolt; it is flat (node labels only).
    return loadNeo4jExplorer(normalizedConnection);
  } else if (normalizedConnection.kind === "cassandra") {
    // Cassandra speaks CQL; two-level explorer (keyspace → tables) of its own.
    return loadCassandraExplorer(normalizedConnection);
  } else if (normalizedConnection.kind === "milvus") {
    // Milvus is a vector DB over gRPC; flat (collections only). Dispatch before
    // the ES-hardcoded isSearchStore branch (its adapter reports search model).
    return loadMilvusExplorer(normalizedConnection);
  } else if (adapter.isSearchStore()) {
    // ES is flat (indices only) — return the leaf list directly, no DB filter.
    return loadElasticsearchExplorer(normalizedConnection);
  } else if (adapter.isWideColumn()) {
    // Bigtable is flat (tables only) — return the leaf list directly, no DB filter.
    return loadBigtableExplorer(normalizedConnection);
  } else {
    nodes = await loadSqlExplorer(normalizedConnection);
  }

  // If a specific database is configured, filter to show only that database
  const configuredDb = adapter.isDocumentStore()
    ? (normalizedConnection.config.database?.trim() || mongoDatabaseFromUrl(normalizedConnection.url))
    : normalizedConnection.config.database?.trim();

  if (configuredDb && nodes.some((n) => n.kind === "group" && n.groupKind === "database")) {
    // Redis config stores a number (e.g. "0") but node labels are "db0"
    const matchLabel = adapter.isKeyValueStore()
      ? `db${configuredDb.replace(/^db/i, "")}`
      : configuredDb;
    const filtered = nodes.filter((n) => n.label === matchLabel);
    if (filtered.length > 0) return filtered;
    // Configured database not in list — show a single placeholder node
    return [makeExplorerGroup(matchLabel, "database", [], undefined, true)];
  }

  return nodes;
}

function switchDsnDatabase(
  kind: DbConnectionKind,
  baseDsn: string,
  database: string,
): string {
  if (getDbAdapter(kind).usesDsnDatabaseSwitching()) {
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(baseDsn)) {
      try {
        const url = new URL(baseDsn)
        url.pathname = database ? `/${encodeURIComponent(database)}` : "/"
        url.searchParams.delete("dbname")
        return url.toString()
      } catch {
        // Fall through to keyword DSN handling below.
      }
    }

    // Keyword DSN format: host=... dbname=old -> host=... dbname=new
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
  const adapter = getDbAdapter(connection.kind);
  if (adapter.isDocumentStore()) {
    return loadMongoCollectionsForDatabase(connection, databaseName);
  }

  if (adapter.isKeyValueStore()) {
    return loadRedisDatabaseChildren(connection, databaseName);
  }

  const modifiedConnection = {
    ...connection,
    config: { ...connection.config, database: databaseName },
  };
  const dsn =
    adapter.usesDsnDatabaseSwitching()
      ? switchDsnDatabase(
          modifiedConnection.kind,
          buildDbConnectionUrl(connection) || connection.url.trim(),
          databaseName,
        )
      : buildDbConnectionUrl(modifiedConnection);

  const nodes = await loadSqlExplorerContents(
    { ...modifiedConnection, url: dsn },
    dsn,
  );

  if (adapter.databaseListingStrategy() === "explicit-list") {
    const matchingRoot = nodes.find(
      (node) =>
        node.kind === "group" &&
        node.groupKind === "database" &&
        node.label === databaseName,
    );
    if (matchingRoot && matchingRoot.kind === "group") {
      return matchingRoot.children;
    }
  }

  return nodes;
}

export function canCancelDbExecution(state: DbExecutionState | undefined) {
  return state?.status === "running" && Boolean(state.requestId);
}

export function startDbExecution(tab: DbTab, connection: DbConnection) {
  const requestId = makeId("db-run");
  const baseMessage = buildDbCommandMessage(tab, connection);
  const message = {
    ...baseMessage,
    id: requestId,
  };

  return {
    requestId,
    promise: executeDbSocketCommand(message, connection),
  };
}

export async function executeDbAdHocQuery(
  connection: DbConnection,
  query: string,
  type: DbTabType = 'query',
) {
  const tab: DbTab = {
    id: makeId('db-adhoc'),
    connectionId: connection.id,
    title: connection.name,
    query,
    type,
  }

  return executeDbSocketCommand(buildDbCommandMessage(tab, connection), connection)
}

export async function cancelDbExecution(requestId: string) {
  await executeDbSocketCommand(
    {
      id: makeId("db-cancel"),
      type: "dbCancel",
      payload: { requestId },
    },
    // dbCancel is driver-agnostic — it only carries the requestId. The kind
    // here is an inert placeholder for executeDbSocketCommand's signature and
    // never influences cancellation routing.
    { kind: "postgresql" },
  );
}

function toSummaryEntries(
  entries: Array<[string, string | number | boolean | null | undefined]>,
) {
  return entries
    .filter(([, value]) => value !== undefined && value !== null && `${value}`.trim())
    .map(([label, value]) => ({ label, value: String(value) }));
}

function parseSqlColumnsResult(result: DbResultPayload): DbObjectDetail["columns"] {
  if (result.kind !== "sql" || !Array.isArray(result.data.rows)) {
    return [];
  }

  return result.data.rows.map((row) => ({
    name: asString(row.column_name ?? row.name),
    type: asString(row.data_type ?? row.type ?? row.column_type),
    nullable: asString(row.is_nullable).toLowerCase() === "yes",
    defaultValue: asString(row.column_default ?? row.default_value ?? row.default),
    extra: asString(row.extra ?? row.comment),
  }));
}

function parseSqlIndexesResult(
  connection: DbConnection,
  result: DbResultPayload,
): DbObjectIndex[] {
  return getDbAdapter(connection.kind).parseIndexesResult(result);
}

function parseSqlConstraintsResult(
  connection: DbConnection,
  result: DbResultPayload,
): DbObjectConstraint[] {
  return getDbAdapter(connection.kind).parseConstraintsResult(result);
}

function parseSqlForeignKeysResult(
  connection: DbConnection,
  result: DbResultPayload,
): DbObjectForeignKey[] {
  return getDbAdapter(connection.kind).parseForeignKeysResult(result);
}

function buildSqlIndexesQuery(
  connection: DbConnection,
  node: Exclude<DbExplorerNode, { kind: 'group' }>,
) {
  return getDbAdapter(connection.kind).buildIndexesQuery(node);
}

function buildSqlConstraintsQuery(
  connection: DbConnection,
  node: Exclude<DbExplorerNode, { kind: 'group' }>,
) {
  return getDbAdapter(connection.kind).buildConstraintsQuery(node);
}

function buildSqlForeignKeysQuery(
  connection: DbConnection,
  node: Exclude<DbExplorerNode, { kind: 'group' }>,
) {
  return getDbAdapter(connection.kind).buildForeignKeysQuery(node);
}

function buildSqlObjectColumnsQuery(connection: DbConnection, node: DbExplorerNode) {
  return getDbAdapter(connection.kind).buildObjectColumnsQuery(node);
}

function buildSqlPrimaryKeyQuery(connection: DbConnection, node: Exclude<DbExplorerNode, { kind: "group" }>) {
  return getDbAdapter(connection.kind).buildPrimaryKeyQuery(node);
}

export async function loadDbObjectDetail(
  connection: DbConnection,
  node: Exclude<DbExplorerNode, { kind: "group" }>,
): Promise<DbObjectDetail> {
  const adapter = getDbAdapter(connection.kind);
  let summary =
    adapter.isDocumentStore()
      ? toSummaryEntries([
          ["Kind", node.kind],
          ["Database", node.schemaName || connection.config.database],
          ["Collection", node.label],
        ])
      : connection.kind === "qdrant"
        ? toSummaryEntries([
            ["Kind", node.kind],
            ["Collection", node.label],
          ])
      : connection.kind === "influxdb"
        ? toSummaryEntries([
            ["Kind", node.kind],
            ["Bucket", node.label],
          ])
      : connection.kind === "weaviate"
        ? toSummaryEntries([
            ["Kind", node.kind],
            ["Class", node.label],
          ])
      : connection.kind === "neo4j"
        ? toSummaryEntries([
            ["Kind", node.kind],
            ["Label", node.label],
          ])
      : connection.kind === "cassandra"
        ? toSummaryEntries([
            ["Kind", node.kind],
            ["Keyspace", node.schemaName ?? connection.config.database],
            ["Table", node.label],
          ])
      : connection.kind === "milvus"
        ? toSummaryEntries([
            ["Kind", node.kind],
            ["Database", connection.config.database || "default"],
            ["Collection", node.label],
          ])
      : adapter.isSearchStore()
        ? toSummaryEntries([
            ["Kind", node.kind],
            ["Index", node.label],
          ])
        : adapter.isWideColumn()
        ? toSummaryEntries([
            ["Kind", node.kind],
            ["Instance", connection.config.database],
            ["Table", node.label],
          ])
        : adapter.isKeyValueStore()
          ? toSummaryEntries([
              ["Kind", node.kind],
              ["Database", connection.config.database || "0"],
              ["Key", node.label],
            ])
          : toSummaryEntries([
              ["Kind", node.kind],
              ["Schema", node.schemaName ?? "default"],
              ["Name", node.label],
              ["Qualified", node.qualifiedName ?? node.label],
            ]);

  if (!adapter.isRelational()) {
    if (adapter.isKeyValueStore()) {
      const [typeResult, ttlResult] = await Promise.all([
        executeDbAdHocQuery(connection, `TYPE ${JSON.stringify(node.label)}`, 'redis'),
        executeDbAdHocQuery(connection, `TTL ${JSON.stringify(node.label)}`, 'redis'),
      ])

      summary = toSummaryEntries([
        ['Kind', node.kind],
        ['Database', connection.config.database || '0'],
        ['Key', node.label],
        ['Type', asString(typeResult.kind === 'redis' ? typeResult.data.result : '')],
        ['TTL', asString(ttlResult.kind === 'redis' ? ttlResult.data.result : '') || '-1'],
      ])
    }

    const sample = await executeDbSocketCommand(buildDbCommandMessage(
      {
        id: makeId("db-detail"),
        connectionId: connection.id,
        title: node.label,
        query: node.query,
        // ES/Bigtable target the index/table via databaseName; InfluxDB targets
        // the bucket the same way. The leaf label IS the index/table/bucket name.
        databaseName:
          adapter.isSearchStore() ||
          adapter.isWideColumn() ||
          connection.kind === "influxdb"
            ? node.label
            : undefined,
        type: adapter.isDocumentStore()
          ? 'mongo'
          : adapter.isSearchStore() || adapter.isWideColumn()
            ? 'query'
            : 'redis',
      },
      connection,
    ), connection);

    return {
      summary,
      columns: [],
      ddl: node.query,
      sample,
    };
  }

  const columns = parseSqlColumnsResult(
    await executeDbSocketCommand(
      {
        id: makeId("db-detail"),
        type: "sql",
        payload: {
          driver: connection.kind,
          dsn: buildDbConnectionUrl(connection) || connection.url.trim(),
          query: buildSqlObjectColumnsQuery(connection, node),
        },
      },
      connection,
    ),
  );

  let primaryKeys: string[] = [];
  const primaryKeyQuery = buildSqlPrimaryKeyQuery(connection, node);
  if (primaryKeyQuery) {
    const primaryKeyResult = await executeDbSocketCommand(
      {
        id: makeId("db-detail"),
        type: "sql",
        payload: {
          driver: connection.kind,
          dsn: buildDbConnectionUrl(connection) || connection.url.trim(),
          query: primaryKeyQuery,
        },
      },
      connection,
    );

    primaryKeys = getDbAdapter(connection.kind).parsePrimaryKeyResult(
      primaryKeyResult,
    );
  }

  let indexes: DbObjectIndex[] = [];
  const indexesQuery = buildSqlIndexesQuery(connection, node);
  if (indexesQuery) {
    const indexesResult = await executeDbSocketCommand(
      {
        id: makeId('db-detail'),
        type: 'sql',
        payload: {
          driver: connection.kind,
          dsn: buildDbConnectionUrl(connection) || connection.url.trim(),
          query: indexesQuery,
        },
      },
      connection,
    );
    indexes = parseSqlIndexesResult(connection, indexesResult);
  }

  let constraints: DbObjectConstraint[] = [];
  const constraintsQuery = buildSqlConstraintsQuery(connection, node);
  if (constraintsQuery) {
    const constraintsResult = await executeDbSocketCommand(
      {
        id: makeId('db-detail'),
        type: 'sql',
        payload: {
          driver: connection.kind,
          dsn: buildDbConnectionUrl(connection) || connection.url.trim(),
          query: constraintsQuery,
        },
      },
      connection,
    );
    constraints = parseSqlConstraintsResult(connection, constraintsResult);
  }

  let foreignKeys: DbObjectForeignKey[] = [];
  const foreignKeysQuery = buildSqlForeignKeysQuery(connection, node);
  if (foreignKeysQuery) {
    const foreignKeysResult = await executeDbSocketCommand(
      {
        id: makeId('db-detail'),
        type: 'sql',
        payload: {
          driver: connection.kind,
          dsn: buildDbConnectionUrl(connection) || connection.url.trim(),
          query: foreignKeysQuery,
        },
      },
      connection,
    );
    foreignKeys = parseSqlForeignKeysResult(connection, foreignKeysResult);
  }

  const ddlResult = await executeDbSocketCommand(
    {
      id: makeId("db-detail"),
      type: "sql",
      payload: {
        driver: connection.kind,
        dsn: buildDbConnectionUrl(connection) || connection.url.trim(),
        query: buildExplorerShowSqlQueryPlaceholder(connection, node),
      },
    },
    connection,
  );

  const sample = await executeDbSocketCommand(
    {
      id: makeId("db-detail"),
      type: "sql",
      payload: {
        driver: connection.kind,
        dsn: buildDbConnectionUrl(connection) || connection.url.trim(),
        query: node.query,
      },
    },
    connection,
  );

  let ddl = buildExplorerShowSqlQueryPlaceholder(connection, node);
  if (ddlResult.kind === "sql") {
    const firstRow = ddlResult.data.rows?.[0];
    if (firstRow) {
      const firstValue = Object.values(firstRow)[0];
      ddl = typeof firstValue === "string" ? firstValue : JSON.stringify(firstRow, null, 2);
    }
  }

  return {
    summary,
    columns,
    primaryKeys,
    indexes,
    constraints,
    foreignKeys,
    ddl,
    sample,
  };
}

function buildExplorerShowSqlQueryPlaceholder(
  connection: DbConnection,
  node: Exclude<DbExplorerNode, { kind: "group" }>,
) {
  return getDbAdapter(connection.kind).buildDdlQuery(node);
}

// --- ER diagram + schema snapshot (Phase 4) --------------------------------
//
// Both features reuse the existing per-table column / FK queries. The ER model
// is a lightweight projection (just what the SVG renderer needs); the schema
// snapshot reuses the full loadDbObjectDetail() so the diff sees columns,
// indexes and FKs identically to the structure editor.

export type ErColumn = {
  name: string;
  type: string;
  pk: boolean;
  fk: boolean;
};

export type ErTable = {
  /** Display name (the leaf label). */
  name: string;
  schema?: string;
  columns: ErColumn[];
};

export type ErEdge = {
  name: string;
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
};

export type ErModel = {
  tables: ErTable[];
  edges: ErEdge[];
};

/** Run up to `limit` async thunks at a time — bounds concurrent WS queries. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  const pool = Array.from({ length: Math.min(limit, items.length) }, () =>
    runner(),
  );
  await Promise.all(pool);
  return results;
}

/**
 * Build an entity-relationship model for the given table leaf nodes (typically
 * the children of one database/schema group). Reuses the adapter columns + FK
 * queries via the existing WS path. Only relational kinds are supported; the
 * caller gates on adapter.isRelational().
 */
export async function loadErModel(
  connection: DbConnection,
  tables: Array<Exclude<DbExplorerNode, { kind: "group" }>>,
): Promise<ErModel> {
  const dsn = buildDbConnectionUrl(connection) || connection.url.trim();

  const built = await mapWithConcurrency(tables, 6, async (node) => {
    const [columnsResult, primaryKeys, foreignKeysResult] = await Promise.all([
      executeDbSocketCommand(
        {
          id: makeId("db-er"),
          type: "sql",
          payload: {
            driver: connection.kind,
            dsn,
            query: buildSqlObjectColumnsQuery(connection, node),
          },
        },
        connection,
      ),
      (async () => {
        const pkQuery = buildSqlPrimaryKeyQuery(connection, node);
        if (!pkQuery) return [] as string[];
        const pkResult = await executeDbSocketCommand(
          {
            id: makeId("db-er"),
            type: "sql",
            payload: { driver: connection.kind, dsn, query: pkQuery },
          },
          connection,
        );
        return getDbAdapter(connection.kind).parsePrimaryKeyResult(pkResult);
      })(),
      (async () => {
        const fkQuery = buildSqlForeignKeysQuery(connection, node);
        if (!fkQuery) return null;
        return executeDbSocketCommand(
          {
            id: makeId("db-er"),
            type: "sql",
            payload: { driver: connection.kind, dsn, query: fkQuery },
          },
          connection,
        );
      })(),
    ]);

    const columns = parseSqlColumnsResult(columnsResult);
    const foreignKeys = foreignKeysResult
      ? parseSqlForeignKeysResult(connection, foreignKeysResult)
      : [];
    const pkSet = new Set(primaryKeys);
    const fkSet = new Set(foreignKeys.flatMap((fk) => fk.columns));

    const erTable: ErTable = {
      name: node.label,
      schema: node.schemaName,
      columns: columns.map((column) => ({
        name: column.name,
        type: column.type,
        pk: pkSet.has(column.name),
        fk: fkSet.has(column.name),
      })),
    };

    const edges: ErEdge[] = foreignKeys.map((fk) => ({
      name: fk.name,
      fromTable: node.label,
      fromColumns: fk.columns,
      toTable: fk.referencedTable,
      toColumns: fk.referencedColumns,
    }));

    return { erTable, edges };
  });

  // Keep only edges whose target table is part of this model so the renderer
  // never dangles an arrow to a table it isn't drawing.
  const tableNames = new Set(built.map((entry) => entry.erTable.name));
  const edges = built
    .flatMap((entry) => entry.edges)
    .filter((edge) => tableNames.has(edge.toTable));

  return {
    tables: built.map((entry) => entry.erTable),
    edges,
  };
}

/**
 * Load full structure detail for every given table leaf, keyed by table name.
 * Used by the schema-diff view (one snapshot per connection side).
 */
export async function loadSchemaSnapshot(
  connection: DbConnection,
  tables: Array<Exclude<DbExplorerNode, { kind: "group" }>>,
): Promise<Record<string, DbObjectDetail>> {
  const details = await mapWithConcurrency(tables, 4, (node) =>
    loadDbObjectDetail(connection, node),
  );
  const snapshot: Record<string, DbObjectDetail> = {};
  tables.forEach((node, index) => {
    snapshot[node.label] = details[index];
  });
  return snapshot;
}

// --- whole-database export / dump --------------------------------------------
// Real per-table row dump. Enumerates the given table leaves, SELECTs every row
// of each (unbounded SELECT * on the dialect-quoted qualified name — avoids the
// per-dialect LIMIT/OFFSET paging quirks), and serializes to SQL INSERTs / CSV /
// JSON honoring the modal options. DDL (DROP/CREATE) is pulled from the adapter's
// buildDdlQuery so CREATE statements are the database's own, not a template.

export type DatabaseExportFormat = "sql" | "csv" | "json";

export type DatabaseExportOptions = {
  includeDrop: boolean;
  includeCreate: boolean;
  bulkInsert: boolean;
  format: DatabaseExportFormat;
};

/** A single SQL literal for a JS value, dialect-agnostic but broadly safe. */
function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) {
    return `'${value.toISOString().slice(0, 19).replace("T", " ")}'`;
  }
  // Buffers / typed arrays arrive over the wire as { type:"Buffer", data:[…] }
  // or arrays of bytes — encode as a hex blob literal that most engines accept.
  if (Array.isArray(value)) {
    return `'${escapeSqlStringLiteral(JSON.stringify(value))}'`;
  }
  if (typeof value === "object") {
    const maybeBuffer = value as { type?: string; data?: unknown };
    if (maybeBuffer.type === "Buffer" && Array.isArray(maybeBuffer.data)) {
      const hex = (maybeBuffer.data as number[])
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return `X'${hex}'`;
    }
    return `'${escapeSqlStringLiteral(JSON.stringify(value))}'`;
  }
  return `'${escapeSqlStringLiteral(String(value))}'`;
}

/** Standard SQL single-quote doubling (works for every dialect we target). */
function escapeSqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Render one CSV field with RFC-4180 quoting. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "object") {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Fetch every row of one table via an unbounded SELECT on its qualified name. */
async function fetchAllRows(
  connection: DbConnection,
  dsn: string,
  node: Exclude<DbExplorerNode, { kind: "group" }>,
): Promise<{ columns: string[]; rows: Array<Record<string, unknown>> }> {
  const target =
    node.qualifiedName ??
    getDbAdapter(connection.kind).buildQualifiedName(
      node.schemaName ?? "",
      node.label,
    );
  const result = await executeDbSocketCommand(
    {
      id: makeId("db-export"),
      type: "sql",
      payload: { driver: connection.kind, dsn, query: `SELECT * FROM ${target};` },
    },
    connection,
  );
  if (result.kind !== "sql") {
    return { columns: [], rows: [] };
  }
  const rows = Array.isArray(result.data.rows) ? result.data.rows : [];
  const columns =
    result.data.columns && result.data.columns.length > 0
      ? result.data.columns
      : rows.length > 0
        ? Object.keys(rows[0])
        : [];
  return { columns, rows };
}

/** Fetch the database's own CREATE DDL for a table, or null when unavailable. */
async function fetchTableDdl(
  connection: DbConnection,
  dsn: string,
  node: Exclude<DbExplorerNode, { kind: "group" }>,
): Promise<string | null> {
  const ddlQuery = getDbAdapter(connection.kind).buildDdlQuery(node);
  if (!ddlQuery) return null;
  try {
    const result = await executeDbSocketCommand(
      { id: makeId("db-export"), type: "sql", payload: { driver: connection.kind, dsn, query: ddlQuery } },
      connection,
    );
    if (result.kind !== "sql" || !Array.isArray(result.data.rows) || result.data.rows.length === 0) {
      return null;
    }
    // DDL queries return a single row; the statement is the last/only string column.
    const row = result.data.rows[0];
    const values = Object.values(row).filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    return values.length > 0 ? values[values.length - 1] : null;
  } catch {
    return null;
  }
}

function serializeTableSql(
  connection: DbConnection,
  node: Exclude<DbExplorerNode, { kind: "group" }>,
  columns: string[],
  rows: Array<Record<string, unknown>>,
  ddl: string | null,
  options: DatabaseExportOptions,
): string {
  const adapter = getDbAdapter(connection.kind);
  const target =
    node.qualifiedName ??
    adapter.buildQualifiedName(node.schemaName ?? "", node.label);
  const lines: string[] = [];
  lines.push(`-- ----------------------------`);
  lines.push(`-- Table: ${node.label}`);
  lines.push(`-- ----------------------------`);
  if (options.includeDrop) {
    lines.push(`DROP TABLE IF EXISTS ${target};`);
  }
  if (options.includeCreate && ddl) {
    lines.push(ddl.trim().endsWith(";") ? ddl.trim() : `${ddl.trim()};`);
  }
  if (rows.length > 0 && columns.length > 0) {
    const columnList = columns
      .map((column) => adapter.escapeIdentifier(column))
      .join(", ");
    const tuples = rows.map(
      (row) => `(${columns.map((column) => sqlLiteral(row[column])).join(", ")})`,
    );
    if (options.bulkInsert) {
      lines.push(
        `INSERT INTO ${target} (${columnList}) VALUES\n${tuples.join(",\n")};`,
      );
    } else {
      for (const tuple of tuples) {
        lines.push(`INSERT INTO ${target} (${columnList}) VALUES ${tuple};`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Build a real database dump for the given table leaves. Returns the serialized
 * text plus a suggested filename extension. SQL → one combined script; CSV/JSON
 * → one combined document keyed by table (CSV uses a blank line + header per
 * table since CSV has no native multi-table container).
 */
export async function exportDatabaseDump(
  connection: DbConnection,
  databaseName: string,
  tables: Array<Exclude<DbExplorerNode, { kind: "group" }>>,
  options: DatabaseExportOptions,
): Promise<string> {
  let dsn = buildDbConnectionUrl(connection) || connection.url.trim();
  if (databaseName) {
    dsn = switchDsnDatabase(connection.kind, dsn, databaseName);
  }

  const dumped = await mapWithConcurrency(tables, 4, async (node) => {
    const { columns, rows } = await fetchAllRows(connection, dsn, node);
    let ddl: string | null = null;
    if (options.format === "sql" && options.includeCreate) {
      ddl = await fetchTableDdl(connection, dsn, node);
    }
    return { node, columns, rows, ddl };
  });

  if (options.format === "json") {
    const payload: Record<string, Array<Record<string, unknown>>> = {};
    for (const entry of dumped) {
      payload[entry.node.label] = entry.rows;
    }
    return JSON.stringify({ database: databaseName, tables: payload }, null, 2);
  }

  if (options.format === "csv") {
    const blocks = dumped.map((entry) => {
      const header = entry.columns.map((column) => csvField(column)).join(",");
      const body = entry.rows
        .map((row) =>
          entry.columns.map((column) => csvField(row[column])).join(","),
        )
        .join("\n");
      return `# ${entry.node.label}\n${header}${body ? `\n${body}` : ""}`;
    });
    return blocks.join("\n\n");
  }

  // SQL
  const header = [
    `-- Database dump: ${databaseName}`,
    `-- Connection: ${connection.name} (${connection.kind})`,
    `-- Tables: ${dumped.length}`,
    "",
  ];
  const body = dumped.map((entry) =>
    serializeTableSql(
      connection,
      entry.node,
      entry.columns,
      entry.rows,
      entry.ddl,
      options,
    ),
  );
  return [...header, ...body].join("\n\n");
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

/**
 * Load table→columns mapping for SQL autocompletion.
 * Returns a nested object: { schema: { table: [col1, col2, ...] } }
 * or flat { table: [col1, col2, ...] } for single-schema DBs like SQLite.
 */
export async function loadSchemaCompletionData(
  connection: DbConnection,
  databaseName?: string | null,
): Promise<Record<string, Record<string, string[]> | string[]>> {
  const query = buildAllColumnsQuery(connection.kind);
  if (!query) {
    // SQLite uses a flat schema shape (not a boolean capability) — kept as an
    // explicit kind check per Phase C1's scope decision.
    if (connection.kind === "sqlite") {
      return loadSqliteSchemaCompletion(connection);
    }
    return {};
  }

  let dsn = buildDbConnectionUrl(connection) || connection.url.trim();
  if (databaseName) {
    dsn = switchDsnDatabase(connection.kind, dsn, databaseName);
  }

  try {
    const result = await executeDbSocketCommand(
      {
        id: makeId("db-completion"),
        type: "sql",
        payload: { driver: connection.kind, dsn, query },
      },
      connection,
    );

    if (result.kind !== "sql" || !Array.isArray(result.data.rows)) {
      return {};
    }

    // SQLite: flat { table: [col1, col2] } — flat-schema shape, kept as an
    // explicit kind check per Phase C1's scope decision.
    if (connection.kind === "sqlite") {
      const tables: Record<string, string[]> = {};
      for (const row of result.data.rows) {
        const table = asString(row.table_name);
        const column = asString(row.column_name ?? row.name);
        if (table && column) {
          (tables[table] ??= []).push(column);
        }
      }
      return tables;
    }

    // Other DBs: { schema: { table: [col1, col2] } }
    const schemas: Record<string, Record<string, string[]>> = {};
    for (const row of result.data.rows) {
      const schema = asString(row.table_schema ?? row.schema_name);
      const table = asString(row.table_name);
      const column = asString(row.column_name);
      if (schema && table && column) {
        const s = (schemas[schema] ??= {});
        (s[table] ??= []).push(column);
      }
    }

    // Flatten default schema's tables into the top level so that typing
    // a table name directly (e.g. "users") suggests it without needing
    // the "schema." prefix.  This is needed because some schema names
    // (like "public" in PostgreSQL) are SQL keywords and CodeMirror's
    // parser tokenizes them as Keyword nodes — which breaks the
    // dotted-identifier resolution (public.table → top-level fallback).
    const defaultSchema = getDefaultCompletionSchema(connection, databaseName);
    if (defaultSchema && schemas[defaultSchema]) {
      const merged: Record<string, Record<string, string[]> | string[]> = {};
      // Copy all schemas nested
      for (const [schemaName, tables] of Object.entries(schemas)) {
        merged[schemaName] = tables;
      }
      // Merge default schema's tables to top level
      for (const [tableName, columns] of Object.entries(schemas[defaultSchema])) {
        merged[tableName] = columns;
      }
      return merged;
    }

    return schemas;
  } catch {
    return {};
  }
}

function getDefaultCompletionSchema(
  connection: DbConnection,
  databaseName?: string | null,
): string | null {
  return getDbAdapter(connection.kind).defaultCompletionSchema(
    connection,
    databaseName,
  );
}

function buildAllColumnsQuery(kind: DbConnectionKind): string | null {
  return getDbAdapter(kind).buildAllColumnsQuery();
}

async function loadSqliteSchemaCompletion(
  connection: DbConnection,
): Promise<Record<string, string[]>> {
  const dsn = buildDbConnectionUrl(connection) || connection.url.trim();
  try {
    // Get all table names first
    const tablesResult = await executeDbSocketCommand(
      {
        id: makeId("db-completion"),
        type: "sql",
        payload: {
          driver: "sqlite",
          dsn,
          query: `SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%';`,
        },
      },
      connection,
    );

    if (tablesResult.kind !== "sql" || !Array.isArray(tablesResult.data.rows)) {
      return {};
    }

    const tables: Record<string, string[]> = {};
    const tableNames = tablesResult.data.rows
      .map((row) => asString(row.name))
      .filter(Boolean);

    // Fetch columns for each table via PRAGMA
    await Promise.all(
      tableNames.map(async (tableName) => {
        try {
          const colResult = await executeDbSocketCommand(
            {
              id: makeId("db-completion"),
              type: "sql",
              payload: {
                driver: "sqlite",
                dsn,
                query: `PRAGMA table_info(${escapeSqlIdentifier("sqlite", tableName)});`,
              },
            },
            connection,
          );
          if (colResult.kind === "sql" && Array.isArray(colResult.data.rows)) {
            tables[tableName] = colResult.data.rows
              .map((row) => asString(row.name))
              .filter(Boolean);
          }
        } catch {
          // skip this table
        }
      }),
    );

    return tables;
  } catch {
    return {};
  }
}
