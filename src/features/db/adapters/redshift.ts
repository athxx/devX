import type { DbConnectionBadge } from "./types";
import { PostgresAdapter } from "./postgresql";

// Amazon Redshift speaks the PostgreSQL wire protocol, so it reuses every
// PostgreSQL query, parser, and URL-style DSN. The default port is 5439.
export class RedshiftAdapter extends PostgresAdapter {
  override readonly kind = "redshift" as const;

  override defaultPort(): string {
    return "5439";
  }

  override badge(): DbConnectionBadge {
    return { label: "RS", class: "theme-method-badge theme-method-patch" };
  }

  override displayName(): string {
    return "Redshift";
  }
}
