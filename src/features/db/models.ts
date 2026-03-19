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

export type DbFolder = {
  id: string;
  name: string;
};

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
  config: DbConnectionConfig;
  folderId: string | null;
  defaultQuery: string;
};

export type DbTab = {
  id: string;
  connectionId: string;
  title: string;
  query: string;
};

export type DbFavoriteQuery = {
  id: string;
  connectionId: string;
  name: string;
  query: string;
  createdAt: string;
};

export type DbQueryHistoryItem = {
  id: string;
  connectionId: string;
  connectionName: string;
  kind: DbConnectionKind;
  query: string;
  createdAt: string;
  status: "success" | "error";
};

export type DbWorkspaceState = {
  folders: DbFolder[];
  connections: DbConnection[];
  openTabIds: string[];
  pinnedTabIds: string[];
  activeTabId: string | null;
  tabsById: Record<string, DbTab>;
  favorites: DbFavoriteQuery[];
  history: DbQueryHistoryItem[];
};

export type DbExecutionState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; durationMs?: number }
  | { status: "error"; message: string };

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
