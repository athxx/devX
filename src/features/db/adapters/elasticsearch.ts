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

// Elasticsearch is a search/index store — the first "search" data-model kind.
// It has no SQL surface and no GORM dialector; instead it speaks the dedicated
// `elasticsearch` wire protocol (see server/internal/db/elasticsearch.go). Most
// SQL-shaped adapter slots are inert; the explorer (index listing) and query
// execution are orchestrated by service.ts off `isSearchStore()`, mirroring how
// Mongo/Redis are handled.
export class ElasticsearchAdapter implements DbAdapter {
  readonly kind = "elasticsearch" as const;

  defaultQuery(): string {
    // Default body is a match_all query DSL; the editor sends it as the search
    // body, with the active index supplied separately.
    return '{\n  "query": {\n    "match_all": {}\n  }\n}';
  }

  defaultPort(): string {
    return "9200";
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

  // The "connection URL" for ES is its HTTP base address. We keep the raw URL
  // when the user pasted one; otherwise compose http://host:port from fields.
  buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    const config = connection.config;
    const host = config.host.trim();
    const port = config.port.trim();

    if (!host) {
      return connection.url.trim();
    }

    const scheme = /^https?:\/\//i.test(host) ? "" : "http://";
    const base = `${scheme}${host}${port ? `:${port}` : ""}`;
    return base;
  }

  parseConnectionUrl(raw: string): DbConnectionConfig {
    const fallback = this.defaultConnectionConfig();
    const normalized = raw.trim();
    if (!normalized) {
      return fallback;
    }
    try {
      const url = new URL(normalized);
      return {
        ...fallback,
        host: decodeURIComponent(url.hostname || fallback.host),
        port: url.port || (url.protocol === "https:" ? "443" : fallback.port),
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
    const index = tab.databaseName?.trim() || connection.config.database.trim();
    return {
      id: tab.id,
      type: "elasticsearch",
      payload: {
        address,
        username: connection.config.username.trim(),
        password: connection.config.password,
        action: "search",
        index,
        body: tab.query,
      },
    };
  }

  buildTestCommandMessage(connection: DbConnection): DbSocketCommandMessage {
    const address = this.buildConnectionUrl(connection) || connection.url.trim();
    return {
      id: makeId("db-connect"),
      type: "elasticsearch",
      payload: {
        address,
        username: connection.config.username.trim(),
        password: connection.config.password,
        action: "info",
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
        // DisconnectConnection routes ES on the `url` arg (the HTTP address).
        url: this.buildConnectionUrl(connection) || connection.url.trim(),
      },
    };
  }

  // Index listing is driven by service.ts over the `elasticsearch` protocol
  // (action "listIndices"), not by SQL — these SQL slots are inert.
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
    // Query DSL bodies are JSON — route through the JS/JSON prettier path.
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
    return { label: "ES", class: "theme-method-badge theme-method-put" };
  }

  displayName(): string {
    return "Elasticsearch";
  }

  describeConnection(connection: DbConnection): string {
    const host = connection.config.host.trim() || "localhost";
    const port = connection.config.port.trim();
    const index = connection.config.database.trim();
    const hostLabel = `${host}${port ? `:${port}` : ""}`;
    return index ? `${hostLabel} / ${index}` : hostLabel;
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

  isSearchStore(): boolean {
    return true;
  }

  isWideColumn(): boolean {
    return false;
  }

  // ES uses its own search-store explorer loader keyed off `isSearchStore()`,
  // so this enum is not consulted; "single" is the inert default.
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
    // No SQL-style summary query; cluster info is reached via the search path.
    return false;
  }

  treatsSchemaAsDatabase(): boolean {
    return true;
  }

  // --- Explorer action SQL ----------------------------------------------
  // ES has no SQL surface; the explorer gates these behind SQL-only actions,
  // but the interface requires concrete bodies.
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
    // Surfaced via the search wire path (action "info") rather than a SQL query.
    return "";
  }
}
