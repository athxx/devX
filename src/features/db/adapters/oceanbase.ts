import type { DbConnectionBadge } from "./types";
import { MySqlAdapter } from "./mysql";

// OceanBase (MySQL mode) is MySQL-protocol compatible, reusing every MySQL
// query, parser, and the `tcp(...)` DSN format unchanged.
export class OceanBaseAdapter extends MySqlAdapter {
  override readonly kind = "oceanbase" as const;

  override badge(): DbConnectionBadge {
    return { label: "OB", class: "theme-method-badge theme-method-get" };
  }

  override displayName(): string {
    return "OceanBase";
  }
}
