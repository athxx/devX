import type { DbConnectionBadge } from "./types";
import { PostgresAdapter } from "./postgresql";

// HighGo (瀚高) speaks the PostgreSQL wire protocol, so it reuses every
// PostgreSQL query, parser, and URL-style DSN. The default port is 5866.
export class HighGoAdapter extends PostgresAdapter {
  override readonly kind = "highgo" as const;

  override defaultPort(): string {
    return "5866";
  }

  override badge(): DbConnectionBadge {
    return { label: "HG", class: "theme-method-badge theme-method-patch" };
  }

  override displayName(): string {
    return "HighGo";
  }
}
