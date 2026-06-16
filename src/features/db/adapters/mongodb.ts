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
import {
  appendUrlOptions,
  buildAuthPart,
  formatSearchParams,
  parseOptionEntries,
} from "./base-sql";
import { makeId } from "../../../lib/utils";

// MongoDB is document-oriented. Like Redis, the SQL-shaped adapter slots are
// no-ops; collection listing and shell execution are driven by service.ts over
// the `mongoShell` / `mongoPing` wire protocol.
export class MongoAdapter implements DbAdapter {
  readonly kind = "mongodb" as const;

  defaultQuery(): string {
    return "db.collection.find({})";
  }

  defaultPort(): string {
    return "27017";
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
      authSource: "admin",
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
    const shouldKeepSlash =
      Boolean(database) ||
      Boolean(config.authSource.trim()) ||
      parseOptionEntries(config.options).length > 0;
    const dbPath = database
      ? `/${encodeURIComponent(database)}`
      : shouldKeepSlash
        ? "/"
        : "";
    const url = new URL(`mongodb://${auth}${host}${port ? `:${port}` : ""}${dbPath}`);
    if (config.authSource.trim()) {
      url.searchParams.set("authSource", config.authSource.trim());
    }
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
        authSource: url.searchParams.get("authSource") ?? fallback.authSource,
        options: formatSearchParams(url, ["authSource"]),
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
    return {
      id: tab.id,
      type: "mongoShell",
      payload: {
        url: effectiveUrl,
        command: tab.query,
      },
    };
  }

  private effectiveUrl(tab: DbTab, connection: DbConnection): string {
    const effectiveDatabase =
      tab.databaseName?.trim() || connection.config.database.trim();
    if (!effectiveDatabase) {
      return this.buildConnectionUrl(connection) || connection.url;
    }
    return this.buildConnectionUrl({
      ...connection,
      config: { ...connection.config, database: effectiveDatabase },
    });
  }

  buildTestCommandMessage(connection: DbConnection): DbSocketCommandMessage {
    return {
      id: makeId("db-connect"),
      type: "mongoPing",
      payload: {
        uri: connection.url,
        database: connection.config.database.trim() || "admin",
      },
    };
  }

  buildDisconnectMessage(connection: DbConnection): DbSocketCommandMessage {
    return {
      id: makeId("db-disconnect"),
      type: "dbDisconnect",
      payload: {
        kind: connection.kind,
        uri: this.buildConnectionUrl(connection) || connection.url.trim(),
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
    return { label: "MGO", class: "theme-method-badge theme-method-trace" };
  }

  displayName(): string {
    return "MongoDB";
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
    return true;
  }

  canShowConnectionSummary(): boolean {
    return true;
  }

  treatsSchemaAsDatabase(): boolean {
    return true;
  }

  // --- Explorer action SQL ----------------------------------------------
  // MongoDB is document-oriented; these slots return shell-friendly fallbacks
  // since the explorer's SQL-only actions never reach them.
  buildStructureQuery(node: DbExplorerLeafNode): string {
    return node.query ?? node.label;
  }

  buildShowSqlQuery(node: DbExplorerLeafNode): string {
    return node.query ?? node.label;
  }

  buildRenameQuery(node: DbExplorerLeafNode): string {
    return `db.${node.label}.renameCollection("new_${node.label}")`;
  }

  buildTruncateQuery(node: DbExplorerLeafNode): string {
    return `db.${node.label}.deleteMany({})`;
  }

  // --- Database-level templates ------------------------------------------
  buildCreateDatabaseTemplate(): string {
    return 'use new_database\n\ndb.createCollection("sample_collection")';
  }

  buildCreateTableTemplate(databaseName: string): string {
    return `use ${databaseName}

db.createCollection('new_collection')`;
  }

  buildImportTemplate(
    databaseName: string,
    source: "sql" | "json" | "csv",
  ): string {
    if (source === "json") {
      return `use ${databaseName}

mongoimport --db ${databaseName} --collection new_collection --file ./data.json --jsonArray`;
    }
    if (source === "csv") {
      return `use ${databaseName}

mongoimport --db ${databaseName} --collection new_collection --type csv --headerline --file ./data.csv`;
    }
    return `use ${databaseName}

// Paste or run your SQL migration equivalent here`;
  }

  buildDropDatabaseTemplate(databaseName: string): string {
    return `use ${databaseName}
db.dropDatabase()`;
  }

  buildConnectionSummaryQuery(): string {
    return "db.adminCommand({ getCmdLineOpts: 1 })";
  }
}
