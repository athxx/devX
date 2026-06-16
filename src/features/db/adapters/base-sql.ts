// AbstractSqlAdapter — shared implementation for all relational kinds
// (postgresql, gaussdb, mysql, tidb, clickhouse, oracle, sqlite, sqlserver).
// The base methods encode the historical `default:` branch behavior from
// service.ts; each concrete subclass overrides only the slots where its SQL
// dialect deviates. Every body here is a faithful port of the original
// service.ts function — no behavior change except the documented MySQL
// unique-index fix in parseUniqueFlag().

import { makeId } from "../../../lib/utils";
import type {
  DbConnection,
  DbConnectionConfig,
  DbConnectionKind,
  DbExplorerNode,
  DbObjectConstraint,
  DbObjectForeignKey,
  DbObjectIndex,
  DbResultPayload,
  DbTab,
  DbTabType,
} from "../models";
import type {
  DbSocketCommandMessage,
  SqlExplorerRow,
  SqlExplorerRoutineRow,
} from "./transport-types";
import type {
  DbAdapter,
  DbCompletionDialect,
  DbCompletionKeywords,
  DbConnectionBadge,
  DbExplorerLeafNode,
  DbFormatLanguage,
} from "./types";
import {
  asString,
  escapeSqlString,
  getSqlExplorerValue,
  makeExplorerGroup,
  makeExplorerLeaf,
  normalizeExplorerTableType,
} from "./shared";

export abstract class AbstractSqlAdapter implements DbAdapter {
  abstract readonly kind: DbConnectionKind;

  // --- Defaults ----------------------------------------------------------
  defaultQuery(): string {
    return "SELECT 1;";
  }

  abstract defaultPort(): string;

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

  // --- Connection URL / DSN ----------------------------------------------
  abstract buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string;

  parseConnectionUrl(raw: string): DbConnectionConfig {
    return this.parseStandardUrlConnection(raw);
  }

  switchDsnDatabase(baseDsn: string, _database: string): string {
    // Only PostgreSQL-family DSNs are re-pointable; others keep their DSN.
    return baseDsn;
  }

  // --- Escaping ----------------------------------------------------------
  escapeIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  buildQualifiedName(schemaName: string, objectName: string): string {
    const quotedObjectName = this.escapeIdentifier(objectName);
    const normalizedSchemaName = schemaName.trim();
    if (!normalizedSchemaName || this.collapsesSchema(normalizedSchemaName)) {
      return quotedObjectName;
    }
    return `${this.escapeIdentifier(normalizedSchemaName)}.${quotedObjectName}`;
  }

  /** Schemas that should NOT be prefixed (e.g. sqlite "main"). */
  protected collapsesSchema(_schemaName: string): boolean {
    return false;
  }

  // --- Wire messages -----------------------------------------------------
  buildCommandMessage(tab: DbTab, connection: DbConnection): DbSocketCommandMessage {
    const effectiveUrl = this.effectiveDsn(tab, connection);
    return {
      id: tab.id,
      type: "sql",
      payload: {
        driver: connection.kind,
        dsn: effectiveUrl,
        query: tab.query,
      },
    };
  }

  /** Resolve the DSN for a tab, honoring a tab-level database override. */
  protected effectiveDsn(tab: DbTab, connection: DbConnection): string {
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
      type: "sql",
      payload: {
        driver: connection.kind,
        dsn: connection.url,
        query: this.defaultQuery(),
      },
    };
  }

  buildDisconnectMessage(connection: DbConnection): DbSocketCommandMessage {
    return {
      id: makeId("db-disconnect"),
      type: "dbDisconnect",
      payload: {
        kind: connection.kind,
        driver: connection.kind,
        dsn: this.buildConnectionUrl(connection) || connection.url.trim(),
      },
    };
  }

  // --- Explorer ----------------------------------------------------------
  abstract buildExplorerQuery(): string;

  buildRoutineExplorerQuery(): string | null {
    return null;
  }

  buildExplorerNodes(
    connection: DbConnection,
    rows: SqlExplorerRow[],
    routineRows: SqlExplorerRoutineRow[] = [],
  ): DbExplorerNode[] {
    const schemas = new Map<
      string,
      {
        tables: DbExplorerNode[];
        views: DbExplorerNode[];
        functions: DbExplorerNode[];
      }
    >();

    const fallbackSchema = () =>
      connection.config.database.trim() || this.defaultExplorerSchema();

    for (const row of rows) {
      const objectName = asString(getSqlExplorerValue(row, "table_name"));
      const schemaName =
        asString(getSqlExplorerValue(row, "schema_name")) || fallbackSchema();
      const bucket =
        schemas.get(schemaName) ?? { tables: [], views: [], functions: [] };
      const objectType = normalizeExplorerTableType(
        getSqlExplorerValue(row, "table_type"),
      );
      const leaf = makeExplorerLeaf(
        objectType,
        objectName,
        this.buildObjectQuery(schemaName, objectName),
        objectType === "view" ? "View" : "Table",
        this.buildCountQuery(schemaName, objectName),
        {
          schemaName,
          qualifiedName: this.buildQualifiedName(schemaName, objectName),
        },
      );

      if (objectType === "view") {
        bucket.views.push(leaf);
      } else {
        bucket.tables.push(leaf);
      }

      schemas.set(schemaName, bucket);
    }

    for (const row of routineRows) {
      const functionName = asString(getSqlExplorerValue(row, "routine_name"));
      const schemaName =
        asString(getSqlExplorerValue(row, "schema_name")) || fallbackSchema();
      const bucket =
        schemas.get(schemaName) ?? { tables: [], views: [], functions: [] };

      bucket.functions.push(
        makeExplorerLeaf(
          "function",
          functionName,
          this.buildFunctionQuery(schemaName, functionName),
          "Function",
          undefined,
          {
            schemaName,
            qualifiedName: this.buildQualifiedName(schemaName, functionName),
          },
        ),
      );

      schemas.set(schemaName, bucket);
    }

    return Array.from(schemas.entries())
      .sort(([schemaA], [schemaB]) => schemaA.localeCompare(schemaB))
      .map(([schemaName, bucket]) => {
        const children: DbExplorerNode[] = [];
        if (bucket.tables.length > 0) {
          children.push(
            makeExplorerGroup(
              "Tables",
              "category",
              bucket.tables.sort((a, b) => a.label.localeCompare(b.label)),
              `${bucket.tables.length} objects`,
            ),
          );
        }
        if (bucket.views.length > 0) {
          children.push(
            makeExplorerGroup(
              "Views",
              "category",
              bucket.views.sort((a, b) => a.label.localeCompare(b.label)),
              `${bucket.views.length} objects`,
            ),
          );
        }
        if (bucket.functions.length > 0) {
          children.push(
            makeExplorerGroup(
              "Functions",
              "category",
              bucket.functions.sort((a, b) => a.label.localeCompare(b.label)),
              `${bucket.functions.length} objects`,
            ),
          );
        }

        return makeExplorerGroup(schemaName, this.explorerSchemaGroupKind(), children);
      });
  }

  /** Default schema label when a row has none (overridden by sqlite). */
  protected defaultExplorerSchema(): string {
    return "default";
  }

  /** Whether top-level schema groups are "database" or "schema" flavored. */
  protected explorerSchemaGroupKind(): "database" | "schema" {
    return "schema";
  }

  // --- Object queries ----------------------------------------------------
  buildObjectQuery(
    schemaName: string,
    objectName: string,
    page = 1,
    pageSize = 200,
  ): string {
    const qualifiedName = this.buildQualifiedName(schemaName, objectName);
    const offset = Math.max(0, (page - 1) * pageSize);
    return this.formatLimitedSelect(qualifiedName, offset, pageSize);
  }

  protected formatLimitedSelect(
    qualifiedName: string,
    _offset: number,
    pageSize: number,
  ): string {
    return `SELECT * FROM ${qualifiedName} LIMIT ${pageSize};`;
  }

  buildCountQuery(schemaName: string, objectName: string): string {
    return `SELECT COUNT(*) AS total FROM ${this.buildQualifiedName(
      schemaName,
      objectName,
    )};`;
  }

  buildFunctionQuery(schemaName: string, functionName: string): string {
    const qualifiedName = this.buildQualifiedName(schemaName, functionName);
    return `-- Replace parameters as needed\nSELECT ${qualifiedName}();`;
  }

  buildObjectColumnsQuery(node: DbExplorerNode): string {
    if (node.kind === "group") {
      return "SELECT 1;";
    }
    const schemaName = node.schemaName ?? "public";
    return this.formatColumnsQuery(schemaName, node.label, node);
  }

  protected formatColumnsQuery(
    _schemaName: string,
    _objectName: string,
    node: DbExplorerLeafNode,
  ): string {
    return `SELECT * FROM ${node.qualifiedName ?? node.label} LIMIT 1;`;
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
    if (node.kind === "function") {
      return this.buildFunctionQuery(node.schemaName ?? "public", node.label);
    }
    return `SELECT * FROM ${node.qualifiedName ?? node.label};`;
  }

  // --- Result parsing ----------------------------------------------------
  parsePrimaryKeyResult(result: DbResultPayload): string[] {
    if (result.kind !== "sql" || !Array.isArray(result.data.rows)) {
      return [];
    }
    return result.data.rows
      .map((row) => asString(row.column_name ?? row.name))
      .filter(Boolean);
  }

  parseIndexesResult(result: DbResultPayload): DbObjectIndex[] {
    if (result.kind !== "sql" || !Array.isArray(result.data.rows)) {
      return [];
    }

    const buckets = new Map<string, DbObjectIndex>();
    for (const row of result.data.rows) {
      const name = asString(
        row.index_name ?? row.name ?? row.constraint_name ?? row.key_name,
      );
      if (!name) continue;
      const column = asString(
        row.column_name ?? row.attname ?? row.column_names ?? row.expression,
      );
      const bucket = buckets.get(name) ?? {
        name,
        columns: [],
        unique: this.parseUniqueFlag(row),
        primary: ["primary", "p"].includes(
          asString(row.index_type ?? row.constraint_type).toLowerCase(),
        ),
      };
      if (column) {
        bucket.columns = [...bucket.columns, column];
      }
      buckets.set(name, bucket);
    }

    return Array.from(buckets.values());
  }

  /**
   * Resolve an index's uniqueness from whatever flag the dialect emitted.
   * MySQL/TiDB expose `non_unique` where "0" means unique; everyone else uses
   * an `is_unique`/`unique` truthy flag.
   *
   * Fixes the prior bug (service.ts:2088) where a present `non_unique` was
   * only honored when one of is_unique/non_unique/unique was already truthy —
   * so non_unique="0" (the unique case) returned `false` instead of `true`.
   */
  protected parseUniqueFlag(row: Record<string, unknown>): boolean | undefined {
    const nonUnique = row.non_unique;
    if (nonUnique !== undefined && nonUnique !== null && asString(nonUnique) !== "") {
      return asString(nonUnique) === "0";
    }
    const flag = asString(row.is_unique ?? row.unique).toLowerCase();
    if (flag === "") return undefined;
    return ["1", "true", "yes"].includes(flag);
  }

  parseConstraintsResult(result: DbResultPayload): DbObjectConstraint[] {
    if (result.kind !== "sql" || !Array.isArray(result.data.rows)) {
      return [];
    }
    return result.data.rows
      .map((row) => ({
        name: asString(row.constraint_name ?? row.name),
        type: asString(row.constraint_type ?? row.type),
        definition: asString(row.definition ?? row.check_clause ?? row.condition),
      }))
      .filter((item) => item.name);
  }

  parseForeignKeysResult(result: DbResultPayload): DbObjectForeignKey[] {
    if (result.kind !== "sql" || !Array.isArray(result.data.rows)) {
      return [];
    }
    const buckets = new Map<string, DbObjectForeignKey>();
    for (const row of result.data.rows) {
      const name = asString(row.constraint_name ?? row.name);
      if (!name) continue;
      const column = asString(row.column_name);
      const referencedColumn = asString(
        row.referenced_column_name ?? row.foreign_column_name,
      );
      const referencedTable = asString(
        row.referenced_table_name ?? row.foreign_table_name,
      );
      const bucket = buckets.get(name) ?? {
        name,
        columns: [],
        referencedTable,
        referencedColumns: [],
      };
      if (column) bucket.columns = [...bucket.columns, column];
      if (referencedColumn) {
        bucket.referencedColumns = [...bucket.referencedColumns, referencedColumn];
      }
      if (!bucket.referencedTable && referencedTable) {
        bucket.referencedTable = referencedTable;
      }
      buckets.set(name, bucket);
    }
    return Array.from(buckets.values());
  }

  // --- Completion --------------------------------------------------------
  buildAllColumnsQuery(): string | null {
    return null;
  }

  defaultCompletionSchema(
    _connection: DbConnection,
    _databaseName?: string | null,
  ): string | null {
    return null;
  }

  // --- Editor / formatting metadata -------------------------------------
  // Generic SQL dialect; subclasses override with their sql-formatter language.
  formatLanguage(): DbFormatLanguage {
    return "sql";
  }

  completionKeywords(): DbCompletionKeywords {
    return "sql";
  }

  // Generic ANSI dialect; SQL subclasses override with their CodeMirror dialect.
  completionDialect(): DbCompletionDialect {
    return "standard";
  }

  /** Derive the quote char from the dialect's identifier escaping. */
  identifierQuoteChar(): string {
    return this.escapeIdentifier("x").charAt(0);
  }

  // --- UI metadata -------------------------------------------------------
  // The base provides a neutral fallback; concrete kinds override.
  badge(): DbConnectionBadge {
    return { label: "DB", class: "theme-method-badge theme-method-default" };
  }

  displayName(): string {
    return "Database";
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
    return false;
  }

  // --- Explorer action SQL ----------------------------------------------
  buildStructureQuery(node: DbExplorerLeafNode): string {
    const qualifiedName = node.qualifiedName ?? node.label;
    const schemaName = node.schemaName ?? "";
    const objectName = node.label;

    if (node.kind === "function") {
      return `-- Function metadata template\n-- ${qualifiedName}`;
    }

    return `SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = '${escapeSqlString(schemaName)}'
  AND table_name = '${escapeSqlString(objectName)}'
ORDER BY ordinal_position;`;
  }

  buildShowSqlQuery(node: DbExplorerLeafNode): string {
    const qualifiedName = node.qualifiedName ?? node.label;

    if (node.kind === "function") {
      return `-- Function DDL template\n-- ${qualifiedName}`;
    }

    return `-- DDL helper\n-- ${qualifiedName}`;
  }

  buildRenameQuery(node: DbExplorerLeafNode): string {
    const qualifiedName = node.qualifiedName ?? node.label;
    return `ALTER TABLE ${qualifiedName} RENAME TO new_${node.label};`;
  }

  buildTruncateQuery(node: DbExplorerLeafNode): string {
    const qualifiedName = node.qualifiedName ?? node.label;
    return `TRUNCATE TABLE ${qualifiedName};`;
  }

  // --- Database-level templates ------------------------------------------
  buildCreateDatabaseTemplate(): string {
    return "CREATE DATABASE new_database;";
  }

  buildCreateTableTemplate(databaseName: string): string {
    return `CREATE TABLE ${databaseName}.new_table (
  id BIGINT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;
  }

  buildImportTemplate(
    databaseName: string,
    source: "sql" | "json" | "csv",
  ): string {
    if (source === "json") {
      return `-- Import JSON into ${databaseName}
-- Replace file paths and table names as needed
-- Example workflow: stage JSON -> transform -> insert`;
    }
    if (source === "csv") {
      return `-- Import CSV into ${databaseName}
-- Replace file paths and table names as needed`;
    }
    return `-- Import SQL into ${databaseName}
-- Paste your schema/data script here`;
  }

  buildDropDatabaseTemplate(databaseName: string): string {
    return `DROP DATABASE ${databaseName};`;
  }

  buildConnectionSummaryQuery(): string {
    return "SELECT 1;";
  }

  // Helpers shared by SQL subclasses -------------------------------------
  protected escapeString(value: string): string {
    return escapeSqlString(value);
  }

  protected parseStandardUrlConnection(raw: string): DbConnectionConfig {
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
        options: formatSearchParams(url),
      };
    } catch {
      return fallback;
    }
  }
}

// Shared URL helpers (kept module-local; mirror service.ts originals) --------

export function encodeCredentialPart(value: string) {
  return encodeURIComponent(value);
}

export function parseOptionEntries(options: string) {
  const normalized = options.trim().replace(/^\?/, "");
  if (!normalized) {
    return [] as Array<[string, string]>;
  }
  return Array.from(new URLSearchParams(normalized).entries()).filter(
    ([key]) => key.trim().length > 0,
  );
}

export function appendUrlOptions(url: URL, options: string) {
  for (const [key, value] of parseOptionEntries(options)) {
    url.searchParams.set(key, value);
  }
}

export function formatSearchParams(url: URL, ignoredKeys: string[] = []): string {
  const params = new URLSearchParams(url.search);
  for (const key of ignoredKeys) {
    params.delete(key);
  }
  return params.toString();
}

export function buildAuthPart(username: string, password: string) {
  return username || password
    ? `${encodeCredentialPart(username)}${
        password ? `:${encodeCredentialPart(password)}` : ""
      }@`
    : "";
}

/** PostgreSQL/GaussDB libpq keyword-DSN helpers, shared by both adapters. */
export function formatKeywordValue(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  if (/[\s'"]/u.test(normalized)) {
    return `'${normalized.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }
  return normalized;
}

export function buildKeywordDsn(parts: Array<[string, string]>, options: string) {
  const result: string[] = [];
  for (const [key, value] of parts) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    result.push(`${key}=${formatKeywordValue(normalized)}`);
  }
  for (const [key, value] of parseOptionEntries(options)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      continue;
    }
    result.push(`${normalizedKey}=${formatKeywordValue(value)}`);
  }
  return result.join(" ");
}

export function parseKeywordDsn(raw: string) {
  const values = new Map<string, string>();
  const pattern = /(\w+)=('(?:\\.|[^'])*'|"(?:\\.|[^"])*"|[^\s]+)/g;
  for (const match of raw.matchAll(pattern)) {
    const key = match[1]?.trim();
    let value = match[2] ?? "";
    if (!key) continue;
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    values.set(key, value);
  }
  return values;
}
