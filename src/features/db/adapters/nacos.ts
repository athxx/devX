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

// Nacos is a dynamic-config + service-discovery registry reached over its HTTP/
// gRPC API via the pure-Go github.com/nacos-group/nacos-sdk-go/v2 client (see
// server/internal/db/nacos.go). It has no SQL surface; the frontend speaks the
// dedicated `nacos` protocol and flattens configs/services to tabular {columns,
// rows} that ride the normal grid (the `nacos` connection kind maps to the "sql"
// result kind in db-transport.ts). It is neither relational, document, nor a
// Redis-style key/value store, so every capability flag is false and it
// dispatches via its own service.ts branch (before the SQL fallback).
//
// Config: config.host[:port] (comma-separated for multiple servers) is the
// address; config.database is repurposed as the Nacos namespace (relabeled
// "Namespace" in the connection form). config.username/password feed Nacos auth.
export class NacosAdapter implements DbAdapter {
  readonly kind = "nacos" as const;

  defaultQuery(): string {
    return "";
  }

  defaultPort(): string {
    return "8848";
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

  // The "connection URL" for Nacos is a comma-separated host[:port] server list.
  // Keep a host containing a comma verbatim; otherwise compose host:port.
  buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    const config = connection.config;
    const host = config.host.trim();
    const port = config.port.trim();
    if (!host) {
      return connection.url.trim();
    }
    if (host.includes(",")) {
      return host;
    }
    return port ? `${host}:${port}` : host;
  }

  parseConnectionUrl(raw: string): DbConnectionConfig {
    const fallback = this.defaultConnectionConfig();
    const normalized = raw.trim();
    if (!normalized) {
      return fallback;
    }
    try {
      const url = new URL(
        /:\/\//.test(normalized) ? normalized : `nacos://${normalized}`,
      );
      return {
        ...fallback,
        host: decodeURIComponent(url.hostname || fallback.host),
        port: url.port || fallback.port,
        username: decodeURIComponent(url.username) || fallback.username,
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, "") || fallback.database,
      };
    } catch {
      return { ...fallback, host: normalized };
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
    return {
      id: tab.id,
      type: "nacos",
      payload: {
        address,
        username: connection.config.username,
        password: connection.config.password,
        namespace: connection.config.database,
        action: "listConfigs",
        query: tab.query,
      },
    };
  }

  buildTestCommandMessage(connection: DbConnection): DbSocketCommandMessage {
    const address = this.buildConnectionUrl(connection) || connection.url.trim();
    return {
      id: makeId("db-connect"),
      type: "nacos",
      payload: {
        address,
        username: connection.config.username,
        password: connection.config.password,
        namespace: connection.config.database,
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
        // DisconnectConnection routes nacos on the `url` arg (the server list);
        // the runner prefix-matches every cached namespace under that address.
        url: this.buildConnectionUrl(connection) || connection.url.trim(),
      },
    };
  }

  // Config/service listing is driven by service.ts over the `nacos` protocol —
  // these SQL slots are inert.
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
    return "sql";
  }

  completionKeywords(): DbCompletionKeywords {
    return "sql";
  }

  completionDialect(): DbCompletionDialect {
    return "standard";
  }

  identifierQuoteChar(): string {
    return "";
  }

  // --- UI metadata -------------------------------------------------------
  badge(): DbConnectionBadge {
    return { label: "NC", class: "theme-method-badge theme-method-post" };
  }

  displayName(): string {
    return "Nacos";
  }

  describeConnection(connection: DbConnection): string {
    const host = connection.config.host.trim() || "localhost";
    const port = connection.config.port.trim();
    const ns = connection.config.database.trim();
    const base = host.includes(",") ? host : `${host}${port ? `:${port}` : ""}`;
    return ns ? `${base} · ${ns}` : base;
  }

  // --- Capabilities ------------------------------------------------------
  dataModel(): DbDataModel {
    return "keyValue";
  }

  isRelational(): boolean {
    return false;
  }

  isDocumentStore(): boolean {
    return false;
  }

  // Nacos is not a Redis-style key/value store; it speaks its own protocol and
  // rides the SQL grid, dispatching via its own service.ts branch.
  isKeyValueStore(): boolean {
    return false;
  }

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
    return false;
  }

  // --- Explorer action SQL ----------------------------------------------
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
