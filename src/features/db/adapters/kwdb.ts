import type { DbConnectionBadge } from "./types";
import { MySqlAdapter } from "./mysql";

// KWDB (KaiwuDB) exposes a MySQL-compatible query interface, so it reuses every
// MySQL query, parser, and the `tcp(...)` DSN format.
export class KwDbAdapter extends MySqlAdapter {
  override readonly kind = "kwdb" as const;

  override badge(): DbConnectionBadge {
    return { label: "KW", class: "theme-method-badge theme-method-get" };
  }

  override displayName(): string {
    return "KWDB";
  }
}
