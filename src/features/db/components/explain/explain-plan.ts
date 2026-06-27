// Pure parsing of EXPLAIN output into a renderable plan model (Phase 3C).
//
// Dialects differ: PostgreSQL returns a single "QUERY PLAN" text column with
// indented lines (cost=.. rows=..); MySQL/SQLite return tabular columns. We
// normalize both into a flat list of nodes carrying a depth, a label, and the
// best metric we can extract (estimated cost or row count) for the bar chart.
// Dependency-free — the chart is rendered with plain divs, no viz library.

export type ExplainNode = {
  /** Indentation depth (0 = root). */
  depth: number;
  /** The human-readable plan line / operation label. */
  label: string;
  /** Estimated total cost, when the dialect exposes one. */
  cost?: number;
  /** Estimated row count, when the dialect exposes one. */
  rows?: number;
};

export type ExplainPlan = {
  nodes: ExplainNode[];
  /** Which metric the bars chart — whichever the dialect actually provided. */
  metric: "cost" | "rows" | null;
  /** Raw columns/rows kept for the fallback tabular rendering. */
  columns: string[];
  rawRows: Array<Record<string, unknown>>;
};

/** Leading-whitespace depth of a PG-style plan line (2 spaces ≈ one level). */
function textDepth(line: string): number {
  const leading = line.length - line.trimStart().length;
  return Math.floor(leading / 2);
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Pull `cost=..` / `rows=..` out of a PostgreSQL plan line. */
function parsePgMetrics(line: string): { cost?: number; rows?: number } {
  const cost = line.match(/cost=[\d.]+\.\.([\d.]+)/);
  const rows = line.match(/rows=(\d+)/);
  return {
    cost: cost ? Number(cost[1]) : undefined,
    rows: rows ? Number(rows[1]) : undefined,
  };
}

/**
 * Build a plan model from an EXPLAIN result's columns + rows. Heuristic but
 * resilient: a single text-ish column is read as PG-style indented text;
 * anything else is treated as a tabular plan keyed on common column names.
 */
export function parseExplainPlan(
  columns: string[],
  rows: Array<Record<string, unknown>>,
): ExplainPlan {
  const base: ExplainPlan = {
    nodes: [],
    metric: null,
    columns,
    rawRows: rows,
  };
  if (rows.length === 0) return base;

  // PostgreSQL: a lone column (usually "QUERY PLAN") of indented text lines.
  if (columns.length === 1) {
    const key = columns[0];
    let sawMetric = false;
    const nodes = rows.map((row) => {
      const line = String(row[key] ?? "");
      const { cost, rows: rowEst } = parsePgMetrics(line);
      if (cost !== undefined || rowEst !== undefined) sawMetric = true;
      return {
        depth: textDepth(line),
        label: line.trim(),
        cost,
        rows: rowEst,
      } satisfies ExplainNode;
    });
    return {
      ...base,
      nodes,
      metric: sawMetric
        ? nodes.some((n) => n.cost !== undefined)
          ? "cost"
          : "rows"
        : null,
    };
  }

  // Tabular (MySQL / SQLite / ClickHouse): one node per row. Prefer a "rows"
  // column for the metric; fall back to a "cost"-ish column.
  const rowsCol = columns.find((c) => /^rows?$/i.test(c));
  const costCol = columns.find((c) => /cost|estimate/i.test(c));
  const labelCols = columns.filter(
    (c) => c !== rowsCol && c !== costCol,
  );
  const nodes = rows.map((row) => {
    const label = labelCols
      .map((c) => row[c])
      .filter((v) => v !== null && v !== undefined && v !== "")
      .map((v) => String(v))
      .join(" · ");
    return {
      depth: 0,
      label: label || "(row)",
      rows: rowsCol ? parseNumber(row[rowsCol]) : undefined,
      cost: costCol ? parseNumber(row[costCol]) : undefined,
    } satisfies ExplainNode;
  });
  return {
    ...base,
    nodes,
    metric: rowsCol ? "rows" : costCol ? "cost" : null,
  };
}
