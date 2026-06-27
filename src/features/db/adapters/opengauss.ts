import type { DbConnection } from "../models";
import type { DbConnectionBadge } from "./types";
import { buildKeywordDsn } from "./base-sql";
import { PostgresAdapter } from "./postgresql";

// openGauss shares GaussDB's PostgreSQL-derived protocol and, like GaussDB,
// expects a libpq keyword DSN rather than a URL. It reuses every PostgreSQL
// query/parser and only overrides connection-string serialization (mirroring
// GaussDbAdapter, which can't be subclassed here because its `kind` is a fixed
// literal).
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
