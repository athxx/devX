import type { DbConnection } from "../models";
import type { DbConnectionBadge } from "./types";
import { buildKeywordDsn } from "./base-sql";
import { PostgresAdapter } from "./postgresql";

// GaussDB speaks the PostgreSQL protocol, so it reuses every PostgreSQL query
// and parser. It differs only in how the connection string is serialized: the
// Go driver expects a libpq keyword DSN rather than a URL.
export class GaussDbAdapter extends PostgresAdapter {
  override readonly kind = "gaussdb" as const;

  override buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    const config = connection.config;
    const host = config.host.trim();
    if (!host) {
      return connection.url.trim();
    }
    return buildKeywordDsn(
      [
        ["host", host],
        ["port", config.port.trim()],
        ["user", config.username.trim()],
        ["password", config.password.trim()],
        ["dbname", config.database.trim()],
      ],
      config.options,
    );
  }

  override badge(): DbConnectionBadge {
    return { label: "GDB", class: "theme-method-badge theme-method-patch" };
  }

  override displayName(): string {
    return "GaussDB";
  }
}
