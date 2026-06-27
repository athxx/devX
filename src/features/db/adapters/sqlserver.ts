import type { DbConnection, DbSortOrder } from "../models";
import type {
  DbCompletionDialect,
  DbConnectionBadge,
  DbExplorerLeafNode,
  DbFormatLanguage,
} from "./types";
import { AbstractSqlAdapter, appendUrlOptions, buildAuthPart } from "./base-sql";

export class SqlServerAdapter extends AbstractSqlAdapter {
  readonly kind = "sqlserver" as const;

  override formatLanguage(): DbFormatLanguage {
    return "transactsql";
  }

  override completionDialect(): DbCompletionDialect {
    return "mssql";
  }

  override defaultPort(): string {
    return "1433";
  }

  override escapeIdentifier(value: string): string {
    return `[${value.replace(/]/g, "]]")}]`;
  }

  override defaultCompletionSchema(): string | null {
    return "dbo";
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
    const url = new URL(`sqlserver://${auth}${host}${port ? `:${port}` : ""}`);
    if (database) {
      url.searchParams.set("database", database);
    }
    appendUrlOptions(url, config.options);
    return url.toString();
  }

  override formatLimitedSelect(
    qualifiedName: string,
    offset: number,
    pageSize: number,
    orderBy?: DbSortOrder,
  ): string {
    // OFFSET/FETCH requires an ORDER BY; fall back to ordinal 1 when unsorted.
    const order = orderBy?.column
      ? `${this.escapeIdentifier(orderBy.column)} ${orderBy.dir === "desc" ? "DESC" : "ASC"}`
      : "1";
    return `SELECT * FROM ${qualifiedName} ORDER BY ${order} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY;`;
  }

  override buildExplorerQuery(): string {
    return `
        SELECT
          TABLE_SCHEMA AS schema_name,
          TABLE_NAME AS table_name,
          TABLE_TYPE AS table_type
        FROM INFORMATION_SCHEMA.TABLES
        ORDER BY TABLE_SCHEMA, TABLE_TYPE, TABLE_NAME;
      `;
  }

  override buildRoutineExplorerQuery(): string {
    return `
        SELECT
          ROUTINE_SCHEMA AS schema_name,
          ROUTINE_NAME AS routine_name
        FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_TYPE = 'FUNCTION'
        ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME;
      `;
  }

  override formatColumnsQuery(schemaName: string, objectName: string): string {
    return `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = '${this.escapeString(schemaName)}'
  AND TABLE_NAME = '${this.escapeString(objectName)}'
ORDER BY ORDINAL_POSITION;`;
  }

  override buildPrimaryKeyQuery(node: DbExplorerLeafNode): string {
    const schemaName = node.schemaName ?? "public";
    return `SELECT c.COLUMN_NAME AS column_name
FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE c
  ON tc.CONSTRAINT_NAME = c.CONSTRAINT_NAME
WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
  AND tc.TABLE_SCHEMA = '${this.escapeString(schemaName)}'
  AND tc.TABLE_NAME = '${this.escapeString(node.label)}'
ORDER BY c.ORDINAL_POSITION;`;
  }

  override buildIndexesQuery(node: DbExplorerLeafNode): string {
    const schemaName = node.schemaName ?? "public";
    return `SELECT i.name AS index_name, c.name AS column_name, i.is_unique
FROM sys.indexes i
JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
JOIN sys.tables t ON i.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = '${this.escapeString(schemaName)}'
  AND t.name = '${this.escapeString(node.label)}'
ORDER BY i.name, ic.key_ordinal;`;
  }

  override buildConstraintsQuery(node: DbExplorerLeafNode): string {
    const schemaName = node.schemaName ?? "public";
    return `SELECT tc.CONSTRAINT_NAME AS constraint_name, tc.CONSTRAINT_TYPE AS constraint_type
FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
WHERE tc.TABLE_SCHEMA = '${this.escapeString(schemaName)}'
  AND tc.TABLE_NAME = '${this.escapeString(node.label)}';`;
  }

  override buildForeignKeysQuery(node: DbExplorerLeafNode): string {
    const schemaName = node.schemaName ?? "public";
    return `SELECT fk.name AS constraint_name,
pc.name AS column_name,
rt.name AS referenced_table_name,
rc.name AS referenced_column_name
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
JOIN sys.tables pt ON fkc.parent_object_id = pt.object_id
JOIN sys.columns pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id
JOIN sys.tables rt ON fkc.referenced_object_id = rt.object_id
JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
JOIN sys.schemas s ON pt.schema_id = s.schema_id
WHERE s.name = '${this.escapeString(schemaName)}'
  AND pt.name = '${this.escapeString(node.label)}';`;
  }

  override buildAllColumnsQuery(): string {
    return `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, COLUMN_NAME AS column_name
FROM INFORMATION_SCHEMA.COLUMNS
ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION;`;
  }

  // --- UI metadata -------------------------------------------------------
  override badge(): DbConnectionBadge {
    return { label: "MSS", class: "theme-method-badge theme-method-post" };
  }

  override displayName(): string {
    return "SQL Server";
  }

  // --- Explorer action SQL ----------------------------------------------
  override buildStructureQuery(node: DbExplorerLeafNode): string {
    if (node.kind === "function") {
      return super.buildStructureQuery(node);
    }
    const schemaName = node.schemaName ?? "";
    return `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = '${this.escapeString(schemaName)}'
  AND TABLE_NAME = '${this.escapeString(node.label)}'
ORDER BY ORDINAL_POSITION;`;
  }

  override buildRenameQuery(node: DbExplorerLeafNode): string {
    const qualifiedName = node.qualifiedName ?? node.label;
    return `EXEC sp_rename '${qualifiedName.replace(/'/g, "''")}', 'new_${node.label}';`;
  }

  // --- Database-level templates ------------------------------------------
  override buildCreateDatabaseTemplate(): string {
    return "CREATE DATABASE [new_database];";
  }

  override buildCreateTableTemplate(databaseName: string): string {
    return `USE [${databaseName}];

CREATE TABLE dbo.new_table (
  id BIGINT PRIMARY KEY,
  name NVARCHAR(255) NOT NULL,
  created_at DATETIME2 DEFAULT SYSDATETIME()
);`;
  }

  override buildDropDatabaseTemplate(databaseName: string): string {
    return `DROP DATABASE [${databaseName}];`;
  }

  override buildConnectionSummaryQuery(): string {
    return "SELECT name, value_in_use, description FROM sys.configurations ORDER BY name;";
  }

  // T-SQL has no inline EXPLAIN; the estimated plan comes from a session-level
  // SET SHOWPLAN toggle that must be its own batch, which doesn't fit the
  // single-statement Explain action. Disable the action for SQL Server.
  override buildExplainQuery(): string | null {
    return null;
  }
}
