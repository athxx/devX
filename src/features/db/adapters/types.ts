// The unified adapter interface. Each of the 10 DB/cache kinds implements
// DbAdapter; service.ts and the UI components look one up via getDbAdapter(kind)
// and delegate every kind-specific decision to it, eliminating the scattered
// `switch (connection.kind)` blocks.
//
// Adapters are PURE: they build connection URLs, default values, SQL query
// strings, command/test/disconnect message objects, parse kind-specific result
// shapes, and expose UI/editor metadata. They perform no I/O — the websocket
// transport and multi-step load orchestration stay in service.ts.

import type {
  DbConnection,
  DbConnectionConfig,
  DbConnectionKind,
  DbExplorerNode,
  DbObjectConstraint,
  DbObjectForeignKey,
  DbObjectIndex,
  DbResultPayload,
  DbSortOrder,
  DbTab,
  DbTabType,
} from "../models";
import type {
  DbSocketCommandMessage,
  SqlExplorerRow,
  SqlExplorerRoutineRow,
} from "./transport-types";

/** A leaf explorer node (table/view/function/collection/key) — never a group. */
export type DbExplorerLeafNode = Exclude<DbExplorerNode, { kind: "group" }>;

/** Short badge shown next to a connection in the UI (label + theme class). */
export interface DbConnectionBadge {
  label: string;
  class: string;
}

/**
 * How a kind's queries are formatted.
 * - sql-formatter dialect strings drive `sql-formatter`.
 * - "javascript" routes through prettier (Mongo shell).
 * - null means the kind has no formatter (Redis).
 */
export type DbFormatLanguage =
  | "sql"
  | "mysql"
  | "postgresql"
  | "sqlite"
  | "transactsql"
  | "plsql"
  | "javascript"
  | null;

/**
 * Which keyword set the editor completes against. Neutral tokens that the UI
 * layer maps to its CodeMirror sources — keeps adapters free of editor deps.
 */
export type DbCompletionKeywords = "sql" | "redis" | "mongo";

/**
 * CodeMirror SQL dialect selector (neutral token). `null` for non-SQL kinds
 * (redis/mongo) that have no schema-aware SQL completion.
 */
export type DbCompletionDialect =
  | "postgresql"
  | "mysql"
  | "mssql"
  | "sqlite"
  | "standard"
  | null;

/**
 * Storage paradigm of a kind. Replaces the scattered
 * `connection.kind === "mongodb" / "redis"` data-model checks in service.ts.
 */
export type DbDataModel =
  | "relational"
  | "document"
  | "keyValue"
  | "search"
  | "wideColumn";

/**
 * How a connection's databases are listed in the explorer root. Replaces the
 * `kind === "postgresql" || "gaussdb"` / `kind === "mysql" || "tidb"` branches.
 * - "lazy-list": query the server for databases, expand children lazily (Pg family).
 * - "explicit-list": list databases up front, filter system schemas (MySQL/TiDB).
 * - "fixed-set": a fixed set of databases the server always has (Redis db0–db15).
 * - "single": no database enumeration — list objects under the current DSN.
 *
 * Document stores (Mongo) have their own loader, keyed off `dataModel`, and do
 * not consult this value.
 */
export type DbDatabaseListingStrategy =
  | "lazy-list"
  | "explicit-list"
  | "fixed-set"
  | "single";

export interface DbAdapter {
  readonly kind: DbConnectionKind;

  // --- Defaults / connection config -------------------------------------
  defaultQuery(): string;
  defaultPort(): string;
  defaultDatabase(): string;
  defaultConnectionConfig(): DbConnectionConfig;
  /** Default tab type opened for a fresh connection of this kind. */
  defaultTabType(): DbTabType;

  // --- Connection URL / DSN ---------------------------------------------
  buildConnectionUrl(connection: Pick<DbConnection, "kind" | "config" | "url">): string;
  parseConnectionUrl(raw: string): DbConnectionConfig;
  /** Re-point an existing DSN at a different database (PG keyword/url forms). */
  switchDsnDatabase(baseDsn: string, database: string): string;

  // --- Identifier / string escaping -------------------------------------
  escapeIdentifier(value: string): string;
  buildQualifiedName(schemaName: string, objectName: string): string;

  // --- Wire messages -----------------------------------------------------
  buildCommandMessage(tab: DbTab, connection: DbConnection): DbSocketCommandMessage;
  buildTestCommandMessage(connection: DbConnection): DbSocketCommandMessage;
  buildDisconnectMessage(connection: DbConnection): DbSocketCommandMessage;

  // --- Explorer (object tree) -------------------------------------------
  /** Top-level listing query (tables/views). Null when not SQL-driven. */
  buildExplorerQuery(): string | null;
  /** Routine (function) listing query. Null when unsupported. */
  buildRoutineExplorerQuery(): string | null;
  /** Build explorer nodes from raw SQL rows. */
  buildExplorerNodes(
    connection: DbConnection,
    rows: SqlExplorerRow[],
    routineRows?: SqlExplorerRoutineRow[],
  ): DbExplorerNode[];

  // --- Object queries ----------------------------------------------------
  buildObjectQuery(
    schemaName: string,
    objectName: string,
    page?: number,
    pageSize?: number,
    orderBy?: DbSortOrder,
  ): string;
  buildCountQuery(schemaName: string, objectName: string): string;
  buildFunctionQuery(schemaName: string, functionName: string): string;
  buildObjectColumnsQuery(node: DbExplorerNode): string;
  buildPrimaryKeyQuery(node: DbExplorerLeafNode): string | null;
  buildIndexesQuery(node: DbExplorerLeafNode): string | null;
  buildConstraintsQuery(node: DbExplorerLeafNode): string | null;
  buildForeignKeysQuery(node: DbExplorerLeafNode): string | null;
  buildDdlQuery(node: DbExplorerLeafNode): string;

  // --- Result parsing (kind-specific shapes) ----------------------------
  /** Primary-key column names from a primary-key query result. */
  parsePrimaryKeyResult(result: DbResultPayload): string[];
  parseIndexesResult(result: DbResultPayload): DbObjectIndex[];
  parseConstraintsResult(result: DbResultPayload): DbObjectConstraint[];
  parseForeignKeysResult(result: DbResultPayload): DbObjectForeignKey[];

  // --- Schema completion -------------------------------------------------
  /** Query returning (schema, table, column) triples for completion. */
  buildAllColumnsQuery(): string | null;
  /** Default schema flattened into completion top-level. */
  defaultCompletionSchema(connection: DbConnection, databaseName?: string | null): string | null;

  // --- Editor / formatting metadata -------------------------------------
  /** Formatter language for this kind (null = not formattable, e.g. Redis). */
  formatLanguage(): DbFormatLanguage;
  /** Keyword completion set the editor should offer. */
  completionKeywords(): DbCompletionKeywords;
  /** CodeMirror SQL dialect (null for non-SQL kinds). */
  completionDialect(): DbCompletionDialect;
  /** Identifier quote char used when auto-quoting completions. */
  identifierQuoteChar(): string;

  // --- UI metadata -------------------------------------------------------
  /** Short badge (label + theme class) shown beside the connection. */
  badge(): DbConnectionBadge;
  /** Human-readable type name, e.g. "PostgreSQL", "SQL Server". */
  displayName(): string;
  /** One-line connection descriptor (host:port / db, file path, …). */
  describeConnection(connection: DbConnection): string;

  // --- Capabilities ------------------------------------------------------
  /** Storage paradigm — single source for the data-model predicates below. */
  dataModel(): DbDataModel;
  /** Convenience predicates derived from `dataModel()` (default in base). */
  isRelational(): boolean;
  isDocumentStore(): boolean;
  isKeyValueStore(): boolean;
  /** Search/index store (Elasticsearch family) — its own explorer + wire path. */
  isSearchStore(): boolean;
  /** Wide-column store (Bigtable family) — its own explorer + gRPC wire path. */
  isWideColumn(): boolean;
  /** How the explorer enumerates databases for this kind. */
  databaseListingStrategy(): DbDatabaseListingStrategy;
  /**
   * Whether switching the active database requires re-pointing the DSN
   * (Pg-family `dbname`/path) via `switchDsnDatabase()`. False kinds reconnect
   * with a freshly built connection URL instead.
   */
  usesDsnDatabaseSwitching(): boolean;
  /** Whether a "create database" action is offered for this kind. */
  canCreateDatabase(): boolean;
  /** Whether a "connection summary" query is offered for this kind. */
  canShowConnectionSummary(): boolean;
  /**
   * Whether an explorer "schema" node actually denotes a database (mongo,
   * redis, mysql/tidb, clickhouse) vs a true schema under one database.
   */
  treatsSchemaAsDatabase(): boolean;

  // --- Explorer action SQL (templates emitted into editor tabs) ---------
  /** Column/structure inspection query for a leaf object. */
  buildStructureQuery(node: DbExplorerLeafNode): string;
  /** DDL ("show create") helper query/template for a leaf object. */
  buildShowSqlQuery(node: DbExplorerLeafNode): string;
  /** Rename-table template. */
  buildRenameQuery(node: DbExplorerLeafNode): string;
  /** Truncate-table template. */
  buildTruncateQuery(node: DbExplorerLeafNode): string;

  // --- Query analysis ----------------------------------------------------
  /**
   * Wrap a statement in the kind's EXPLAIN form for plan inspection. Optional:
   * implemented by SQL adapters (via the base), absent for non-SQL kinds
   * (Mongo/Redis/ES/Bigtable) so the Explain UI is simply not offered there.
   * Returns null when the kind cannot explain the given statement.
   */
  buildExplainQuery?(query: string): string | null;

  // --- Database-level templates ------------------------------------------
  buildCreateDatabaseTemplate(): string;
  buildCreateTableTemplate(databaseName: string): string;
  buildImportTemplate(databaseName: string, source: "sql" | "json" | "csv"): string;
  buildDropDatabaseTemplate(databaseName: string): string;
  /** Server/connection settings overview query. */
  buildConnectionSummaryQuery(): string;
}
