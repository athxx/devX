import type { DbConnection, DbConnectionConfig, DbSortOrder } from "../models";
import type { DbConnectionBadge, DbExplorerLeafNode, DbFormatLanguage } from "./types";
import {
  AbstractSqlAdapter,
  appendUrlOptions,
  buildAuthPart,
  formatSearchParams,
} from "./base-sql";

// Dameng (达梦 DM8) is highly Oracle-compatible: it exposes the same
// user_tables / user_views / user_tab_columns catalog views, the `dual` table,
// uppercase identifiers, and `OFFSET … ROWS FETCH NEXT` pagination. It differs
// only in its connection string, which the godoes/gorm-dameng driver expects as
// `dm://user:password@host:port?schema=SYSDBA`. (Oracle's adapter can't be
// subclassed here because its `kind` is a fixed literal.)
export class DamengAdapter extends AbstractSqlAdapter {
  override readonly kind = "dameng" as const;

  override formatLanguage(): DbFormatLanguage {
    return "plsql";
  }

  override defaultQuery(): string {
    return "SELECT 1 FROM dual";
  }

  override defaultPort(): string {
    return "5236";
  }

  override defaultDatabase(): string {
    return "SYSDBA";
  }

  override defaultConnectionConfig(): DbConnectionConfig {
    return {
      ...super.defaultConnectionConfig(),
      username: "SYSDBA",
      database: "SYSDBA",
    };
  }

  override buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    const config = connection.config;
    const host = config.host.trim();
    const port = config.port.trim();
    const username = config.username.trim();
    const password = config.password.trim();
    const schema = config.database.trim();

    if (!host) {
      return connection.url.trim();
    }

    const auth = buildAuthPart(username, password);
    const url = new URL(`dm://${auth}${host}${port ? `:${port}` : ""}`);
    if (schema) {
      url.searchParams.set("schema", schema);
    }
    appendUrlOptions(url, config.options);
    return url.toString();
  }

  override parseConnectionUrl(raw: string): DbConnectionConfig {
    const normalized = raw.trim();
    const fallback = this.defaultConnectionConfig();
    if (!normalized) {
      return fallback;
    }
    try {
      const url = new URL(normalized);
      const schema = url.searchParams.get("schema") ?? fallback.database;
      return {
        ...fallback,
        host: decodeURIComponent(url.hostname || fallback.host),
        port: url.port || fallback.port,
        username: decodeURIComponent(url.username || fallback.username),
        password: decodeURIComponent(url.password),
        database: schema,
        options: formatSearchParams(url, ["schema"]),
      };
    } catch {
      return fallback;
    }
  }

  override formatLimitedSelect(
    qualifiedName: string,
    offset: number,
    pageSize: number,
    orderBy?: DbSortOrder,
  ): string {
    return `SELECT * FROM ${qualifiedName}${this.orderByClause(orderBy)} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY;`;
  }

  override buildFunctionQuery(schemaName: string, functionName: string): string {
    const qualifiedName = this.buildQualifiedName(schemaName, functionName);
    return `-- Replace parameters as needed\nSELECT ${qualifiedName}() FROM dual;`;
  }

  override buildExplorerQuery(): string {
    return `
        SELECT USER AS schema_name, table_name, 'BASE TABLE' AS table_type
        FROM user_tables
        UNION ALL
        SELECT USER AS schema_name, view_name AS table_name, 'VIEW' AS table_type
        FROM user_views
        ORDER BY schema_name, table_type, table_name;
      `;
  }

  override buildRoutineExplorerQuery(): string {
    return `
        SELECT USER AS schema_name, OBJECT_NAME AS routine_name
        FROM USER_OBJECTS
        WHERE OBJECT_TYPE = 'FUNCTION'
        ORDER BY OBJECT_NAME;
      `;
  }

  override buildAllColumnsQuery(): string {
    return `SELECT USER AS table_schema, table_name, column_name
FROM user_tab_columns
ORDER BY table_name, column_id`;
  }

  // --- UI metadata -------------------------------------------------------
  override badge(): DbConnectionBadge {
    return { label: "DM", class: "theme-method-badge theme-method-delete" };
  }

  override displayName(): string {
    return "Dameng";
  }

  override describeConnection(connection: DbConnection): string {
    const schema = connection.config.database.trim() || "SYSDBA";
    const host = connection.config.host.trim() || "localhost";
    const port = connection.config.port.trim() || "5236";
    return `${host}:${port} / ${schema}`;
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
    return `SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT
FROM USER_TAB_COLUMNS
WHERE TABLE_NAME = UPPER('${this.escapeString(node.label)}')
ORDER BY COLUMN_ID;`;
  }
}
