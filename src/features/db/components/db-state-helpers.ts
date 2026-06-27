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
