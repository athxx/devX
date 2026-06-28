import type { DbConnectionBadge } from "./types";
import { MySqlAdapter } from "./mysql";

// Manticore Search exposes a MySQL-compatible SQL interface over the MySQL wire
// protocol, so it reuses every MySQL query, parser, and the `tcp(...)` DSN
// format. The default SQL listener port is 9306 rather than 3306.
export class ManticoreAdapter extends MySqlAdapter {
  override readonly kind = "manticore" as const;

  override defaultPort(): string {
    return "9306";
  }

  override badge(): DbConnectionBadge {
    return { label: "MS", class: "theme-method-badge theme-method-get" };
  }

  override displayName(): string {
    return "Manticore";
  }
}
