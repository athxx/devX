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

// Cassandra is a wide-column store reached over the native CQL binary protocol
// via gocql (pure-Go, see server/internal/db/cassandra.go). Although wide-column,
// it speaks CQL — a SQL-like language — so unlike Bigtable its query results are
// flattened to tabular {columns, rows} and ride the normal grid (the `cassandra`
// connection kind maps to the "sql" result kind in db-transport.ts). It therefore
// keeps isWideColumn()=false (Bigtable owns that explorer/wire path) and instead
// uses its own dispatch branch in service.ts, listing keyspaces → tables.
//
// Config: config.host[:port] (comma-separated for multiple contact points) is the
// address; config.username/password feed PasswordAuthenticator; config.database is
// the keyspace.
export class CassandraAdapter implements DbAdapter {
  readonly kind = "cassandra" as const;

  defaultQuery(): string {
    return "SELECT * FROM system.local";
  }

  defaultPort(): string {
    return "9042";
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

  // The "connection URL" for Cassandra is a comma-separated host[:port] list. Keep
  // a host containing a comma (multi-node) verbatim; otherwise compose host:port.
  buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    const config = connection.config;
    const host = config.host.trim();
    const port = config.port.trim();
    if (!host) {
      return connection.url.trim();
    }
    // Multi-node lists already carry their own ports; leave them as-is.
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
        /:\/\//.test(normalized) ? normalized : `cassandra://${normalized}`,
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
    return `"${value.replace(/"/g, '""')}"`;
  }

  buildQualifiedName(schemaName: string, objectName: string): string {
    return schemaName ? `${schemaName}.${objectName}` : objectName;
  }

  buildCommandMessage(tab: DbTab, connection: DbConnection): DbSocketCommandMessage {
    const address = this.buildConnectionUrl(connection) || connection.url.trim();
    const keyspace =
      tab.databaseName?.trim() || connection.config.database.trim();
    return {
      id: tab.id,
      type: "cassandra",
      payload: {
        address,
        username: connection.config.username,
        password: connection.config.password,
        action: "query",
        keyspace,
        query: tab.query,
      },
    };
  }

  buildTestCommandMessage(connection: DbConnection): DbSocketCommandMessage {
    const address = this.buildConnectionUrl(connection) || connection.url.trim();
    return {
      id: makeId("db-connect"),
      type: "cassandra",
      payload: {
        address,
        username: connection.config.username,
        password: connection.config.password,
        action: "ping",
        keyspace: connection.config.database,
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
        // DisconnectConnection routes Cassandra on the `url` arg (the host list).
        url: this.buildConnectionUrl(connection) || connection.url.trim(),
      },
    };
  }

  // Keyspace/table listing is driven by service.ts over the `cassandra` protocol
  // (actions "listKeyspaces"/"listTables"), not by SQL — these SQL slots are inert.
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
    // CQL is close enough to SQL for sql-formatter's standard dialect.
    return "sql";
  }

  completionKeywords(): DbCompletionKeywords {
    return "sql";
  }

  completionDialect(): DbCompletionDialect {
    return "standard";
  }

  identifierQuoteChar(): string {
    return '"';
  }

  // --- UI metadata -------------------------------------------------------
  badge(): DbConnectionBadge {
    return { label: "CA", class: "theme-method-badge theme-method-post" };
  }

  displayName(): string {
    return "Cassandra";
  }

  describeConnection(connection: DbConnection): string {
    const host = connection.config.host.trim() || "localhost";
    const port = connection.config.port.trim();
    const keyspace = connection.config.database.trim();
    const hostLabel = host.includes(",")
      ? host
      : `${host}${port ? `:${port}` : ""}`;
    return keyspace ? `${hostLabel} / ${keyspace}` : hostLabel;
  }

  // --- Capabilities ------------------------------------------------------
  dataModel(): DbDataModel {
    return "wideColumn";
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
    return false;
  }

  // CQL results ride the SQL grid; Bigtable owns the gRPC wide-column wire path.
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
