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

// Weaviate is a vector store reached over its REST API (see
// server/internal/db/weaviate.go) — a "search" data-model kind alongside
// Elasticsearch and Qdrant. It has no SQL surface and no GORM dialector; classes
// play the role of indices, and objects are flattened to tabular {columns, rows}
// by the runner so they render in the normal grid (the `weaviate` connection
// kind maps to the "sql" result kind in db-transport.ts).
//
// Auth: config.host[:port] is the HTTP base address; config.password carries an
// optional API key (Weaviate Cloud), sent as a Bearer token server-side. A query
// body, when present, is forwarded as a raw GraphQL query; an empty body issues a
// bounded REST objects listing for the targeted class.
export class WeaviateAdapter implements DbAdapter {
  readonly kind = "weaviate" as const;

  defaultQuery(): string {
    // Empty body → bounded REST objects listing for the selected class. Editing
    // this to a GraphQL query routes through /v1/graphql instead.
    return "";
  }

  defaultPort(): string {
    return "8080";
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

  // The "connection URL" for Weaviate is its HTTP base address. Keep a pasted URL
  // verbatim; otherwise compose http://host:port from fields.
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
    return `${scheme}${host}${port ? `:${port}` : ""}`;
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
    const cls = tab.databaseName?.trim() || connection.config.database.trim();
    return {
      id: tab.id,
      type: "weaviate",
      payload: {
        address,
        apiKey: connection.config.password,
        action: "objects",
        class: cls,
        body: tab.query,
      },
    };
  }

  buildTestCommandMessage(connection: DbConnection): DbSocketCommandMessage {
    const address = this.buildConnectionUrl(connection) || connection.url.trim();
    return {
      id: makeId("db-connect"),
      type: "weaviate",
      payload: {
        address,
        apiKey: connection.config.password,
        action: "meta",
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
        // DisconnectConnection routes Weaviate on the `url` arg (base address).
        url: this.buildConnectionUrl(connection) || connection.url.trim(),
      },
    };
  }

  // Class listing is driven by service.ts over the `weaviate` protocol (action
  // "listClasses"), not by SQL — these SQL slots are inert.
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
    // GraphQL bodies are closest to the JS prettier path.
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
    return { label: "WV", class: "theme-method-badge theme-method-put" };
  }

  displayName(): string {
    return "Weaviate";
  }

  describeConnection(connection: DbConnection): string {
    const host = connection.config.host.trim() || "localhost";
    const port = connection.config.port.trim();
    const cls = connection.config.database.trim();
    const hostLabel = `${host}${port ? `:${port}` : ""}`;
    return cls ? `${hostLabel} / ${cls}` : hostLabel;
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
  // Weaviate has no SQL surface; the interface requires concrete bodies.
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
