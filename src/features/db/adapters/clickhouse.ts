import type { DbConnection } from "../models";
import type { DbConnectionBadge, DbExplorerLeafNode } from "./types";
import { AbstractSqlAdapter, appendUrlOptions, buildAuthPart } from "./base-sql";

export class ClickHouseAdapter extends AbstractSqlAdapter {
  readonly kind = "clickhouse" as const;

  override defaultQuery(): string {
    return "SELECT 1";
  }

  override defaultPort(): string {
    return "8123";
  }

  override escapeIdentifier(value: string): string {
    return `\`${value.replace(/`/g, "``")}\``;
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

    const auth = buildAuthPart(username, password);
    const dbPath = database ? `/${encodeURIComponent(database)}` : "";
    const url = new URL(`clickhouse://${auth}${host}${port ? `:${port}` : ""}${dbPath}`);
    appendUrlOptions(url, config.options);
    return url.toString();
  }

  override buildExplorerQuery(): string {
    return `
        SELECT
          database AS schema_name,
          name AS table_name,
          if(engine = 'View', 'VIEW', 'BASE TABLE') AS table_type
        FROM system.tables
        WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
        ORDER BY database, table_type, table_name;
      `;
  }

  override buildDdlQuery(node: DbExplorerLeafNode): string {
    if (node.kind === "function") {
      return this.buildFunctionQuery(node.schemaName ?? "public", node.label);
    }
    return `SHOW CREATE TABLE ${node.qualifiedName ?? node.label};`;
  }

  override buildAllColumnsQuery(): string {
    return `SELECT database AS table_schema, table AS table_name, name AS column_name
FROM system.columns
WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
ORDER BY database, table, position;`;
  }

  // --- UI metadata -------------------------------------------------------
  override badge(): DbConnectionBadge {
    return { label: "CHK", class: "theme-method-badge theme-method-head" };
  }

  override displayName(): string {
    return "ClickHouse";
  }

  override treatsSchemaAsDatabase(): boolean {
    return true;
  }

  // --- Explorer action SQL ----------------------------------------------
  override buildStructureQuery(node: DbExplorerLeafNode): string {
    if (node.kind === "function") {
      return super.buildStructureQuery(node);
    }
    return `DESCRIBE ${node.qualifiedName ?? node.label};`;
  }

  override buildShowSqlQuery(node: DbExplorerLeafNode): string {
    if (node.kind === "function") {
      return super.buildShowSqlQuery(node);
    }
    return `SHOW CREATE TABLE ${node.qualifiedName ?? node.label};`;
  }

  override buildRenameQuery(node: DbExplorerLeafNode): string {
    return `RENAME TABLE ${node.qualifiedName ?? node.label} TO new_${node.label};`;
  }

  // --- Database-level templates ------------------------------------------
  override buildCreateTableTemplate(databaseName: string): string {
    return `CREATE TABLE ${databaseName}.new_table (
  id UInt64,
  name String,
  created_at DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY id;`;
  }

  override buildConnectionSummaryQuery(): string {
    return "SELECT name, value, changed, description FROM system.settings ORDER BY name;";
  }
}
