export type DbConnectionKind =
  | "redis"
  | "postgresql"
  | "mysql"
  | "mongodb"
  | "clickhouse"
  | "gaussdb"
  | "oracle"
  | "sqlite"
  | "sqlserver"
  | "tidb";

export type DbConnectionConfig = {
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
  filePath: string;
  authSource: string;
  serviceName: string;
  options: string;
};

export type DbConnection = {
  id: string;
  name: string;
  kind: DbConnectionKind;
  url: string;
  environment: 'local' | 'dev' | 'staging' | 'prod';
  config: DbConnectionConfig;
  defaultQuery: string;
};

export type DbTabSource = {
  nodeId: string;
  nodeKind: DbExplorerLeafKind;
  label: string;
  schemaName?: string;
  qualifiedName?: string;
  page: number;
  pageSize: number;
};

export type DbTabType = 'query' | 'data' | 'structure' | 'redis' | 'mongo' | 'raw';

export type DbTab = {
  id: string;
  connectionId: string;
  databaseName?: string | null;
  title: string;
  query: string;
  type: DbTabType;
  source?: DbTabSource;
  transactionSessionId?: string | null;
};

export type DbFavoriteQuery = {
  id: string;
  connectionId: string;
  name: string;
  query: string;
};

export type DbQueryHistoryItem = {
  id: string;
  connectionId: string;
  connectionName: string;
  kind: DbConnectionKind;
  query: string;
  executedAt: string;
  status: "success" | "error";
  durationMs?: number;
};

export type DbWorkspaceState = {
  savedConnections: DbConnection[];
  connectedConnectionIds: string[];
  activeConnectionId: string | null;
  openTabIds: string[];
  pinnedTabIds: string[];
  activeTabId: string | null;
  tabsById: Record<string, DbTab>;
  favorites: DbFavoriteQuery[];
  history: DbQueryHistoryItem[];
};

export type DbExecutionState =
  | { status: "idle" }
  | { status: "running"; requestId?: string; startedAt?: string }
  | { status: "success"; durationMs?: number }
  | { status: "error"; message: string };

export type DbExplorerGroupKind = "database" | "schema" | "category" | "server";
export type DbExplorerLeafKind =
  | "table"
  | "view"
  | "function"
  | "collection"
  | "key";

export type DbExplorerNode =
  | {
      id: string;
      kind: "group";
      groupKind: DbExplorerGroupKind;
      label: string;
      description?: string;
      children: DbExplorerNode[];
      lazy?: boolean;
    }
  | {
      id: string;
      kind: DbExplorerLeafKind;
      label: string;
      description?: string;
      query: string;
      countQuery?: string;
      schemaName?: string;
      qualifiedName?: string;
    };

export type DbResultPayload =
  | {
      kind: "sql";
      data: {
        columns?: string[];
        rows?: Array<Record<string, unknown>>;
        affectedRows?: number;
        lastInsertId?: number;
        durationMs?: number;
      };
    }
  | {
      kind: "redis";
      data: {
        result: unknown;
        durationMs?: number;
      };
    }
  | {
      kind: "mongo";
      data: {
        result: unknown;
        durationMs?: number;
      };
    };

export type DbObjectColumn = {
  name: string;
  type: string;
  nullable?: boolean;
  defaultValue?: string;
  extra?: string;
};

export type DbObjectIndex = {
  name: string;
  columns: string[];
  unique?: boolean;
  primary?: boolean;
};

export type DbObjectConstraint = {
  name: string;
  type: string;
  definition?: string;
};

export type DbObjectForeignKey = {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
};

export type DbObjectDetail = {
  summary: Array<{ label: string; value: string }>;
  columns: DbObjectColumn[];
  primaryKeys?: string[];
  indexes?: DbObjectIndex[];
  constraints?: DbObjectConstraint[];
  foreignKeys?: DbObjectForeignKey[];
  ddl?: string;
  sample?: DbResultPayload | null;
};
