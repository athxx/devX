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

// Cloud Bigtable is a wide-column (NoSQL) store reached over gRPC — the first
// "wideColumn" data-model kind. It has no SQL surface and no GORM dialector;
// it speaks the dedicated `bigtable` wire protocol (see
// server/internal/db/bigtable.go). Most SQL-shaped adapter slots are inert; the
// explorer (table listing) and query execution are orchestrated by service.ts
// off `isWideColumn()`, mirroring Elasticsearch/Mongo/Redis.
//
// Auth differs from every other kind: instead of host/port/user/pass it takes a
// GCP project + instance plus optional service-account JSON. To avoid bloating
// the shared DbConnectionConfig, these reuse existing config slots:
//   config.host        -> GCP project id
//   config.database    -> Bigtable instance id
//   config.serviceName -> service-account JSON key (empty = ADC)
//   config.options     -> custom endpoint (e.g. emulator host; optional)
// The connection form relabels these fields for Bigtable.
export class BigtableAdapter implements DbAdapter {
  readonly kind = "bigtable" as const;

  defaultQuery(): string {
    // The "query" for Bigtable is a row scan spec. We encode it as a small JSON
    // document the editor can edit; service.ts/buildCommandMessage reads it.
    return '{\n  "action": "readRows",\n  "prefix": "",\n  "limit": 100\n}';
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

  // Bigtable has no connection URL; the identity is project + instance. We pack
  // them as "project\x00instance" so the disconnect path can route on it.
  buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    const project = connection.config.host.trim();
    const instance = connection.config.database.trim();
    return `${project}\x00${instance}`;
  }

  parseConnectionUrl(raw: string): DbConnectionConfig {
    const fallback = this.defaultConnectionConfig();
    const normalized = raw.trim();
    if (!normalized) {
      return fallback;
    }
    // Accept "project/instance" or "project\x00instance".
    const parts = normalized.split(/[\s/\x00]/);
    return {
      ...fallback,
      host: parts[0]?.trim() ?? "",
      database: parts[1]?.trim() ?? "",
    };
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

  // The query body is a JSON scan spec ({action, prefix, rowKey, limit}); the
  // active table comes from tab.databaseName. Malformed bodies fall back to a
  // bounded full scan so the editor never sends garbage.
  buildCommandMessage(tab: DbTab, connection: DbConnection): DbSocketCommandMessage {
    const table = tab.databaseName?.trim() || connection.config.database.trim();
    let spec: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(tab.query || "{}");
      if (parsed && typeof parsed === "object") {
        spec = parsed as Record<string, unknown>;
      }
    } catch {
      spec = {};
    }
    const action =
      typeof spec.action === "string" && spec.action.trim()
        ? spec.action.trim()
        : "readRows";
    return {
      id: tab.id,
      type: "bigtable",
      payload: {
        ...this.authPayload(connection),
        action,
        table,
        prefix: typeof spec.prefix === "string" ? spec.prefix : "",
        rowKey: typeof spec.rowKey === "string" ? spec.rowKey : "",
        limit: typeof spec.limit === "number" ? spec.limit : 100,
      },
    };
  }

  buildTestCommandMessage(connection: DbConnection): DbSocketCommandMessage {
    return {
      id: makeId("db-connect"),
      type: "bigtable",
      payload: {
        ...this.authPayload(connection),
        action: "listTables",
        timeoutMs: 5000,
      },
    };
  }

  buildDisconnectMessage(connection: DbConnection): DbSocketCommandMessage {
    return {
      id: makeId("db-disconnect"),
      type: "dbDisconnect",
      payload: {
        kind: connection.kind,
        // DisconnectConnection routes Bigtable on the `url` arg, which carries
        // "project\x00instance" (matched as a prefix server-side).
        url: this.buildConnectionUrl(connection),
      },
    };
  }

  // authPayload assembles the project/instance/credentials/endpoint fields every
  // Bigtable command shares, reading them from the relabelled config slots.
  private authPayload(connection: DbConnection): Record<string, unknown> {
    const config = connection.config;
    return {
      project: config.host.trim(),
      instance: config.database.trim(),
      credentials: config.serviceName,
      endpoint: config.options.trim(),
    };
  }

  // Table listing is driven by service.ts over the `bigtable` protocol (action
  // "listTables"), not by SQL — these SQL slots are inert.
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
    // Scan specs are JSON — route through the JS/JSON prettier path.
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
    return { label: "BT", class: "theme-method-badge theme-method-post" };
  }

  displayName(): string {
    return "Bigtable";
  }

  describeConnection(connection: DbConnection): string {
    const project = connection.config.host.trim() || "project";
    const instance = connection.config.database.trim();
    return instance ? `${project} / ${instance}` : project;
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

  isWideColumn(): boolean {
    return true;
  }

  // Bigtable uses its own wide-column explorer loader keyed off `isWideColumn()`,
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
    return false;
  }

  treatsSchemaAsDatabase(): boolean {
    return true;
  }

  // --- Explorer action SQL ----------------------------------------------
  // Bigtable has no SQL surface; the interface requires concrete bodies.
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
