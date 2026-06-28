import type { DbConnectionBadge } from "./types";
import { PostgresAdapter } from "./postgresql";

// QuestDB exposes a PostgreSQL wire-compatible endpoint, so it reuses every
// PostgreSQL query, parser, and URL-style DSN. The default PG-wire port is 8812.
export class QuestDbAdapter extends PostgresAdapter {
  override readonly kind = "questdb" as const;

  override defaultPort(): string {
    return "8812";
  }

  override badge(): DbConnectionBadge {
    return { label: "QDB", class: "theme-method-badge theme-method-patch" };
  }

  override displayName(): string {
    return "QuestDB";
  }
}
