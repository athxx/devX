import type { DbConnection } from "../models";
import type { DbConnectionBadge } from "./types";
import { PostgresAdapter } from "./postgresql";

// Databricks SQL warehouses speak ANSI SQL with an information_schema, so this
// reuses the PostgreSQL explorer/structure queries. The Go side routes it to the
// databricks-sql-go database/sql driver (see rawsql_drivers.go), whose DSN is:
//   token:<token>@<hostname>:<port>/<endpoint http path>?param=value
// We pack the personal-access token into config.password and the warehouse's
// HTTP path (e.g. /sql/1.0/warehouses/abc123) plus any extra params into
// config.options. The connection URL field is the fallback when host is empty.
export class DatabricksAdapter extends PostgresAdapter {
  override readonly kind = "databricks" as const;

  override defaultPort(): string {
    return "443";
  }

  override buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    const config = connection.config;
    const host = config.host.trim();
    if (!host) {
      return connection.url.trim();
    }
    const token = config.password.trim();
    const port = config.port.trim() || "443";
    // options carries the HTTP path (with leading "/") and optional "?params".
    const rawOptions = config.options.trim();
    const path = rawOptions.startsWith("/")
      ? rawOptions
      : rawOptions
        ? `/${rawOptions}`
        : "";
    // databricks-sql-go DSN: token:<token>@<host>:<port>/<httpPath>?params
    return `token:${token}@${host}:${port}${path}`;
  }

  override badge(): DbConnectionBadge {
    return { label: "DB", class: "theme-method-badge theme-method-post" };
  }

  override displayName(): string {
    return "Databricks";
  }
}
