// Pure parsers for importing connections from other database clients. Given the
// text of an exported config file we produce *partial* connections (kind + a
// partial config) that the service normalizes into full DbConnection records.
// No I/O, no Solid signals — just format parsing, so each format is unit-testable.
//
// Supported:
//   • DBeaver  — data-sources.json (the JSON descriptor; passwords live in a
//                separate encrypted credentials-config.json and are NOT imported).
//   • Navicat  — .ncx export (XML <Connection> elements; the password attribute is
//                Blowfish-encrypted and is NOT imported).
// In both cases credentials beyond username are left blank for the user to fill —
// we never attempt to decrypt vendor secrets.

import type { DbConnectionConfig, DbConnectionKind } from "../models";

export type ImportedConnection = {
  name: string;
  kind: DbConnectionKind;
  config: Partial<DbConnectionConfig>;
};

export type ConnectionImportResult = {
  connections: ImportedConnection[];
  /** Human-readable notes about entries that were skipped or partially imported. */
  warnings: string[];
};

/** Map a vendor driver/provider token to a devX connection kind, or null. */
function mapKind(raw: string | undefined): DbConnectionKind | null {
  if (!raw) return null;
  const token = raw.toLowerCase();
  // Ordered most-specific first so e.g. "mariadb" maps before a bare "maria".
  const table: Array<[string, DbConnectionKind]> = [
    ["postgres", "postgresql"],
    ["postgis", "postgresql"],
    ["pgsql", "postgresql"],
    ["greenplum", "postgresql"],
    ["redshift", "redshift"],
    ["cockroach", "cockroachdb"],
    ["opengauss", "opengauss"],
    ["gaussdb", "gaussdb"],
    ["kingbase", "kingbase"],
    ["highgo", "highgo"],
    ["vastbase", "vastbase"],
    ["tidb", "tidb"],
    ["oceanbase", "oceanbase"],
    ["mariadb", "mysql"],
    ["mysql", "mysql"],
    ["clickhouse", "clickhouse"],
    ["doris", "doris"],
    ["starrocks", "starrocks"],
    ["selectdb", "selectdb"],
    ["oracle", "oracle"],
    ["dm", "dameng"],
    ["dameng", "dameng"],
    ["sqlserver", "sqlserver"],
    ["mssql", "sqlserver"],
    ["sql_server", "sqlserver"],
    ["microsoft", "sqlserver"],
    ["sqlite", "sqlite"],
    ["snowflake", "snowflake"],
    ["trino", "trino"],
    ["presto", "trino"],
    ["databend", "databend"],
    ["duckdb", "duckdb"],
    ["tdengine", "tdengine"],
    ["questdb", "questdb"],
    ["influx", "influxdb"],
    ["mongo", "mongodb"],
    ["redis", "redis"],
    ["elastic", "elasticsearch"],
    ["cassandra", "cassandra"],
    ["neo4j", "neo4j"],
  ];
  for (const [needle, kind] of table) {
    if (token.includes(needle)) return kind;
  }
  return null;
}

/** Parse a DBeaver data-sources.json descriptor. */
function parseDbeaver(text: string): ConnectionImportResult {
  const warnings: string[] = [];
  const connections: ImportedConnection[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { connections, warnings: ["Not valid JSON — expected DBeaver data-sources.json."] };
  }
  const root = parsed as { connections?: Record<string, unknown> };
  const entries = root.connections;
  if (!entries || typeof entries !== "object") {
    return { connections, warnings: ["No \"connections\" object found in DBeaver file."] };
  }

  for (const [id, value] of Object.entries(entries)) {
    const entry = value as {
      name?: string;
      provider?: string;
      driver?: string;
      configuration?: {
        host?: string;
        port?: string | number;
        database?: string;
        url?: string;
        user?: string;
        "auth-model"?: string;
      };
    };
    const kind = mapKind(entry.driver) ?? mapKind(entry.provider);
    if (!kind) {
      warnings.push(`Skipped "${entry.name ?? id}" — unsupported provider "${entry.provider ?? entry.driver ?? "?"}".`);
      continue;
    }
    const cfg = entry.configuration ?? {};
    connections.push({
      name: entry.name?.trim() || (cfg.host ?? id),
      kind,
      config: {
        host: cfg.host ?? "",
        port: cfg.port !== undefined ? String(cfg.port) : "",
        database: cfg.database ?? "",
        username: cfg.user ?? "",
      },
    });
  }
  if (connections.length > 0) {
    warnings.push("DBeaver passwords are stored separately (encrypted) and were not imported — re-enter them.");
  }
  return { connections, warnings };
}

/** Read an XML attribute value off a raw element string. */
function attr(element: string, name: string): string | undefined {
  const match = element.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return match ? match[1] : undefined;
}

/** Parse a Navicat .ncx export (XML with <Connection .../> elements). */
function parseNavicat(text: string): ConnectionImportResult {
  const warnings: string[] = [];
  const connections: ImportedConnection[] = [];
  // Match each <Connection ...> opening tag (self-closing or not).
  const elements = text.match(/<Connection\b[^>]*>/gi) ?? [];
  if (elements.length === 0) {
    return { connections, warnings: ["No <Connection> elements found — expected a Navicat .ncx export."] };
  }
  for (const element of elements) {
    const kind = mapKind(attr(element, "ConnType")) ?? mapKind(attr(element, "ConnectionType"));
    const name = attr(element, "ConnectionName") ?? attr(element, "Name") ?? "Navicat connection";
    if (!kind) {
      warnings.push(`Skipped "${name}" — unsupported ConnType "${attr(element, "ConnType") ?? "?"}".`);
      continue;
    }
    connections.push({
      name: name.trim() || "Navicat connection",
      kind,
      config: {
        host: attr(element, "Host") ?? "",
        port: attr(element, "Port") ?? "",
        database: attr(element, "Database") ?? attr(element, "DatabaseName") ?? "",
        username: attr(element, "UserName") ?? "",
      },
    });
  }
  if (connections.length > 0) {
    warnings.push("Navicat passwords are encrypted and were not imported — re-enter them.");
  }
  return { connections, warnings };
}

/**
 * Parse a client-export file into importable connections. The format is chosen
 * by the file name/extension first, falling back to content sniffing.
 */
export function parseConnectionImport(
  text: string,
  fileName: string,
): ConnectionImportResult {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".ncx") || /<Connection\b/i.test(text)) {
    return parseNavicat(text);
  }
  if (lower.endsWith(".json") || text.trim().startsWith("{")) {
    return parseDbeaver(text);
  }
  return {
    connections: [],
    warnings: [`Unrecognized file "${fileName}" — expected DBeaver data-sources.json or Navicat .ncx.`],
  };
}
