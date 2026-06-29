import type { DbConnection } from "../models";
import type { DbConnectionBadge } from "./types";
import { PostgresAdapter } from "./postgresql";

// Apache Hive (HiveServer2) speaks ANSI-ish SQL, so this reuses the PostgreSQL
// explorer/structure queries. The Go side routes it to the beltran/gohive
// database/sql driver (see rawsql_drivers.go), which expects a DSN of the form:
//   hive://username:password@host:port/database?auth=NONE&service=hive
// The default binary is pure-Go (NONE/LDAP/NOSASL auth); Kerberos requires
// rebuilding with `-tags cgo_drivers,kerberos` and is out of default scope.
export class HiveAdapter extends PostgresAdapter {
  override readonly kind = "hive" as const;

  override defaultPort(): string {
    return "10000";
  }

  override buildConnectionUrl(
    connection: Pick<DbConnection, "kind" | "config" | "url">,
  ): string {
    const config = connection.config;
    const host = config.host.trim();
    if (!host) {
      return connection.url.trim();
    }
    const user = encodeURIComponent(config.username.trim());
    const password = encodeURIComponent(config.password.trim());
    const auth = user ? (password ? `${user}:${password}@` : `${user}@`) : "";
    const port = config.port.trim() || "10000";
    const database = config.database.trim();
    const dbPath = database ? `/${database}` : "";
    // options carries query params (e.g. auth=NONE&service=hive) without "?".
    const options = config.options.trim();
    const query = options ? `?${options}` : "";
    // gohive DSN: hive://[user[:password]@]host:port[/database][?params]
    return `hive://${auth}${host}:${port}${dbPath}${query}`;
  }

  override badge(): DbConnectionBadge {
    return { label: "HV", class: "theme-method-badge theme-method-post" };
  }

  override displayName(): string {
    return "Hive";
  }
}
