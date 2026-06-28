import type { DbConnectionBadge } from "./types";
import { MySqlAdapter } from "./mysql";

// GoldenDB (中兴金篆) exposes a MySQL-compatible query interface, so it reuses
// every MySQL query, parser, and the `tcp(...)` DSN format.
export class GoldenDbAdapter extends MySqlAdapter {
  override readonly kind = "goldendb" as const;

  override badge(): DbConnectionBadge {
    return { label: "GLD", class: "theme-method-badge theme-method-get" };
  }

  override displayName(): string {
    return "GoldenDB";
  }
}
