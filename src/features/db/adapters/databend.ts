import type { DbConnection } from "../models";
import type { DbConnectionBadge } from "./types";
import { appendUrlOptions, buildAuthPart } from "./base-sql";
import { PostgresAdapter } from "./postgresql";

// Databend is a cloud data warehouse with a MySQL/ANSI-flavored SQL and an
// information_schema, so it reuses the PostgreSQL explorer/structure queries.
// The Go side routes it to the databend-go database/sql driver, whose DSN is an
// HTTP(S) URL: databend://user:password@host:port/database?params
export class DatabendAdapter extends PostgresAdapter {
  override readonly kind = "databend" as const;

  override defaultPort(): string {
    return "8000";
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
    const database = config.database.trim();
    const dbPath = database ? `/${encodeURIComponent(database)}` : "";
    const url = new URL(
      `databend://${auth}${host}${port ? `:${port}` : ""}${dbPath}`,
    );
    appendUrlOptions(url, config.options);
    return url.toString();
  }

  override badge(): DbConnectionBadge {
    return { label: "DB", class: "theme-method-badge theme-method-post" };
  }

  override displayName(): string {
    return "Databend";
  }
}
