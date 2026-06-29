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

// RocketMQ is a distributed messaging/streaming platform reached over its
// remoting protocol via the pure-Go github.com/apache/rocketmq-client-go/v2
// admin client (see server/internal/db/rocketmq.go). It has no SQL surface; the
// frontend speaks the dedicated `rocketmq` protocol and flattens topics to
// tabular {columns, rows} that ride the normal grid (the `rocketmq` connection
// kind maps to the "sql" result kind in db-transport.ts). It is neither
// relational, document, nor a Redis-style key/value store, so every capability
// flag is false and it dispatches via its own service.ts branch (before the SQL
// fallback).
//
// Config: config.host[:port] (comma-separated for multiple nameservers) is the
// address. config.username/password feed RocketMQ ACL (AccessKey/SecretKey).
export class RocketMQAdapter implements DbAdapter {
  readonly kind = "rocketmq" as const;

  defaultQuery(): string {
    return "";
  }

  defaultPort(): string {
    return "9876";
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

  // The "connection URL" for RocketMQ is a comma-separated nameserver host[:port]
  // list. Keep a host containing a comma verbatim; otherwise compose host:port.
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
        /:\/\//.test(normalized) ? normalized : `rocketmq://${normalized}`,
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
      type: "rocketmq",
      payload: {
        address,
        username: connection.config.username,
        password: connection.config.password,
        action: "listTopics",
        query: tab.query,
      },
    };
  }

  buildTestCommandMessage(connection: DbConnection): DbSocketCommandMessage {
    const address = this.buildConnectionUrl(connection) || connection.url.trim();
    return {
      id: makeId("db-connect"),
      type: "rocketmq",
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
        // DisconnectConnection routes rocketmq on the `url` arg (the nameserver
        // list).
        url: this.buildConnectionUrl(connection) || connection.url.trim(),
      },
    };
  }

  // Topic listing is driven by service.ts over the `rocketmq` protocol — these
  // SQL slots are inert.
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
    return { label: "MQ", class: "theme-method-badge theme-method-post" };
  }

  displayName(): string {
    return "RocketMQ";
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

  // RocketMQ is not a Redis-style key/value store; it speaks its own protocol
  // and rides the SQL grid, dispatching via its own service.ts branch.
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
