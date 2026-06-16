import type {
  DbConnection,
  DbConnectionConfig,
  DbConnectionKind,
  DbTab,
} from "../models";
import type {
  DbCompletionDialect,
  DbConnectionBadge,
  DbExplorerLeafNode,
  DbFormatLanguage,
} from "./types";
import {
  AbstractSqlAdapter,
  appendUrlOptions,
  buildAuthPart,
  parseKeywordDsn,
} from "./base-sql";

export class PostgresAdapter extends AbstractSqlAdapter {
  readonly kind: DbConnectionKind = "postgresql";

  override formatLanguage(): DbFormatLanguage {
    return "postgresql";
  }

  override completionDialect(): DbCompletionDialect {
    return "postgresql";
  }

  override defaultPort(): string {
    return "5432";
  }

  override defaultCompletionSchema(): string | null {
    return "public";
  }

  override buildConnectionUrl(
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
    const url = new URL(`postgresql://${auth}${host}${port ? `:${port}` : ""}${dbPath}`);
    appendUrlOptions(url, config.options);
    return url.toString();
  }

  override parseConnectionUrl(raw: string): DbConnectionConfig {
    const normalized = raw.trim();
    const fallback = this.defaultConnectionConfig();
    if (!normalized) {
      return fallback;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(normalized)) {
      return this.parseStandardUrlConnection(normalized);
    }

    const values = parseKeywordDsn(normalized);
    const reservedKeys = new Set(["host", "port", "user", "password", "dbname"]);
    const options = Array.from(values.entries())
      .filter(([key]) => !reservedKeys.has(key))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    return {
      ...fallback,
      host: values.get("host") || fallback.host,
      port: values.get("port") || fallback.port,
      username: values.get("user") || "",
      password: values.get("password") || "",
      database: values.get("dbname") || "",
      options,
    };
  }

  // PostgreSQL/GaussDB re-point an existing DSN at the tab's database rather
  // than rebuilding the URL, preserving keyword-DSN and query-param forms.
  protected override effectiveDsn(tab: DbTab, connection: DbConnection): string {
    const effectiveDatabase =
      tab.databaseName?.trim() || connection.config.database.trim();
    if (!effectiveDatabase) {
      return this.buildConnectionUrl(connection) || connection.url;
    }
    return this.switchDsnDatabase(
      this.buildConnectionUrl(connection) || connection.url,
      effectiveDatabase,
    );
  }

  override switchDsnDatabase(baseDsn: string, database: string): string {
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(baseDsn)) {
      try {
        const url = new URL(baseDsn);
        url.pathname = database ? `/${encodeURIComponent(database)}` : "/";
        url.searchParams.delete("dbname");
        return url.toString();
      } catch {
        // Fall through to keyword DSN handling below.
      }
    }
    if (/dbname\s*=/i.test(baseDsn)) {
      return baseDsn.replace(/dbname\s*=\s*\S*/i, `dbname=${database}`);
    }
    return `${baseDsn} dbname=${database}`;
  }

  override buildExplorerQuery(): string {
    return `
        SELECT
          table_schema AS schema_name,
          table_name,
          table_type
        FROM information_schema.tables
        WHERE table_schema NOT IN (
          'pg_catalog', 'information_schema',
          'tiger', 'tiger_data', 'topology',
          'pg_toast', 'pg_temp_1', 'pg_toast_temp_1'
        )
        ORDER BY table_schema, table_type, table_name;
      `;
  }

  override buildRoutineExplorerQuery(): string {
    return `
        SELECT
          routine_schema AS schema_name,
          routine_name
        FROM information_schema.routines
        WHERE routine_type = 'FUNCTION'
          AND routine_schema NOT IN (
            'pg_catalog', 'information_schema',
            'tiger', 'tiger_data', 'topology',
            'pg_toast', 'pg_temp_1', 'pg_toast_temp_1'
          )
        ORDER BY routine_schema, routine_name;
      `;
  }

  override formatColumnsQuery(schemaName: string, objectName: string): string {
    return `SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = '${this.escapeString(schemaName)}'
  AND table_name = '${this.escapeString(objectName)}'
ORDER BY ordinal_position;`;
  }

  override buildPrimaryKeyQuery(node: DbExplorerLeafNode): string {
    const schemaName = node.schemaName ?? "public";
    return `SELECT a.attname AS column_name
FROM pg_index i
JOIN pg_class c ON c.oid = i.indrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
WHERE i.indisprimary
  AND n.nspname = '${this.escapeString(schemaName)}'
  AND c.relname = '${this.escapeString(node.label)}'
ORDER BY a.attnum;`;
  }

  override buildIndexesQuery(node: DbExplorerLeafNode): string {
    const schemaName = node.schemaName ?? "public";
    return `SELECT indexname AS index_name, indexdef AS column_name
FROM pg_indexes
WHERE schemaname = '${this.escapeString(schemaName)}'
  AND tablename = '${this.escapeString(node.label)}'
ORDER BY indexname;`;
  }

  override buildConstraintsQuery(node: DbExplorerLeafNode): string {
    const schemaName = node.schemaName ?? "public";
    return `SELECT conname AS constraint_name, contype AS constraint_type,
pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t ON c.conrelid = t.oid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = '${this.escapeString(schemaName)}'
  AND t.relname = '${this.escapeString(node.label)}';`;
  }

  override buildForeignKeysQuery(node: DbExplorerLeafNode): string {
    const schemaName = node.schemaName ?? "public";
    return `SELECT tc.constraint_name, kcu.column_name,
ccu.table_name AS referenced_table_name,
ccu.column_name AS referenced_column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = '${this.escapeString(schemaName)}'
  AND tc.table_name = '${this.escapeString(node.label)}';`;
  }

  override buildDdlQuery(node: DbExplorerLeafNode): string {
    if (node.kind === "function") {
      return this.buildFunctionQuery(node.schemaName ?? "public", node.label);
    }
    const qualifiedName = node.qualifiedName ?? node.label;
    if (node.kind === "view") {
      return `SELECT pg_get_viewdef('${this.escapeString(qualifiedName)}'::regclass, true);`;
    }
    return `SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = '${this.escapeString(node.schemaName ?? "public")}'
  AND table_name = '${this.escapeString(node.label)}'
ORDER BY ordinal_position;`;
  }

  override buildAllColumnsQuery(): string {
    return `SELECT table_schema, table_name, column_name
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema',
  'tiger', 'tiger_data', 'topology', 'pg_toast', 'pg_temp_1', 'pg_toast_temp_1')
ORDER BY table_schema, table_name, ordinal_position;`;
  }

  // --- UI metadata -------------------------------------------------------
  override badge(): DbConnectionBadge {
    return { label: "PG", class: "theme-method-badge theme-method-post" };
  }

  override displayName(): string {
    return "PostgreSQL";
  }

  // --- Explorer action SQL ----------------------------------------------
  override buildStructureQuery(node: DbExplorerLeafNode): string {
    if (node.kind === "function") {
      const schemaName = node.schemaName ?? "";
      return `SELECT routine_schema, routine_name, routine_type, data_type
FROM information_schema.routines
WHERE routine_schema = '${this.escapeString(schemaName)}'
  AND routine_name = '${this.escapeString(node.label)}';`;
    }
    return super.buildStructureQuery(node);
  }

  override buildShowSqlQuery(node: DbExplorerLeafNode): string {
    const qualifiedName = node.qualifiedName ?? node.label;
    const schemaName = node.schemaName ?? "";
    const objectName = node.label;

    if (node.kind === "view") {
      return `SELECT pg_get_viewdef('${this.escapeString(qualifiedName)}'::regclass, true);`;
    }
    if (node.kind === "function") {
      return `SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = '${this.escapeString(schemaName)}'
  AND p.proname = '${this.escapeString(objectName)}';`;
    }
    return `-- PostgreSQL table DDL helper
-- Use pg_dump -s -t ${qualifiedName}
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = '${this.escapeString(schemaName)}'
  AND table_name = '${this.escapeString(objectName)}'
ORDER BY ordinal_position;`;
  }

  // --- Database-level templates ------------------------------------------
  override buildImportTemplate(
    databaseName: string,
    source: "sql" | "json" | "csv",
  ): string {
    if (source === "csv") {
      return `\\c ${databaseName}
\\copy new_table FROM './data.csv' WITH (FORMAT csv, HEADER true);`;
    }
    return super.buildImportTemplate(databaseName, source);
  }

  override buildConnectionSummaryQuery(): string {
    return "SELECT name, setting, unit, short_desc FROM pg_settings ORDER BY name;";
  }
}
