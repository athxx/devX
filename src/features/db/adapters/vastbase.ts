import type { DbConnectionBadge } from "./types";
import { PostgresAdapter } from "./postgresql";

// Vastbase (海量数据) speaks the PostgreSQL wire protocol, so it reuses every
// PostgreSQL query, parser, and URL-style DSN.
export class VastbaseAdapter extends PostgresAdapter {
  override readonly kind = "vastbase" as const;

  override badge(): DbConnectionBadge {
    return { label: "VB", class: "theme-method-badge theme-method-patch" };
  }

  override displayName(): string {
    return "Vastbase";
  }
}
