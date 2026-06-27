import type { DbConnectionBadge } from "./types";
import { MySqlAdapter } from "./mysql";

// StarRocks exposes a MySQL-compatible query interface, so it reuses every
// MySQL query, parser, and the `tcp(...)` DSN format. The default FE query port
// is 9030 rather than 3306.
export class StarRocksAdapter extends MySqlAdapter {
  override readonly kind = "starrocks" as const;

  override defaultPort(): string {
    return "9030";
  }

  override badge(): DbConnectionBadge {
    return { label: "SR", class: "theme-method-badge theme-method-get" };
  }

  override displayName(): string {
    return "StarRocks";
  }
}
