import type { DbConnectionBadge } from "./types";
import { PostgresAdapter } from "./postgresql";

// KingBase (人大金仓) speaks the PostgreSQL wire protocol, so it reuses every
// PostgreSQL query, parser, and URL-style DSN. The default port is 54321.
export class KingBaseAdapter extends PostgresAdapter {
  override readonly kind = "kingbase" as const;

  override defaultPort(): string {
    return "54321";
  }

  override badge(): DbConnectionBadge {
    return { label: "KB", class: "theme-method-badge theme-method-patch" };
  }

  override displayName(): string {
    return "KingBase";
  }
}
