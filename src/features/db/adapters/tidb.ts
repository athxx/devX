import type { DbConnectionBadge } from "./types";
import { MySqlAdapter } from "./mysql";

// TiDB is MySQL-protocol compatible. It reuses every MySQL query, parser, and
// the `tcp(...)` DSN format, differing only in that the DSN gets a default
// charset=utf8mb4 parameter.
export class TiDbAdapter extends MySqlAdapter {
  override readonly kind = "tidb" as const;

  protected override get treatAsTiDb(): boolean {
    return true;
  }

  override badge(): DbConnectionBadge {
    return { label: "TIDB", class: "theme-method-badge theme-method-get" };
  }

  override displayName(): string {
    return "TiDB";
  }
}
