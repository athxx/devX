// Pure, dependency-free helpers extracted from db-panel-context.tsx as the first
// step of the state-layer refactor (Phase 1, PR #0). These close over no signals
// and have no side effects, so they live as plain module functions. The context
// re-imports them verbatim — observable behavior is unchanged.
import type { DbExplorerNode } from "../models";

export function schemaCompletionKey(
  connectionId: string,
  databaseName?: string | null,
) {
  return databaseName ? `${connectionId}::${databaseName}` : connectionId;
}

export function getRowKey(row: Record<string, unknown>, _index: number) {
  return JSON.stringify(row);
}

export function sqlLiteral(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  const raw = String(value);
  if (raw === "null") return "NULL";
  if (/^-?\d+(\.\d+)?$/u.test(raw)) return raw;
  return `'${raw.replace(/'/g, "''")}'`;
}

/**
 * Inspect a SQL statement for destructive operations that warrant a confirm
 * prompt before running: DELETE/UPDATE without a WHERE clause, plus DROP,
 * TRUNCATE, and ALTER. Comments and string literals are stripped first so a
 * WHERE inside a comment/quote can't suppress the warning, and a DROP inside a
 * string can't trigger a false one. Returns a short human reason, or null when
 * the statement is not flagged as dangerous.
 */
export function detectDangerousSql(query: string): string | null {
  // Strip line comments, block comments, and string literals to a space so the
  // keyword scan only sees real SQL tokens.
  const stripped = query
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, " ")
    .replace(/"(?:[^"]|"")*"/g, " ");

  for (const statement of stripped.split(";")) {
    const text = statement.trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (/^drop\b/.test(lower)) return "DROP statement";
    if (/^truncate\b/.test(lower)) return "TRUNCATE statement";
    if (/^alter\b/.test(lower)) return "ALTER statement";
    if (/^delete\b/.test(lower) && !/\bwhere\b/.test(lower)) {
      return "DELETE without WHERE";
    }
    if (/^update\b/.test(lower) && !/\bwhere\b/.test(lower)) {
      return "UPDATE without WHERE";
    }
  }
  return null;
}

/**
 * Find distinct `:name` placeholders in a query (skipping `::` Postgres casts
 * and any `:name` inside comments/string literals). Returns the names in first-
 * seen order; empty when the query is not parameterized.
 */
export function extractSqlParams(query: string): string[] {
  const stripped = query
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, " ")
    .replace(/"(?:[^"]|"")*"/g, " ");
  const names: string[] = [];
  // (^|[^:]) guard skips the second colon of a `::type` cast.
  const re = /(^|[^:]):([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped)) !== null) {
    const name = match[2];
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Substitute `:name` placeholders with SQL literals built from `values`. Only
 * placeholders outside comments/strings are replaced; a `::type` cast is left
 * intact. Missing values are left as the literal placeholder (the caller is
 * expected to have collected every name from extractSqlParams first).
 */
export function applySqlParams(
  query: string,
  values: Record<string, string>,
): string {
  return query.replace(
    /(^|[^:]):([a-zA-Z_][a-zA-Z0-9_]*)/g,
    (whole, prefix: string, name: string) => {
      if (!(name in values)) return whole;
      return `${prefix}${sqlLiteral(values[name])}`;
    },
  );
}

export function nodeMatchesFilter(node: DbExplorerNode, filter: string): boolean {
  if (!filter) return true;
  if (node.label.toLowerCase().includes(filter)) return true;
  if ((node.description ?? "").toLowerCase().includes(filter)) return true;
  if (node.kind === "group") {
    // Group nodes pass if any descendant matches
    return node.children.some((child) => nodeMatchesFilter(child, filter));
  }
  return false;
}

/** Like nodeMatchesFilter but group nodes always pass (they are containers). */
export function groupOrLeafMatchesFilter(
  node: DbExplorerNode,
  filter: string,
): boolean {
  if (!filter) return true;
  if (node.kind === "group") return true;
  return (
    node.label.toLowerCase().includes(filter) ||
    (node.description ?? "").toLowerCase().includes(filter)
  );
}
