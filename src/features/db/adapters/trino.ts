import type { DbConnection } from "../models";
import type { DbConnectionBadge } from "./types";
import { appendUrlOptions, buildAuthPart } from "./base-sql";
import { PostgresAdapter } from "./postgresql";

// Trino is an ANSI-SQL query engine with an information_schema, so it reuses the
// PostgreSQL explorer/structure queries. The Go side routes it to the
// trino-go-client database/sql driver, whose DSN is an HTTP(S) URL:
//   http[s]://user[:password]@host:port?catalog=...&schema=...
// The catalog/schema travel as URL options; the "database" maps to the catalog.
export class TrinoAdapter extends PostgresAdapter {
  override readonly kind = "trino" as const;

  override defaultPort(): string {
    return "8080";
  }

  override buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    const config = connection.config;
    const host = config.host.trim();
    if (!host) {
      return connection.url.trim();
    }
    const port = config.port.trim();
    const auth = buildAuthPart(config.username.trim(), config.password.trim());
    const url = new URL(`http://${auth}${host}${port ? `:${port}` : ""}`);
    const catalog = config.database.trim();
    if (catalog) {
      url.searchParams.set("catalog", catalog);
    }
    appendUrlOptions(url, config.options);
    return url.toString();
  }

  override badge(): DbConnectionBadge {
    return { label: "TR", class: "theme-method-badge theme-method-post" };
  }

  override displayName(): string {
    return "Trino";
  }
}
