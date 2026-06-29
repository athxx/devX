// Pure column-lineage analysis. Given a structural snapshot of a database (every
// table's columns + foreign keys + optional view DDL) and the connection's query
// history, surface the columns related to a chosen focus column — from four
// sources, each tagged with a confidence level (mirroring DBX's Field Lineage):
//
//   • foreign-key   (high)   — declared FK constraints touching the focus
//   • view          (high)   — a view whose definition references the focus column
//   • query-history (medium) — JOIN/WHERE equalities pairing the focus column
//   • same-name     (low/med)— a same-named column in another table (heuristic)
//
// No I/O, no Solid signals: the service builds the snapshot/history and the view
// renders the result, while this stays a trivially testable pure function.

export type LineageConfidence = "high" | "medium" | "low";

export type LineageSource =
  | "foreign-key"
  | "view"
  | "query-history"
  | "same-name";

export type LineageRelation = {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  source: LineageSource;
  confidence: LineageConfidence;
  /** Human-readable explanation, e.g. "FK orders.user_id → users.id". */
  detail: string;
};

export type LineageTableInfo = {
  columns: Array<{ name: string; type: string }>;
  foreignKeys: Array<{
    name?: string;
    columns: string[];
    referencedTable: string;
    referencedColumns: string[];
  }>;
  ddl?: string;
  isView?: boolean;
};

export type LineageInput = {
  /** column omitted → whole-table lineage (every column of the focus table). */
  focus: { table: string; column?: string };
  /** Table name → structural info. Names match focus.table / FK referencedTable. */
  snapshot: Record<string, LineageTableInfo>;
  /** Executed SQL to mine for JOIN/WHERE relationships. */
  history: Array<{ query: string }>;
};

export type LineageResult = {
  relations: LineageRelation[];
  warnings: string[];
};

/** Lowercased bare table name (strip any schema qualifier). */
function bareName(name: string): string {
  const trimmed = name.trim().replace(/["`[\]]/g, "");
  const dot = trimmed.lastIndexOf(".");
  return (dot >= 0 ? trimmed.slice(dot + 1) : trimmed).toLowerCase();
}

/** Does a column name look like a key (so a same-name match is more likely real)? */
function looksLikeKey(column: string): boolean {
  return /_id$|^id$|id$/i.test(column);
}

/** Strip line and block comments so they don't confuse the regex miners. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

/**
 * Decide which focus columns to analyze. When a single column is named we use
 * just it; otherwise every column of the focus table.
 */
function focusColumns(input: LineageInput): string[] {
  if (input.focus.column) return [input.focus.column];
  const info = input.snapshot[input.focus.table];
  return info ? info.columns.map((c) => c.name) : [];
}

/** Foreign-key relationships (high confidence), in both directions. */
function fkRelations(input: LineageInput, focusCols: Set<string>): LineageRelation[] {
  const out: LineageRelation[] = [];
  const focusTable = bareName(input.focus.table);
  const focusColSet = new Set([...focusCols].map((c) => c.toLowerCase()));

  for (const [table, info] of Object.entries(input.snapshot)) {
    for (const fk of info.foreignKeys ?? []) {
      fk.columns.forEach((col, i) => {
        const refCol = fk.referencedColumns[i] ?? fk.referencedColumns[0] ?? col;
        const owningIsFocus =
          bareName(table) === focusTable && focusColSet.has(col.toLowerCase());
        const refIsFocus =
          bareName(fk.referencedTable) === focusTable &&
          focusColSet.has(refCol.toLowerCase());
        if (!owningIsFocus && !refIsFocus) return;
        out.push({
          fromTable: table,
          fromColumn: col,
          toTable: fk.referencedTable,
          toColumn: refCol,
          source: "foreign-key",
          confidence: "high",
          detail: `FK ${fk.name ? `${fk.name}: ` : ""}${table}.${col} → ${fk.referencedTable}.${refCol}`,
        });
      });
    }
  }
  return out;
}

/** Same-name columns in other tables (low/medium confidence). */
function sameNameRelations(
  input: LineageInput,
  focusCols: Set<string>,
): LineageRelation[] {
  const out: LineageRelation[] = [];
  const focusTable = bareName(input.focus.table);
  const focusInfo = input.snapshot[input.focus.table];
  const typeOf = (table: string, column: string): string | undefined =>
    input.snapshot[table]?.columns.find(
      (c) => c.name.toLowerCase() === column.toLowerCase(),
    )?.type;

  for (const focusCol of focusCols) {
    const focusType = focusInfo
      ? focusInfo.columns.find((c) => c.name === focusCol)?.type
      : undefined;
    for (const [table, info] of Object.entries(input.snapshot)) {
      if (bareName(table) === focusTable) continue;
      for (const column of info.columns) {
        if (column.name.toLowerCase() !== focusCol.toLowerCase()) continue;
        const otherType = typeOf(table, column.name);
        const typesMatch =
          !!focusType && !!otherType && focusType.toLowerCase() === otherType.toLowerCase();
        const confidence: LineageConfidence =
          typesMatch && looksLikeKey(focusCol) ? "medium" : "low";
        out.push({
          fromTable: input.focus.table,
          fromColumn: focusCol,
          toTable: table,
          toColumn: column.name,
          source: "same-name",
          confidence,
          detail: `Same-named column ${table}.${column.name}${typesMatch ? " (matching type)" : ""}`,
        });
      }
    }
  }
  return out;
}

/** View definitions that reference the focus column (high confidence). */
function viewRelations(
  input: LineageInput,
  focusCols: Set<string>,
): { relations: LineageRelation[]; sawView: boolean } {
  const out: LineageRelation[] = [];
  let sawView = false;
  const focusTable = bareName(input.focus.table);

  for (const [table, info] of Object.entries(input.snapshot)) {
    if (!info.isView || !info.ddl) continue;
    if (bareName(table) === focusTable) continue;
    sawView = true;
    const body = stripComments(info.ddl);
    // Only claim a relationship when the view references the focus *table* and a
    // qualified `table.column` token for one of the focus columns — conservative.
    const refsFocusTable = new RegExp(`\\b${focusTable}\\b`, "i").test(body);
    if (!refsFocusTable) continue;
    for (const focusCol of focusCols) {
      const qualified = new RegExp(`\\b${focusTable}\\s*\\.\\s*${focusCol}\\b`, "i");
      const bare = new RegExp(`\\b${focusCol}\\b`, "i");
      if (qualified.test(body) || bare.test(body)) {
        out.push({
          fromTable: table,
          fromColumn: focusCol,
          toTable: input.focus.table,
          toColumn: focusCol,
          source: "view",
          confidence: "high",
          detail: `View ${table} references ${input.focus.table}.${focusCol}`,
        });
      }
    }
  }
  return { relations: out, sawView };
}

// table.column = table.column  (either side qualified)
const EQUALITY_RE =
  /([A-Za-z_][\w$]*)\s*\.\s*([A-Za-z_][\w$]*)\s*=\s*([A-Za-z_][\w$]*)\s*\.\s*([A-Za-z_][\w$]*)/g;

/** JOIN/WHERE equalities in query history that pair the focus column (medium). */
function historyRelations(
  input: LineageInput,
  focusCols: Set<string>,
): LineageRelation[] {
  const out: LineageRelation[] = [];
  const focusTable = bareName(input.focus.table);
  const focusColSet = new Set([...focusCols].map((c) => c.toLowerCase()));
  const seen = new Set<string>();

  for (const item of input.history) {
    if (!item.query) continue;
    const sql = stripComments(item.query);
    EQUALITY_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = EQUALITY_RE.exec(sql))) {
      const [, lt, lc, rt, rc] = match;
      const leftIsFocus =
        bareName(lt) === focusTable && focusColSet.has(lc.toLowerCase());
      const rightIsFocus =
        bareName(rt) === focusTable && focusColSet.has(rc.toLowerCase());
      if (!leftIsFocus && !rightIsFocus) continue;
      // Orient the relation so the focus side is `from`.
      const [fromT, fromC, toT, toC] = leftIsFocus
        ? [lt, lc, rt, rc]
        : [rt, rc, lt, lc];
      const dedupe = `${fromT}.${fromC}=${toT}.${toC}`.toLowerCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({
        fromTable: fromT,
        fromColumn: fromC,
        toTable: toT,
        toColumn: toC,
        source: "query-history",
        confidence: "medium",
        detail: `History: ${fromT}.${fromC} = ${toT}.${toC}`,
      });
    }
  }
  return out;
}

const CONFIDENCE_RANK: Record<LineageConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};
const SOURCE_RANK: Record<LineageSource, number> = {
  "foreign-key": 0,
  view: 1,
  "query-history": 2,
  "same-name": 3,
};

/** Analyze the focus column(s) and return de-duplicated, sorted relations. */
export function analyzeColumnLineage(input: LineageInput): LineageResult {
  const warnings: string[] = [];
  const cols = focusColumns(input);
  if (cols.length === 0) {
    warnings.push(
      input.focus.column
        ? `Column "${input.focus.column}" was not found on ${input.focus.table}.`
        : `No columns found for ${input.focus.table}.`,
    );
    return { relations: [], warnings };
  }
  const focusCols = new Set(cols);

  const views = viewRelations(input, focusCols);
  const relations = [
    ...fkRelations(input, focusCols),
    ...views.relations,
    ...historyRelations(input, focusCols),
    ...sameNameRelations(input, focusCols),
  ];

  if (input.history.length === 0) {
    warnings.push("No query history for this connection — JOIN/WHERE inference skipped.");
  }
  if (views.sawView) {
    warnings.push("View relationships are inferred heuristically from DDL text; verify against the definition.");
  }

  // Dedupe identical (from,to,source) edges, then stable sort.
  const seen = new Set<string>();
  const deduped = relations.filter((r) => {
    const key = `${r.fromTable}.${r.fromColumn}|${r.toTable}.${r.toColumn}|${r.source}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) => {
    const byConf = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    if (byConf !== 0) return byConf;
    const bySrc = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    if (bySrc !== 0) return bySrc;
    return `${a.toTable}.${a.toColumn}`.localeCompare(`${b.toTable}.${b.toColumn}`);
  });

  return { relations: deduped, warnings };
}
