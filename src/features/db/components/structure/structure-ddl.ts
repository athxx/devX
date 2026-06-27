// Pure ALTER TABLE DDL generation for the structure editor (Phase 3B).
//
// Frontend-only, dependency-free, ANSI-leaning syntax. The plan's adapter rule
// is "prefer composing DDL from existing builders; only ADD an adapter method
// when a genuinely new DDL shape is required" — the common column operations
// (add / drop / rename / retype / null toggle / default) are portable enough
// to compose here, and the output is a PREVIEW the user reviews and runs by
// hand (never auto-executed), so dialect quirks are caught at review time.
import type { DbObjectColumn } from "../../models";

/** A column row as edited in the structure grid. */
export type StructureColumnDraft = {
  /** Original column name; absent for a freshly added row. */
  originalName?: string;
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string;
  /** Marked for DROP — kept in the list so the user can undo. */
  dropped?: boolean;
};

/** Seed editable drafts from a loaded object detail. */
export function toColumnDrafts(
  columns: DbObjectColumn[],
): StructureColumnDraft[] {
  return columns.map((column) => ({
    originalName: column.name,
    name: column.name,
    type: column.type ?? "",
    nullable: column.nullable ?? true,
    defaultValue: column.defaultValue ?? "",
    dropped: false,
  }));
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function columnSpec(draft: StructureColumnDraft): string {
  let spec = `${quoteIdent(draft.name)} ${draft.type}`.trimEnd();
  if (draft.defaultValue.trim()) spec += ` DEFAULT ${draft.defaultValue.trim()}`;
  spec += draft.nullable ? "" : " NOT NULL";
  return spec;
}

/**
 * Diff the edited drafts against the original columns and emit one ALTER TABLE
 * statement per change. Returns "" (not a no-op comment) when nothing changed
 * so callers can detect an empty diff. Order: drops, adds, then per-column
 * rename / type / nullability / default alterations.
 */
export function buildAlterTableDdl(
  qualifiedName: string,
  original: DbObjectColumn[],
  drafts: StructureColumnDraft[],
): string {
  const table = qualifiedName.includes('"')
    ? qualifiedName
    : qualifiedName
        .split(".")
        .map((part) => quoteIdent(part))
        .join(".");
  const statements: string[] = [];
  const originalByName = new Map(original.map((c) => [c.name, c]));

  for (const draft of drafts) {
    if (draft.dropped && draft.originalName) {
      statements.push(
        `ALTER TABLE ${table} DROP COLUMN ${quoteIdent(draft.originalName)};`,
      );
      continue;
    }
    if (draft.dropped) continue; // dropped row that was never persisted

    if (!draft.originalName) {
      statements.push(
        `ALTER TABLE ${table} ADD COLUMN ${columnSpec(draft)};`,
      );
      continue;
    }

    const before = originalByName.get(draft.originalName);
    if (!before) continue;

    if (draft.name !== draft.originalName) {
      statements.push(
        `ALTER TABLE ${table} RENAME COLUMN ${quoteIdent(
          draft.originalName,
        )} TO ${quoteIdent(draft.name)};`,
      );
    }
    if ((draft.type ?? "").trim() !== (before.type ?? "").trim()) {
      statements.push(
        `ALTER TABLE ${table} ALTER COLUMN ${quoteIdent(
          draft.name,
        )} TYPE ${draft.type};`,
      );
    }
    const beforeNullable = before.nullable ?? true;
    if (draft.nullable !== beforeNullable) {
      statements.push(
        draft.nullable
          ? `ALTER TABLE ${table} ALTER COLUMN ${quoteIdent(
              draft.name,
            )} DROP NOT NULL;`
          : `ALTER TABLE ${table} ALTER COLUMN ${quoteIdent(
              draft.name,
            )} SET NOT NULL;`,
      );
    }
    const beforeDefault = (before.defaultValue ?? "").trim();
    const afterDefault = draft.defaultValue.trim();
    if (afterDefault !== beforeDefault) {
      statements.push(
        afterDefault
          ? `ALTER TABLE ${table} ALTER COLUMN ${quoteIdent(
              draft.name,
            )} SET DEFAULT ${afterDefault};`
          : `ALTER TABLE ${table} ALTER COLUMN ${quoteIdent(
              draft.name,
            )} DROP DEFAULT;`,
      );
    }
  }

  return statements.join("\n");
}
