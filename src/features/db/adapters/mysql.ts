import type {
  DbConnection,
  DbConnectionConfig,
  DbConnectionKind,
} from "../models";
import type {
  DbCompletionDialect,
  DbConnectionBadge,
  DbExplorerLeafNode,
  DbFormatLanguage,
} from "./types";
import { AbstractSqlAdapter, parseOptionEntries } from "./base-sql";

export class MySqlAdapter extends AbstractSqlAdapter {
  readonly kind: DbConnectionKind = "mysql";

  /** TiDB sets a default charset; MySQL does not. */
  protected get treatAsTiDb(): boolean {
    return false;
  }

  override formatLanguage(): DbFormatLanguage {
    return "mysql";
  }

  override completionDialect(): DbCompletionDialect {
    return "mysql";
  }

  override defaultPort(): string {
    return "3306";
  }

  override escapeIdentifier(value: string): string {
    return `\`${value.replace(/`/g, "``")}\``;
  }

  override defaultExplorerSchema(): string {
    return "default";
  }

  override explorerSchemaGroupKind(): "database" | "schema" {
    return "database";
  }

  override defaultCompletionSchema(
    connection: DbConnection,
    databaseName?: string | null,
  ): string | null {
    return databaseName || connection.config.database || null;
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

    const auth =
      username || password ? `${username}${password ? `:${password}` : ""}@` : "";
    const params = new URLSearchParams(parseOptionEntries(config.options));
    if (this.treatAsTiDb && !params.has("charset")) {
      params.set("charset", "utf8mb4");
    }

    return `${auth}tcp(${host}${port ? `:${port}` : ""})/${database}${
      params.toString() ? `?${params.toString()}` : ""
    }`;
  }

  override parseConnectionUrl(raw: string): DbConnectionConfig {
    const normalized = raw.trim();
    const fallback = this.defaultConnectionConfig();
    if (!normalized) {
      return fallback;
    }
    const match =
      normalized.match(
        /^(?:(?<auth>[^@/]+)@)?tcp\((?<address>[^)]*)\)\/(?<database>[^?]*)(?:\?(?<query>.*))?$/u,
      ) ?? [];
    const groups = "groups" in match ? match.groups ?? {} : {};
    const address = String(groups.address ?? "");
    const lastColon = address.lastIndexOf(":");
    const host = lastColon >= 0 ? address.slice(0, lastColon) : address;
    const port = lastColon >= 0 ? address.slice(lastColon + 1) : fallback.port;
    const auth = String(groups.auth ?? "");
    const authSeparator = auth.indexOf(":");
    return {
      ...fallback,
      host: host || fallback.host,
      port,
      username: authSeparator >= 0 ? auth.slice(0, authSeparator) : auth,
      password: authSeparator >= 0 ? auth.slice(authSeparator + 1) : "",
      database: decodeURIComponent(String(groups.database ?? "")),
      options: String(groups.query ?? ""),
    };
  }

  override buildExplorerQuery(): string {
    return `
        SELECT
          table_schema AS schema_name,
          table_name,
          table_type
        FROM information_schema.tables
        WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
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
          AND routine_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        ORDER BY routine_schema, routine_name;
      `;
  }

  override formatColumnsQuery(schemaName: string, objectName: string): string {
    return `SELECT column_name, column_type, is_nullable, column_default, extra
FROM information_schema.columns
WHERE table_schema = '${this.escapeString(schemaName)}'
  AND table_name = '${this.escapeString(objectName)}'
ORDER BY ordinal_position;`;
  }

  override buildPrimaryKeyQuery(node: DbExplorerLeafNode): string {
    const schemaName = node.schemaName ?? "public";
    return `SELECT column_name
FROM information_schema.key_column_usage
WHERE table_schema = '${this.escapeString(schemaName)}'
  AND table_name = '${this.escapeString(node.label)}'
  AND constraint_name = 'PRIMARY'
ORDER BY ordinal_position;`;
  }

  override buildIndexesQuery(node: DbExplorerLeafNode): string {
    const schemaName = node.schemaName ?? "public";
    return `SELECT index_name, column_name, non_unique
FROM information_schema.statistics
WHERE table_schema = '${this.escapeString(schemaName)}'
  AND table_name = '${this.escapeString(node.label)}'
ORDER BY index_name, seq_in_index;`;
  }

  override buildConstraintsQuery(node: DbExplorerLeafNode): string {
    const schemaName = node.schemaName ?? "public";
    return `SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = '${this.escapeString(schemaName)}'
  AND table_name = '${this.escapeString(node.label)}';`;
  }

  override buildForeignKeysQuery(node: DbExplorerLeafNode): string {
    const schemaName = node.schemaName ?? "public";
    return `SELECT constraint_name, column_name, referenced_table_name, referenced_column_name
FROM information_schema.key_column_usage
WHERE table_schema = '${this.escapeString(schemaName)}'
  AND table_name = '${this.escapeString(node.label)}'
  AND referenced_table_name IS NOT NULL;`;
  }

  override buildDdlQuery(node: DbExplorerLeafNode): string {
    if (node.kind === "function") {
      return this.buildFunctionQuery(node.schemaName ?? "public", node.label);
    }
    return `SHOW CREATE TABLE ${node.qualifiedName ?? node.label};`;
  }

  override buildAllColumnsQuery(): string {
    return `SELECT table_schema, table_name, column_name
FROM information_schema.columns
WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
ORDER BY table_schema, table_name, ordinal_position;`;
  }

  // --- UI metadata -------------------------------------------------------
  override badge(): DbConnectionBadge {
    return { label: "MY", class: "theme-method-badge theme-method-get" };
  }

  override displayName(): string {
    return "MySQL";
  }

  override treatsSchemaAsDatabase(): boolean {
    return true;
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
    return `DESCRIBE ${node.qualifiedName ?? node.label};`;
  }

  override buildShowSqlQuery(node: DbExplorerLeafNode): string {
    const qualifiedName = node.qualifiedName ?? node.label;
    if (node.kind === "view") {
      return `SHOW CREATE VIEW ${qualifiedName};`;
    }
    if (node.kind === "function") {
      return `SHOW CREATE FUNCTION ${qualifiedName};`;
    }
    return `SHOW CREATE TABLE ${qualifiedName};`;
  }

  override buildRenameQuery(node: DbExplorerLeafNode): string {
    return `RENAME TABLE ${node.qualifiedName ?? node.label} TO new_${node.label};`;
  }

  // --- Database-level templates ------------------------------------------
  override buildCreateDatabaseTemplate(): string {
    return "CREATE DATABASE `new_database`;";
  }

  override buildCreateTableTemplate(databaseName: string): string {
    return `USE \`${databaseName}\`;

CREATE TABLE new_table (
  id BIGINT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;
  }

  override buildImportTemplate(
    databaseName: string,
    source: "sql" | "json" | "csv",
  ): string {
    if (source === "csv") {
      return `USE \`${databaseName}\`;
LOAD DATA LOCAL INFILE './data.csv'
INTO TABLE new_table
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 LINES;`;
    }
    return super.buildImportTemplate(databaseName, source);
  }

  override buildDropDatabaseTemplate(databaseName: string): string {
    return `DROP DATABASE \`${databaseName}\`;`;
  }

  override buildConnectionSummaryQuery(): string {
    return "SHOW VARIABLES;";
  }
}
