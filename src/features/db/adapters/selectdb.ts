import type { DbConnectionBadge } from "./types";
import { MySqlAdapter } from "./mysql";

// SelectDB (managed Apache Doris) exposes a MySQL-compatible query interface,
// so it reuses every MySQL query, parser, and the `tcp(...)` DSN format. The
// default FE query port is 9030 rather than 3306.
export class SelectDbAdapter extends MySqlAdapter {
  override readonly kind = "selectdb" as const;

  override defaultPort(): string {
    return "9030";
  }

  override badge(): DbConnectionBadge {
    return { label: "SDB", class: "theme-method-badge theme-method-get" };
  }

  override displayName(): string {
    return "SelectDB";
  }
}
