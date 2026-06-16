// Pure helpers shared across DB adapters: explorer-node factories, SQL string
// escaping, and small value coercion. No I/O, no service.ts dependency.

import { makeId } from "../../../lib/utils";
import type { DbExplorerNode } from "../models";
import type { SqlExplorerRow, SqlExplorerRoutineRow } from "./transport-types";

export function makeExplorerGroup(
  label: string,
  groupKind: "database" | "schema" | "category",
  children: DbExplorerNode[],
  description?: string,
  lazy?: boolean,
): DbExplorerNode {
  return {
    id: makeId("db-tree-group"),
    kind: "group",
    groupKind,
    label,
    description,
    children,
    lazy,
  };
}

export function makeExplorerLeaf(
  kind: "table" | "view" | "function" | "collection" | "key",
  label: string,
  query: string,
  description?: string,
  countQuery?: string,
  options?: {
    schemaName?: string;
    qualifiedName?: string;
  },
): DbExplorerNode {
  return {
    id: makeId("db-tree-leaf"),
    kind,
    label,
    query,
    description,
    countQuery,
    schemaName: options?.schemaName,
    qualifiedName: options?.qualifiedName,
  };
}

export function escapeSqlString(value: string) {
  return value.replace(/'/g, "''");
}

export function asString(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeExplorerTableType(value: unknown) {
  const normalized = String(value ?? "").toUpperCase();
  return normalized.includes("VIEW") ? "view" : "table";
}

export function getSqlExplorerValue(
  row: SqlExplorerRow | SqlExplorerRoutineRow,
  key: "schema_name" | "table_name" | "table_type" | "routine_name",
) {
  const record = row as Record<string, unknown>;
  return record[key];
}

export function splitRedisCommand(command: string) {
  const matches = command.match(/"[^"]*"|'[^']*'|`[^`]*`|[^\s]+/g) ?? [];
  return matches.map((part) => part.replace(/^['"`]|['"`]$/g, ""));
}

export function quoteRedisArgument(value: string) {
  return /[\s"'`]/u.test(value) ? JSON.stringify(value) : value;
}
