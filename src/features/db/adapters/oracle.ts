import type {
  DbConnection,
  DbConnectionConfig,
} from "../models";
import type { DbConnectionBadge, DbExplorerLeafNode, DbFormatLanguage } from "./types";
import { AbstractSqlAdapter, appendUrlOptions, buildAuthPart, formatSearchParams } from "./base-sql";

export class OracleAdapter extends AbstractSqlAdapter {
  readonly kind = "oracle" as const;

  override formatLanguage(): DbFormatLanguage {
    return "plsql";
  }

  override defaultQuery(): string {
    return "SELECT 1 FROM dual";
  }

  override defaultPort(): string {
    return "1521";
  }

  override defaultDatabase(): string {
    return "FREEPDB1";
  }

  override defaultConnectionConfig(): DbConnectionConfig {
    return {
      ...super.defaultConnectionConfig(),
      serviceName: "FREEPDB1",
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
    const database = config.database.trim();

    if (!host) {
      return connection.url.trim();
    }

    const auth = buildAuthPart(username, password);
    const serviceName = config.serviceName.trim() || database || "FREEPDB1";
    const url = new URL(
      `oracle://${auth}${host}${port ? `:${port}` : ""}/${encodeURIComponent(serviceName)}`,
    );
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
      const pathname = url.pathname.replace(/^\/+/, "");
      const resolved = decodeURIComponent(pathname || fallback.serviceName);
      return {
        ...fallback,
        host: decodeURIComponent(url.hostname || fallback.host),
        port: url.port || fallback.port,
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: resolved,
        serviceName: resolved,
        options: formatSearchParams(url),
      };
    } catch {
      return fallback;
    }
  }

  override formatLimitedSelect(
    qualifiedName: string,
    offset: number,
    pageSize: number,
  ): string {
    return `SELECT * FROM ${qualifiedName} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY;`;
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
    return { label: "ORA", class: "theme-method-badge theme-method-delete" };
  }

  override displayName(): string {
    return "Oracle";
  }

  override describeConnection(connection: DbConnection): string {
    const serviceName =
      connection.config.serviceName.trim() ||
      connection.config.database.trim() ||
      "FREEPDB1";
    const host = connection.config.host.trim() || "localhost";
    const port = connection.config.port.trim() || "1521";
    return `${host}:${port} / ${serviceName}`;
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

  override buildConnectionSummaryQuery(): string {
    return "SELECT name, value, display_value, description FROM v$parameter ORDER BY name";
  }
}
