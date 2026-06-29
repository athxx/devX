// Pure local-file preview parsing. Turns the text of a dropped/picked CSV or
// JSON file into a column/row grid the file-preview view can render directly —
// no database, no backend round-trip. CSV reuses the zero-dependency parseCsv
// (RFC 4180); JSON uses the built-in parser with a small normalizer that copes
// with the common shapes (array of objects / array of scalars / single object /
// NDJSON). Parquet is detected but not parsed here — it is a columnar binary
// format that would need a parser or the backend DuckDB path (see TODO).
//
// No I/O, no Solid signals: the context layer reads File.text() and the view
// renders the result, while this stays a trivially testable pure function.

import { parseCsv } from "../../../lib/csv";

export type FilePreviewFormat = "csv" | "json";

export type FilePreviewData = {
  fileName: string;
  format: FilePreviewFormat;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  /** Total parsed row count (the view may cap how many it renders). */
  rowCount: number;
  /** Optional human-readable note, e.g. how a non-tabular shape was coerced. */
  note?: string;
};

/** Classify a file by extension. Returns "parquet" (recognized, unsupported) or null. */
export function detectFormat(
  fileName: string,
): FilePreviewFormat | "parquet" | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "json" || ext === "ndjson" || ext === "jsonl") return "json";
  if (ext === "parquet" || ext === "pq") return "parquet";
  return null;
}

/** Parse CSV/TSV text into a preview grid (header row supplies the columns). */
export function parseCsvPreview(
  fileName: string,
  text: string,
): FilePreviewData {
  const delimiter = fileName.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const { headers, rows } = parseCsv(text, delimiter);
  if (headers.length === 0) {
    throw new Error("The file has no header row.");
  }
  const records = rows.map((cells) =>
    Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? null])),
  );
  return {
    fileName,
    format: "csv",
    columns: headers,
    rows: records,
    rowCount: records.length,
  };
}

/** Union of object keys across rows, preserving first-seen order. */
function unionKeys(rows: Array<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Coerce a parsed JSON value into a preview grid. */
function gridFromJson(
  fileName: string,
  value: unknown,
  note?: string,
): FilePreviewData {
  // Array → rows. Objects become row records; scalars become a single "value" column.
  if (Array.isArray(value)) {
    const objs = value.filter(isPlainObject);
    if (objs.length === value.length && value.length > 0) {
      return {
        fileName,
        format: "json",
        columns: unionKeys(objs),
        rows: objs,
        rowCount: objs.length,
        note,
      };
    }
    // Mixed or scalar array → one "value" column.
    const rows = value.map((item) => ({ value: item }));
    return {
      fileName,
      format: "json",
      columns: ["value"],
      rows,
      rowCount: rows.length,
      note: note ?? (objs.length > 0 ? "Mixed array rendered as a single column." : undefined),
    };
  }

  // Single object → one row.
  if (isPlainObject(value)) {
    return {
      fileName,
      format: "json",
      columns: Object.keys(value),
      rows: [value],
      rowCount: 1,
      note,
    };
  }

  // Scalar at top level → one row, one column.
  return {
    fileName,
    format: "json",
    columns: ["value"],
    rows: [{ value }],
    rowCount: 1,
    note: note ?? "Top-level scalar wrapped into a single row.",
  };
}

/** Parse JSON/NDJSON text into a preview grid. Throws with a clear message on bad input. */
export function parseJsonPreview(
  fileName: string,
  text: string,
): FilePreviewData {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The file is empty.");

  try {
    return gridFromJson(fileName, JSON.parse(trimmed));
  } catch (jsonError) {
    // NDJSON / JSONL fallback: one JSON value per non-empty line.
    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length > 1) {
      try {
        const values = lines.map((line) => JSON.parse(line));
        return gridFromJson(fileName, values, "Parsed as newline-delimited JSON (NDJSON).");
      } catch {
        // fall through to the original error
      }
    }
    const message =
      jsonError instanceof Error ? jsonError.message : String(jsonError);
    throw new Error(`Could not parse JSON: ${message}`);
  }
}
