import type { DbConnectionBadge } from "./types";
import { MySqlAdapter } from "./mysql";

// TDengine's native Go connector (taosSql, cgo, gated behind the `cgo_drivers`
// build tag) uses the same `user:password@tcp(host:port)/dbname` DSN as MySQL,
// and modern TDengine exposes an information_schema, so it reuses the MySQL
// query/parser/DSN path. Default native port is 6030.
export class TDengineAdapter extends MySqlAdapter {
  override readonly kind = "tdengine" as const;

  override defaultPort(): string {
    return "6030";
  }

  override badge(): DbConnectionBadge {
    return { label: "TD", class: "theme-method-badge theme-method-get" };
  }

  override displayName(): string {
    return "TDengine";
  }
}
