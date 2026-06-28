import type { DbConnection } from "../models";
import type { DbConnectionBadge } from "./types";
import { PostgresAdapter } from "./postgresql";

// Snowflake speaks ANSI SQL with an information_schema, so it reuses the
// PostgreSQL explorer/structure queries. The Go side routes it to the
// gosnowflake database/sql driver (see rawsql_drivers.go), which expects a DSN
// of the form `user:password@account/database/schema?warehouse=...`. We can't
// derive the account locator from host/port reliably, so the connection URL
// field is the primary input; we only synthesize a DSN when host is provided.
export class SnowflakeAdapter extends PostgresAdapter {
  override readonly kind = "snowflake" as const;

  override defaultPort(): string {
    return "443";
  }

  override buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    const config = connection.config;
    const account = config.host.trim();
    if (!account) {
      return connection.url.trim();
    }
    const user = encodeURIComponent(config.username.trim());
    const password = encodeURIComponent(config.password.trim());
    const auth = password ? `${user}:${password}` : user;
    const database = config.database.trim();
    const dbPath = database ? `/${database}` : "";
    const options = config.options.trim();
    const query = options ? `?${options}` : "";
    // gosnowflake DSN: user[:password]@account[/database[/schema]][?params]
    return `${auth}@${account}${dbPath}${query}`;
  }

  override badge(): DbConnectionBadge {
    return { label: "SF", class: "theme-method-badge theme-method-post" };
  }

  override displayName(): string {
    return "Snowflake";
  }
}
