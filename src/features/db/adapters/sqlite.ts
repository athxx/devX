import type {
  DbConnection,
  DbConnectionConfig,
  DbObjectIndex,
  DbResultPayload,
} from "../models";
import type {
  DbCompletionDialect,
  DbConnectionBadge,
  DbExplorerLeafNode,
  DbFormatLanguage,
} from "./types";
import { AbstractSqlAdapter } from "./base-sql";
import { asString } from "./shared";

export class SqliteAdapter extends AbstractSqlAdapter {
  readonly kind = "sqlite" as const;

  override formatLanguage(): DbFormatLanguage {
    return "sqlite";
  }

  override completionDialect(): DbCompletionDialect {
    return "sqlite";
  }

  override defaultQuery(): string {
    return "SELECT sqlite_version();";
  }

  override defaultPort(): string {
    return "";
  }

  override defaultConnectionConfig(): DbConnectionConfig {
    return {
      ...super.defaultConnectionConfig(),
      filePath: "./asonx.db",
    };
  }

  override collapsesSchema(schemaName: string): boolean {
    return schemaName === "main";
  }

  override defaultExplorerSchema(): string {
    return "main";
  }

  override buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    return connection.config.filePath.trim() || connection.url.trim();
  }

  override parseConnectionUrl(raw: string): DbConnectionConfig {
    return {
      ...this.defaultConnectionConfig(),
      filePath: raw.trim() || this.defaultConnectionConfig().filePath,
    };
  }

  override buildExplorerQuery(): string {
    return `
        SELECT
          'main' AS schema_name,
          name AS table_name,
          CASE
            WHEN type = 'view' THEN 'VIEW'
            ELSE 'BASE TABLE'
          END AS table_type
        FROM sqlite_master
        WHERE type IN ('table', 'view')
          AND name NOT LIKE 'sqlite_%'
        ORDER BY type, name;
      `;
  }

  override formatColumnsQuery(_schemaName: string, objectName: string): string {
    return `PRAGMA table_info(${this.escapeIdentifier(objectName)});`;
  }

  override buildPrimaryKeyQuery(node: DbExplorerLeafNode): string {
    return `PRAGMA table_info(${this.escapeIdentifier(node.label)});`;
  }

  override buildIndexesQuery(node: DbExplorerLeafNode): string {
    return `PRAGMA index_list(${this.escapeIdentifier(node.label)});`;
  }

  override buildDdlQuery(node: DbExplorerLeafNode): string {
    if (node.kind === "function") {
      return this.buildFunctionQuery(node.schemaName ?? "public", node.label);
    }
    return `SELECT sql FROM sqlite_master WHERE name = '${this.escapeString(node.label)}';`;
  }

  override parsePrimaryKeyResult(result: DbResultPayload): string[] {
    const standard = super.parsePrimaryKeyResult(result);
    if (standard.length > 0 || result.kind !== "sql" || !Array.isArray(result.data.rows)) {
      return standard;
    }
    // SQLite's PRAGMA table_info shape: PK columns are those with pk > 0.
    return result.data.rows
      .filter((row) => Number(row.pk ?? 0) > 0)
      .map((row) => asString(row.name ?? row.column_name))
      .filter(Boolean);
  }

  override parseIndexesResult(result: DbResultPayload): DbObjectIndex[] {
    if (result.kind !== "sql" || !Array.isArray(result.data.rows)) {
      return [];
    }
    return result.data.rows
      .map((row) => ({
        name: asString(row.name),
        columns: [] as string[],
        unique: Number(row.unique ?? 0) > 0,
        primary: false,
      }))
      .filter((item) => item.name);
  }

  // SQLite has no single all-columns query; service.ts uses a per-table PRAGMA
  // sweep (loadSqliteSchemaCompletion) when buildAllColumnsQuery() is null.

  // --- UI metadata -------------------------------------------------------
  override badge(): DbConnectionBadge {
    return { label: "LITE", class: "theme-method-badge theme-method-default" };
  }

  override displayName(): string {
    return "SQLite";
  }

  override describeConnection(connection: DbConnection): string {
    return connection.config.filePath.trim() || "Local file";
  }

  // --- Capabilities ------------------------------------------------------
  override canCreateDatabase(): boolean {
    return false;
  }

  // --- Explorer action SQL ----------------------------------------------
  override buildStructureQuery(node: DbExplorerLeafNode): string {
    if (node.kind === "function") {
      return super.buildStructureQuery(node);
    }
    return `PRAGMA table_info(${node.qualifiedName ?? node.label});`;
  }

  override buildShowSqlQuery(node: DbExplorerLeafNode): string {
    if (node.kind === "function") {
      return super.buildShowSqlQuery(node);
    }
    return `SELECT sql
FROM sqlite_master
WHERE type = 'table'
  AND name = '${this.escapeString(node.label)}';`;
  }

  override buildTruncateQuery(node: DbExplorerLeafNode): string {
    return `DELETE FROM ${node.qualifiedName ?? node.label};`;
  }

  override buildConnectionSummaryQuery(): string {
    return "PRAGMA compile_options;";
  }
}
