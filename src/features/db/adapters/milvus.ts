import type {
  DbConnection,
  DbConnectionConfig,
  DbExplorerNode,
  DbObjectConstraint,
  DbObjectForeignKey,
  DbObjectIndex,
  DbTab,
  DbTabType,
} from "../models";
import type { DbSocketCommandMessage } from "./transport-types";
import type {
  DbAdapter,
  DbCompletionDialect,
  DbCompletionKeywords,
  DbConnectionBadge,
  DbDatabaseListingStrategy,
  DbDataModel,
  DbExplorerLeafNode,
  DbFormatLanguage,
} from "./types";
import { makeId } from "../../../lib/utils";

// Milvus is a vector database reached over its native gRPC protocol via the
// official pure-Go SDK (see server/internal/db/milvus.go) — a "search"
// data-model kind alongside Qdrant/Elasticsearch. It has no SQL surface and no
// GORM dialector; collections play the role of tables, and a Query's ResultSet
// (column-major typed columns) is transposed to tabular {columns, rows} by the
// runner so it renders in the normal grid (the `milvus` connection kind maps to
// the "sql" result kind in db-transport.ts).
//
// Unlike Qdrant/Elasticsearch, isSearchStore() is FALSE here: isSearchStore is
// hardcoded to the Elasticsearch explorer path in service.ts, so Milvus instead
// gets its own `kind === "milvus"` dispatch branch (mirroring Cassadra/Neo4j).
//
// Auth: config.host[:port] is the gRPC address (host:port, no scheme);
// config.username/password feed SDK auth; config.options carries an optional API
// key (Zilliz Cloud); config.database selects the active database.
export class MilvusAdapter implements DbAdapter {
  readonly kind = "milvus" as const;

  defaultQuery(): string {
    // The query body is a Milvus boolean filter expression; empty means "all
    // rows" (bounded by limit). Seed a comment the user can replace.
    return "";
  }

  defaultPort(): string {
    return "19530";
  }

  defaultDatabase(): string {
    return "";
  }

  defaultConnectionConfig(): DbConnectionConfig {
    return {
      host: "127.0.0.1",
      port: this.defaultPort(),
      username: "",
      password: "",
      database: "",
      filePath: "",
      authSource: "",
      serviceName: "",
      options: "",
    };
  }

  defaultTabType(): DbTabType {
    return "query";
  }

  // The "connection URL" for Milvus is its gRPC address (host:port, no scheme).
  // Keep a pasted host verbatim; otherwise compose host:port from fields.
  buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    const config = connection.config;
    const host = config.host.trim();
    const port = config.port.trim();
    if (!host) {
      return connection.url.trim();
    }
    if (host.includes(":")) {
      return host;
    }
    return `${host}${port ? `:${port}` : ""}`;
  }

  parseConnectionUrl(raw: string): DbConnectionConfig {
    const fallback = this.defaultConnectionConfig();
    const normalized = raw.trim();
    if (!normalized) {
      return fallback;
    }
    try {
      const url = new URL(
        /^[a-z]+:\/\//i.test(normalized) ? normalized : `http://${normalized}`,
      );
      return {
        ...fallback,
        host: decodeURIComponent(url.hostname || fallback.host),
        port: url.port || fallback.port,
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      };
    } catch {
      return fallback;
    }
  }

  switchDsnDatabase(baseDsn: string, _database: string): string {
    return baseDsn;
  }

  escapeIdentifier(value: string): string {
    return value;
  }

  buildQualifiedName(_schemaName: string, objectName: string): string {
    return objectName;
  }

  buildCommandMessage(tab: DbTab, connection: DbConnection): DbSocketCommandMessage {
    const address = this.buildConnectionUrl(connection) || connection.url.trim();
    const collection =
      tab.databaseName?.trim() || connection.config.database.trim();
    return {
      id: tab.id,
      type: "milvus",
      payload: {
        address,
        username: connection.config.username,
        password: connection.config.password,
        apiKey: connection.config.options,
        database: connection.config.database,
        action: "query",
        collection,
        expr: tab.query,
      },
    };
  }

  buildTestCommandMessage(connection: DbConnection): DbSocketCommandMessage {
    const address = this.buildConnectionUrl(connection) || connection.url.trim();
    return {
      id: makeId("db-connect"),
      type: "milvus",
      payload: {
        address,
        username: connection.config.username,
        password: connection.config.password,
        apiKey: connection.config.options,
        database: connection.config.database,
        action: "ping",
        timeoutMs: 3000,
      },
    };
  }

  buildDisconnectMessage(connection: DbConnection): DbSocketCommandMessage {
    return {
      id: makeId("db-disconnect"),
      type: "dbDisconnect",
      payload: {
        kind: connection.kind,
        // DisconnectConnection routes Milvus on the `url` arg (the gRPC address).
        url: this.buildConnectionUrl(connection) || connection.url.trim(),
      },
    };
  }

  // Collection listing is driven by service.ts over the `milvus` protocol
  // (action "listCollections"), not by SQL — these SQL slots are inert.
  buildExplorerQuery(): string | null {
    return null;
  }

  buildRoutineExplorerQuery(): string | null {
    return null;
  }

  buildExplorerNodes(): DbExplorerNode[] {
    return [];
  }

  buildObjectQuery(_schemaName: string, objectName: string): string {
    return objectName;
  }

  buildCountQuery(): string {
    return "";
  }

  buildFunctionQuery(): string {
    return "";
  }

  buildObjectColumnsQuery(): string {
    return "";
  }

  buildPrimaryKeyQuery(_node: DbExplorerLeafNode): string | null {
    return null;
  }

  buildIndexesQuery(_node: DbExplorerLeafNode): string | null {
    return null;
  }

  buildConstraintsQuery(_node: DbExplorerLeafNode): string | null {
    return null;
  }

  buildForeignKeysQuery(_node: DbExplorerLeafNode): string | null {
    return null;
  }

  buildDdlQuery(node: DbExplorerLeafNode): string {
    return node.query ?? node.label;
  }

  parsePrimaryKeyResult(): string[] {
    return [];
  }

  parseIndexesResult(): DbObjectIndex[] {
    return [];
  }

  parseConstraintsResult(): DbObjectConstraint[] {
    return [];
  }

  parseForeignKeysResult(): DbObjectForeignKey[] {
    return [];
  }

  buildAllColumnsQuery(): string | null {
    return null;
  }

  defaultCompletionSchema(): string | null {
    return null;
  }

  formatLanguage(): DbFormatLanguage {
    return "javascript";
  }

  completionKeywords(): DbCompletionKeywords {
    return "mongo";
  }

  completionDialect(): DbCompletionDialect {
    return null;
  }

  identifierQuoteChar(): string {
    return '"';
  }

  // --- UI metadata -------------------------------------------------------
  badge(): DbConnectionBadge {
    return { label: "MI", class: "theme-method-badge theme-method-put" };
  }

  displayName(): string {
    return "Milvus";
  }

  describeConnection(connection: DbConnection): string {
    const host = connection.config.host.trim() || "localhost";
    const port = connection.config.port.trim();
    const database = connection.config.database.trim();
    const hostLabel = `${host}${port ? `:${port}` : ""}`;
    return database ? `${hostLabel} / ${database}` : hostLabel;
  }

  // --- Capabilities ------------------------------------------------------
  dataModel(): DbDataModel {
    return "search";
  }

  isRelational(): boolean {
    return false;
  }

  isDocumentStore(): boolean {
    return false;
  }

  isKeyValueStore(): boolean {
    return false;
  }

  // FALSE on purpose: isSearchStore() routes to the Elasticsearch explorer in
  // service.ts. Milvus rides its own `kind === "milvus"` dispatch branch.
  isSearchStore(): boolean {
    return false;
  }

  isWideColumn(): boolean {
    return false;
  }

  databaseListingStrategy(): DbDatabaseListingStrategy {
    return "single";
  }

  usesDsnDatabaseSwitching(): boolean {
    return false;
  }

  canCreateDatabase(): boolean {
    return false;
  }

  canShowConnectionSummary(): boolean {
    return false;
  }

  treatsSchemaAsDatabase(): boolean {
    return true;
  }

  // --- Explorer action SQL ----------------------------------------------
  // Milvus has no SQL surface; the interface requires concrete bodies.
  buildStructureQuery(node: DbExplorerLeafNode): string {
    return node.query ?? node.label;
  }

  buildShowSqlQuery(node: DbExplorerLeafNode): string {
    return node.query ?? node.label;
  }

  buildRenameQuery(node: DbExplorerLeafNode): string {
    return node.query ?? node.label;
  }

  buildTruncateQuery(node: DbExplorerLeafNode): string {
    return node.query ?? node.label;
  }

  // --- Database-level templates ------------------------------------------
  buildCreateDatabaseTemplate(): string {
    return "";
  }

  buildCreateTableTemplate(): string {
    return "";
  }

  buildImportTemplate(): string {
    return "";
  }

  buildDropDatabaseTemplate(): string {
    return "";
  }

  buildConnectionSummaryQuery(): string {
    return "";
  }
}
