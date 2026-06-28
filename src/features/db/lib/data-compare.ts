// Pure row-level data-compare engine. Given two row sets for the *same* table
// pulled from two connections (source = "before"/A, target = "after"/B), compute
// which rows are present only on one side and which common rows differ — keyed by
// the table's primary key (or, lacking one, by the full row). No I/O, no Solid
// signals: the service fetches the rows and turns the result into sync SQL, the
// view renders it, and this stays a trivially testable pure function.

export type DataRow = Record<string, unknown>;

/** A row that exists on both sides but whose non-key columns differ. */
export type ChangedRow = {
  /** The primary-key values identifying the row (column -> value). */
  key: DataRow;
  source: DataRow;
  target: DataRow;
  /** Columns whose values differ between source and target. */
  changedColumns: string[];
};

export type DataDiff = {
  /** Columns compared (union of both sides, source order first). */
  columns: string[];
  /** Key columns used to match rows across sides. */
  keyColumns: string[];
  /** Rows present in source but missing from target (would INSERT into target). */
  rowsAdded: DataRow[];
  /** Rows present in target but missing from source (would DELETE from target). */
  rowsRemoved: DataRow[];
  /** Rows on both sides with differing values (would UPDATE the target). */
  rowsChanged: ChangedRow[];
  /** Count of rows identical on both sides. */
  unchangedCount: number;
};

/** Stable string key for a row given the key columns. */
function rowKey(row: DataRow, keyColumns: string[]): string {
  return JSON.stringify(keyColumns.map((column) => normalize(row[column])));
}

/** Normalize a cell so equal-but-differently-typed values compare equal. */
function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  // Numbers can arrive as either number or numeric string over the wire.
  if (typeof value === "number") return value;
  return value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  // Cross-type numeric equality (123 vs "123").
  return String(na) === String(nb);
}

export type DataDiffInput = {
  columns: string[];
  keyColumns: string[];
  sourceRows: DataRow[];
  targetRows: DataRow[];
};

/**
 * Diff two row sets. When keyColumns is empty (no primary key), every column is
 * treated as part of the key, so a "change" can only ever surface as an
 * add/remove pair — which is the only safe interpretation without an identity.
 */
export function diffTableData(input: DataDiffInput): DataDiff {
  const keyColumns =
    input.keyColumns.length > 0 ? input.keyColumns : input.columns;
  const compareColumns = input.columns.filter(
    (column) => !keyColumns.includes(column),
  );

  const targetByKey = new Map<string, DataRow>();
  for (const row of input.targetRows) {
    targetByKey.set(rowKey(row, keyColumns), row);
  }
  const sourceByKey = new Map<string, DataRow>();
  for (const row of input.sourceRows) {
    sourceByKey.set(rowKey(row, keyColumns), row);
  }

  const rowsAdded: DataRow[] = [];
  const rowsChanged: ChangedRow[] = [];
  let unchangedCount = 0;

  for (const [key, sourceRow] of sourceByKey) {
    const targetRow = targetByKey.get(key);
    if (!targetRow) {
      rowsAdded.push(sourceRow);
      continue;
    }
    const changedColumns = compareColumns.filter(
      (column) => !valuesEqual(sourceRow[column], targetRow[column]),
    );
    if (changedColumns.length > 0) {
      const keyValues: DataRow = {};
      for (const column of keyColumns) keyValues[column] = sourceRow[column];
      rowsChanged.push({
        key: keyValues,
        source: sourceRow,
        target: targetRow,
        changedColumns,
      });
    } else {
      unchangedCount += 1;
    }
  }

  const rowsRemoved: DataRow[] = [];
  for (const [key, targetRow] of targetByKey) {
    if (!sourceByKey.has(key)) rowsRemoved.push(targetRow);
  }

  return {
    columns: input.columns,
    keyColumns,
    rowsAdded,
    rowsRemoved,
    rowsChanged,
    unchangedCount,
  };
}

/** True when source and target hold identical data. */
export function dataDiffIsEmpty(diff: DataDiff): boolean {
  return (
    diff.rowsAdded.length === 0 &&
    diff.rowsRemoved.length === 0 &&
    diff.rowsChanged.length === 0
  );
}
