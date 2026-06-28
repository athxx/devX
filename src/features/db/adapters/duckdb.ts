import type { DbConnection } from "../models";
import type { DbConnectionBadge } from "./types";
import { PostgresAdapter } from "./postgresql";

// DuckDB is an embedded, file-based analytical database with a PostgreSQL-like
// SQL and an information_schema, so it reuses the PostgreSQL explorer/structure
// queries. The Go driver (go-duckdb, cgo, gated behind the `cgo_drivers` build
// tag) takes a filesystem path as its DSN — or an empty string for an in-memory
// database. We therefore prefer the file path field, falling back to host/url.
export class DuckDbAdapter extends PostgresAdapter {
  override readonly kind = "duckdb" as const;

  override defaultPort(): string {
    return "";
  }

  override buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    const config = connection.config;
    const filePath = config.filePath.trim();
    if (filePath) {
      return filePath;
    }
    // Empty DSN => in-memory DuckDB.
    return connection.url.trim();
  }

  override badge(): DbConnectionBadge {
    return { label: "DK", class: "theme-method-badge theme-method-patch" };
  }

  override displayName(): string {
    return "DuckDB";
  }
}
