import type { DbConnectionBadge } from "./types";
import { PostgresAdapter } from "./postgresql";

// CockroachDB speaks the PostgreSQL wire protocol, so it reuses every PostgreSQL
// query, parser, and URL-style DSN. The default port is 26257 rather than 5432.
export class CockroachDbAdapter extends PostgresAdapter {
  override readonly kind = "cockroachdb" as const;

  override defaultPort(): string {
    return "26257";
  }

  override badge(): DbConnectionBadge {
    return { label: "CRDB", class: "theme-method-badge theme-method-patch" };
  }

  override displayName(): string {
    return "CockroachDB";
  }
}
