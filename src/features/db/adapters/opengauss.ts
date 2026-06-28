import type { DbConnection } from "../models";
import type { DbConnectionBadge } from "./types";
import { buildKeywordDsn } from "./base-sql";
import { PostgresAdapter } from "./postgresql";

// openGauss is the open-source upstream of GaussDB and speaks the same
// PostgreSQL-derived protocol. Like GaussDB it reuses every PostgreSQL query
// and parser, differing only in connection-string serialization: the Go
// `gaussdb` driver expects a libpq keyword DSN rather than a URL. The default
// port is 5432.
export class OpenGaussAdapter extends PostgresAdapter {
  override readonly kind = "opengauss" as const;

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
    return { label: "OG", class: "theme-method-badge theme-method-patch" };
  }

  override displayName(): string {
    return "openGauss";
  }
}
