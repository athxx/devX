import type { DbConnectionBadge } from "./types";
import { MySqlAdapter } from "./mysql";

// MariaDB is a MySQL fork and speaks the MySQL wire protocol, so it reuses every
// MySQL query, parser, and the `tcp(...)` DSN format unchanged.
export class MariaDbAdapter extends MySqlAdapter {
  override readonly kind = "mariadb" as const;

  override badge(): DbConnectionBadge {
    return { label: "MARIA", class: "theme-method-badge theme-method-get" };
  }

  override displayName(): string {
    return "MariaDB";
  }
}
