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

// Google BigQuery is a genuine relational SQL store (it runs GoogleSQL /
// Standard SQL), unlike the other GCP service Bigtable (wide-column). So this is
// a HYBRID adapter: it reports the "sql" data-model (isRelational()=true) and
// the editor sends real SQL — but BigQuery cannot ride the shared DSN /
// database/sql / GORM dialector path, because its transport is REST+gRPC and its
// auth is a GCP project + service-account JSON (or ADC), not host/port/user/pass.
// It therefore speaks a dedicated `bigquery` wire protocol (see
// server/internal/db/bigquery.go) whose runner returns SQL-shaped {columns, rows}
// (mapped to the "sql" result kind in db-transport.ts), so results render in the
// normal grid. Explorer (datasets → tables) is driven by service.ts off the
// `kind === "bigquery"` dispatch branch, mirroring Cassandra's keyspace→tables.
//
// To avoid bloating the shared DbConnectionConfig, auth reuses existing slots
// (same convention as BigtableAdapter):
//   config.host        -> GCP project id
//   config.database    -> default dataset id (optional)
//   config.serviceName -> service-account JSON key (empty = ADC)
//   config.options     -> processing location / custom endpoint (optional)
// The connection form relabels these fields for BigQuery.
export class BigQueryAdapter implements DbAdapter {
  readonly kind = "bigquery" as const;

  defaultQuery(): string {
    return "SELECT 1 AS value";
  }

  defaultPort(): string {
    return "";
  }

  defaultDatabase(): string {
    return "";
  }

  defaultConnectionConfig(): DbConnectionConfig {
    return {
      host: "",
      port: "",
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

  // BigQuery has no connection URL; the identity is project (+ optional dataset).
  // We pack them as "project\x00dataset" so the disconnect path can route on it
  // (matched as a prefix server-side, like Bigtable).
  buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    const project = connection.config.host.trim();
    const dataset = connection.config.database.trim();
    return `${project}\x00${dataset}`;
  }

  parseConnectionUrl(raw: string): DbConnectionConfig {
    const fallback = this.defaultConnectionConfig();
    const normalized = raw.trim();
    if (!normalized) {
      return fallback;
    }
    // Accept "project/dataset", "project.dataset" or "project\x00dataset".
    const parts = normalized.split(/[\s/.\x00]/);
    return {
      ...fallback,
      host: parts[0]?.trim() ?? "",
      database: parts[1]?.trim() ?? "",
    };
  }

  switchDsnDatabase(baseDsn: string, _database: string): string {
    return baseDsn;
  }

  // BigQuery identifiers are backtick-quoted (GoogleSQL).
  escapeIdentifier(value: string): string {
    return "`" + value.replace(/`/g, "\\`") + "`";
  }

  buildQualifiedName(schemaName: string, objectName: string): string {
    const dataset = schemaName.trim();
    return dataset
      ? `${this.escapeIdentifier(dataset)}.${this.escapeIdentifier(objectName)}`
      : this.escapeIdentifier(objectName);
  }

  // The editor body is GoogleSQL; we forward it verbatim over the `bigquery`
  // wire type along with the GCP auth slots, expecting a SQL-shaped response.
  buildCommandMessage(
    tab: DbTab,
    connection: DbConnection,
  ): DbSocketCommandMessage {
    return {
      id: tab.id,
      type: "bigquery",
      payload: {
        ...this.authPayload(connection),
        action: "query",
        query: tab.query,
      },
    };
  }

  buildTestCommandMessage(connection: DbConnection): DbSocketCommandMessage {
    return {
      id: makeId("db-connect"),
      type: "bigquery",
      payload: {
        ...this.authPayload(connection),
        action: "listDatasets",
        timeoutMs: 8000,
      },
    };
  }

  buildDisconnectMessage(connection: DbConnection): DbSocketCommandMessage {
    return {
      id: makeId("db-disconnect"),
      type: "dbDisconnect",
      payload: {
        kind: connection.kind,
        // DisconnectConnection routes BigQuery on the `url` arg, which carries
        // "project\x00dataset" (matched as a prefix server-side).
        url: this.buildConnectionUrl(connection),
      },
    };
  }

  // authPayload assembles the project/dataset/credentials/location fields every
  // BigQuery command shares, reading them from the relabelled config slots.
  private authPayload(connection: DbConnection): Record<string, unknown> {
    const config = connection.config;
    return {
      project: config.host.trim(),
      dataset: config.database.trim(),
      credentials: config.serviceName,
      location: config.options.trim(),
    };
  }

  // Dataset/table listing is driven by service.ts over the `bigquery` protocol
  // (actions listDatasets / listTables), not by SQL — these SQL slots are inert.
  buildExplorerQuery(): string | null {
    return null;
  }

  buildRoutineExplorerQuery(): string | null {
    return null;
  }

  buildExplorerNodes(): DbExplorerNode[] {
    return [];
  }

  buildObjectQuery(schemaName: string, objectName: string): string {
    return `SELECT * FROM ${this.buildQualifiedName(schemaName, objectName)} LIMIT 100`;
  }

  buildCountQuery(schemaName: string, objectName: string): string {
    return `SELECT COUNT(*) AS count FROM ${this.buildQualifiedName(schemaName, objectName)}`;
  }

  buildFunctionQuery(): string {
    return "";
  }

  // Column metadata lives in each dataset's INFORMATION_SCHEMA.COLUMNS view.
  buildObjectColumnsQuery(node: DbExplorerNode): string {
    const leaf = node as DbExplorerLeafNode;
    const dataset = (leaf.schemaName ?? "").trim();
    const from = dataset
      ? `${this.escapeIdentifier(dataset)}.INFORMATION_SCHEMA.COLUMNS`
      : "INFORMATION_SCHEMA.COLUMNS";
    return (
      `SELECT column_name, data_type, is_nullable, ordinal_position\n` +
      `FROM ${from}\n` +
      `WHERE table_name = '${leaf.label.replace(/'/g, "\\'")}'\n` +
      `ORDER BY ordinal_position`
    );
  }

  // BigQuery has no traditional PK / index / FK metadata surface for the
  // structure panel, so these are inert (the SQL data-model still renders the
  // column list above).
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
    // BigQuery exposes object DDL in INFORMATION_SCHEMA.TABLES.ddl.
    const dataset = node.schemaName?.trim();
    const from = dataset
      ? `${this.escapeIdentifier(dataset)}.INFORMATION_SCHEMA.TABLES`
      : "INFORMATION_SCHEMA.TABLES";
    return (
      `SELECT ddl FROM ${from}\n` +
      `WHERE table_name = '${node.label.replace(/'/g, "\\'")}'`
    );
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
    return "`";
  }

  // --- UI metadata -------------------------------------------------------
  badge(): DbConnectionBadge {
    return { label: "BQ", class: "theme-method-badge theme-method-get" };
  }

  displayName(): string {
    return "BigQuery";
  }

  describeConnection(connection: DbConnection): string {
    const project = connection.config.host.trim() || "project";
    const dataset = connection.config.database.trim();
    return dataset ? `${project} / ${dataset}` : project;
  }

  // --- Capabilities ------------------------------------------------------
  dataModel(): DbDataModel {
    return "relational";
  }

  isRelational(): boolean {
    return true;
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

  isWideColumn(): boolean {
    return false;
  }

  // BigQuery uses its own `kind === "bigquery"` explorer loader (datasets →
  // tables) dispatched in loadDbExplorer, so this enum is not actually consulted;
  // "explicit-list" is the closest fit (a project enumerates multiple datasets).
  databaseListingStrategy(): DbDatabaseListingStrategy {
    return "explicit-list";
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

  // Datasets play the role of schemas/databases in the explorer tree.
  treatsSchemaAsDatabase(): boolean {
    return true;
  }

  // --- Explorer action SQL ----------------------------------------------
  buildStructureQuery(node: DbExplorerLeafNode): string {
    return this.buildObjectColumnsQuery(node);
  }

  buildShowSqlQuery(node: DbExplorerLeafNode): string {
    return this.buildDdlQuery(node);
  }

  buildRenameQuery(node: DbExplorerLeafNode): string {
    const qualified = node.qualifiedName ?? node.label;
    return `ALTER TABLE ${qualified} RENAME TO new_name;`;
  }

  buildTruncateQuery(node: DbExplorerLeafNode): string {
    const qualified = node.qualifiedName ?? node.label;
    return `TRUNCATE TABLE ${qualified};`;
  }

  // --- Database-level templates ------------------------------------------
  buildCreateDatabaseTemplate(): string {
    return "";
  }

  buildCreateTableTemplate(databaseName: string): string {
    const dataset = databaseName.trim();
    const qualified = dataset
      ? `${this.escapeIdentifier(dataset)}.new_table`
      : "new_table";
    return (
      `CREATE TABLE ${qualified} (\n` +
      `  id INT64,\n` +
      `  name STRING\n` +
      `);`
    );
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
