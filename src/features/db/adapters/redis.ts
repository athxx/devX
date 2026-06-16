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
  DbExplorerLeafNode,
  DbFormatLanguage,
} from "./types";
import { appendUrlOptions, buildAuthPart } from "./base-sql";
import { splitRedisCommand } from "./shared";
import { makeId } from "../../../lib/utils";

// Redis is a key/value store, not relational. Most SQL-oriented adapter slots
// (explorer SQL, object/index/constraint/fk queries, result parsers) are no-ops
// here — the explorer and key inspection are orchestrated by service.ts via the
// `redis` wire protocol, not generic SQL round-trips.
export class RedisAdapter implements DbAdapter {
  readonly kind = "redis" as const;

  defaultQuery(): string {
    return "PING";
  }

  defaultPort(): string {
    return "6379";
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
      database: this.defaultDatabase(),
      filePath: "",
      authSource: "",
      serviceName: "",
      options: "",
    };
  }

  defaultTabType(): DbTabType {
    return "query";
  }

  buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    const config = connection.config;
    const host = config.host.trim();
    const port = config.port.trim();
    const username = config.username.trim();
    const password = config.password.trim();
    const database = config.database.trim();

    if (!host) {
      return connection.url.trim();
    }

    const auth = buildAuthPart(username, password);
    const dbPath = database ? `/${encodeURIComponent(database)}` : "";
    const url = new URL(`redis://${auth}${host}${port ? `:${port}` : ""}${dbPath}`);
    appendUrlOptions(url, config.options);
    return url.toString();
  }

  parseConnectionUrl(raw: string): DbConnectionConfig {
    const fallback = this.defaultConnectionConfig();
    try {
      const url = new URL(raw);
      const pathname = url.pathname.replace(/^\/+/, "");
      return {
        ...fallback,
        host: decodeURIComponent(url.hostname || fallback.host),
        port: url.port || fallback.port,
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: decodeURIComponent(pathname),
        options: new URLSearchParams(url.search).toString(),
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
    const effectiveUrl = this.effectiveUrl(tab, connection);
    const parts = splitRedisCommand(tab.query.trim());
    return {
      id: tab.id,
      type: "redis",
      payload: {
        url: effectiveUrl,
        command: parts[0] ?? "",
        arguments: parts.slice(1),
      },
    };
  }

  private effectiveUrl(tab: DbTab, connection: DbConnection): string {
    const raw =
      tab.databaseName?.trim() || connection.config.database.trim();
    if (!raw) {
      return this.buildConnectionUrl(connection) || connection.url;
    }
    // Explorer nodes use labels like "db0" but the URL needs just "0"
    const effectiveDatabase = raw.replace(/^db/i, "");
    return this.buildConnectionUrl({
      ...connection,
      config: { ...connection.config, database: effectiveDatabase },
    });
  }

  buildTestCommandMessage(connection: DbConnection): DbSocketCommandMessage {
    return {
      id: makeId("db-connect"),
      type: "redis",
      payload: {
        url: connection.url,
        command: "PING",
        arguments: [],
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
        url: this.buildConnectionUrl(connection) || connection.url.trim(),
      },
    };
  }

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
    return null;
  }

  completionKeywords(): DbCompletionKeywords {
    return "redis";
  }

  completionDialect(): DbCompletionDialect {
    return null;
  }

  identifierQuoteChar(): string {
    return '"';
  }

  // --- UI metadata -------------------------------------------------------
  badge(): DbConnectionBadge {
    return { label: "RDS", class: "theme-method-badge theme-method-patch" };
  }

  displayName(): string {
    return "Redis";
  }

  describeConnection(connection: DbConnection): string {
    const host = connection.config.host.trim() || "localhost";
    const port = connection.config.port.trim();
    const database = connection.config.database.trim();
    const hostLabel = `${host}${port ? `:${port}` : ""}`;
    return database ? `${hostLabel} / ${database}` : hostLabel;
  }

  // --- Capabilities ------------------------------------------------------
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
  // Redis has no SQL surface; the explorer never invokes these (the UI gates
  // them behind SQL-only actions), but the interface requires concrete bodies.
  buildStructureQuery(node: DbExplorerLeafNode): string {
    return node.query ?? node.label;
  }

  buildShowSqlQuery(node: DbExplorerLeafNode): string {
    return node.query ?? node.label;
  }

  buildRenameQuery(node: DbExplorerLeafNode): string {
    return `RENAME ${node.label} new_${node.label}`;
  }

  buildTruncateQuery(node: DbExplorerLeafNode): string {
    return `DEL ${node.label}`;
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
    return "FLUSHDB";
  }

  buildConnectionSummaryQuery(): string {
    return "INFO";
  }
}
