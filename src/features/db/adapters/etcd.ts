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

// etcd is a distributed key/value store reached over its gRPC API via the
// official pure-Go client (see server/internal/db/etcd.go). Although its data
// model is key/value, it does NOT reuse the Redis explorer/wire path: it speaks
// the dedicated `etcd` protocol and flattens key/value pairs to tabular
// {columns, rows} that ride the normal grid (the `etcd` connection kind maps to
// the "sql" result kind in db-transport.ts). It therefore keeps
// isKeyValueStore()=false (Redis owns that path) and uses its own dispatch
// branch in service.ts — that branch MUST precede the isKeyValueStore() check.
//
// Config: config.host[:port] (comma-separated for multiple endpoints) is the
// address; config.username/password feed etcd RBAC auth.
export class EtcdAdapter implements DbAdapter {
  readonly kind = "etcd" as const;

  defaultQuery(): string {
    // The query is treated as a key prefix to range over (empty = whole keyspace).
    return "";
  }

  defaultPort(): string {
    return "2379";
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

  // The "connection URL" for etcd is a comma-separated host[:port] list. Keep a
  // host containing a comma (multi-endpoint) verbatim; otherwise compose host:port.
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
        /:\/\//.test(normalized) ? normalized : `etcd://${normalized}`,
      );
      return {
        ...fallback,
        host: decodeURIComponent(url.hostname || fallback.host),
        port: url.port || fallback.port,
        username: decodeURIComponent(url.username) || fallback.username,
        password: decodeURIComponent(url.password),
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
      type: "etcd",
      payload: {
        address,
        username: connection.config.username,
        password: connection.config.password,
        action: "query",
        prefix: tab.query,
      },
    };
  }

  buildTestCommandMessage(connection: DbConnection): DbSocketCommandMessage {
    const address = this.buildConnectionUrl(connection) || connection.url.trim();
    return {
      id: makeId("db-connect"),
      type: "etcd",
      payload: {
        address,
        username: connection.config.username,
        password: connection.config.password,
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
        // DisconnectConnection routes etcd on the `url` arg (the endpoint list).
        url: this.buildConnectionUrl(connection) || connection.url.trim(),
      },
    };
  }

  // Key listing is driven by service.ts over the `etcd` protocol — these SQL
  // slots are inert.
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
    return { label: "ET", class: "theme-method-badge theme-method-post" };
  }

  displayName(): string {
    return "etcd";
  }

  describeConnection(connection: DbConnection): string {
    const host = connection.config.host.trim() || "localhost";
    const port = connection.config.port.trim();
    return host.includes(",") ? host : `${host}${port ? `:${port}` : ""}`;
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

  // Redis owns the keyValue explorer/wire path; etcd speaks its own protocol and
  // rides the SQL grid, so it opts out here and dispatches via its own branch.
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
