// EXECUTION (transient) store — extracted from db-panel-context.tsx as Phase 1,
// PR #4 (final) of the state-layer split. This owns the per-tab query-execution
// atoms — execution status, result/raw payloads, result view/paging, edited
// rows + row-save pending keys, the live (debounced, unsaved) query text, the
// Redis key name/TTL drafts, the execution warning, and the schema-completion
// cache — plus the accessors/mutators that read or write ONLY those atoms.
//
// Façade-preserving: createExecutionStore(deps) is called synchronously inside
// createDbPanelState's reactive owner, so the signals it declares share the same
// SolidJS ownership/lifecycle as before — only their lexical home moved. The
// returned members are destructured back into the coordinator so the rest of the
// factory, the single flat context object, and all six consumers are textually
// unchanged.
//
// Boundary (per the plan's seam rule — "functions writing/reading >1 domain stay
// in the coordinator", plus Risk #1 "the single onMount + 4 createEffects share
// queryPersistTimer and stay whole in the coordinator"):
//   • The cross-domain orchestrators stay in the coordinator: commitWorkspace
//     (reads liveQueryByTabId, writes workspace), runCurrentTab (calls
//     saveCurrentTab + getEffectiveQuery), rerunPagedSourceTab, saveEditedRow
//     (spans 4 domains; its call order + try/finally is preserved verbatim),
//     clearTabArtifacts (tab-close cleanup driven by workspace mutations).
//   • flushLiveQuery stays in the coordinator (reads workspace()).
//   • updateActiveQuery / the queryPersistTimer / the activeEditorView ref and
//     its editor accessors (getEditorSelection / getEffectiveQuery /
//     applyTextResult / get/setActiveEditorView) stay in the coordinator: the
//     timer is shared with the tab-switch lifecycle effect, updateActiveQuery
//     calls flushLiveQuery, and the editor view is read by runCurrentTab.
// Those coordinator functions read/write the atoms here via the destructured
// store bindings.
//
// activeTab is owned by the WORKSPACE store and injected via `deps` rather than
// redeclared. The pure row-key helper (getRowKey) is imported directly.
import { createSignal } from "solid-js";
import type { SQLNamespace } from "@codemirror/lang-sql";
import {
  cancelDbExecution,
  canCancelDbExecution,
  loadSchemaCompletionData,
} from "../service";
import { getRowKey, schemaCompletionKey, sqlLiteral } from "./db-state-helpers";
import type {
  DbConnection,
  DbExecutionState,
  DbResultPayload,
  DbSortOrder,
  DbTab,
} from "../models";

/** Render one CSV cell: stringify, then quote/double any field needing it. */
function escapeCsvCell(value: unknown): string {
  if (value == null) return "";
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build a SpreadsheetML 2003 (.xls) workbook with one typed-cell sheet.
 * Numbers export as Number cells; everything else as String. No dependency.
 */
function buildSpreadsheetXml(
  columns: string[],
  rows: Array<Record<string, unknown>>,
): string {
  const cell = (value: unknown): string => {
    if (value == null) return "<Cell><Data ss:Type=\"String\"></Data></Cell>";
    if (typeof value === "number" && Number.isFinite(value)) {
      return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
    }
    const text =
      typeof value === "string" ? value : JSON.stringify(value);
    return `<Cell><Data ss:Type="String">${escapeXml(text)}</Data></Cell>`;
  };
  const headerRow = `<Row>${columns
    .map((c) => `<Cell><Data ss:Type="String">${escapeXml(c)}</Data></Cell>`)
    .join("")}</Row>`;
  const bodyRows = rows
    .map((row) => `<Row>${columns.map((c) => cell(row[c])).join("")}</Row>`)
    .join("");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Result"><Table>${headerRow}${bodyRows}</Table></Worksheet>
</Workbook>`;
}

export function createExecutionStore(deps: {
  activeTab: () => DbTab | null;
}) {
  const { activeTab } = deps;

  const [schemaCompletionCache, setSchemaCompletionCache] = createSignal<
    Record<string, SQLNamespace>
  >({});
  const [resultByTabId, setResultByTabId] = createSignal<
    Record<string, DbResultPayload>
  >({});
  const [rawByTabId, setRawByTabId] = createSignal<Record<string, string>>({});
  const [executionByTabId, setExecutionByTabId] = createSignal<
    Record<string, DbExecutionState>
  >({});
  const [redisKeyNameDraftByTabId, setRedisKeyNameDraftByTabId] = createSignal<
    Record<string, string>
  >({});
  const [redisKeyTtlDraftByTabId, setRedisKeyTtlDraftByTabId] = createSignal<
    Record<string, string>
  >({});
  const [resultViewByTabId, setResultViewByTabId] = createSignal<
    Record<string, "table" | "raw" | "explain">
  >({});
  const [resultPageByTabId, setResultPageByTabId] = createSignal<
    Record<string, number>
  >({});
  const [resultPageSizeByTabId, setResultPageSizeByTabId] = createSignal<
    Record<string, number>
  >({});
  const [editedRowsByTabId, setEditedRowsByTabId] = createSignal<
    Record<string, Record<string, Record<string, string>>>
  >({});
  const [rowSavePendingKeys, setRowSavePendingKeys] = createSignal<string[]>(
    [],
  );
  const [executionWarning, setExecutionWarning] = createSignal<string | null>(
    null,
  );
  const [liveQueryByTabId, setLiveQueryByTabId] = createSignal<
    Record<string, string>
  >({});
  // Client-side (in-memory) sort for AD-HOC results — never re-queries. Server-
  // paged table sources sort via tab.source.sort + rerunPagedSourceTab instead.
  const [clientSortByTabId, setClientSortByTabId] = createSignal<
    Record<string, DbSortOrder>
  >({});
  // Per-tab set of HIDDEN result columns. Purely presentational (filters the
  // columns handed to the grid); never touches the query or the row data.
  const [hiddenColumnsByTabId, setHiddenColumnsByTabId] = createSignal<
    Record<string, string[]>
  >({});
  // Per-tab grid view options (dbx ContentArea "View Options"). Purely
  // presentational — Hide NULL columns drops all-NULL columns on the current
  // page; Transpose flips the grid into a row-per-column key/value layout.
  const [viewOptionsByTabId, setViewOptionsByTabId] = createSignal<
    Record<string, { hideNullColumns: boolean; transpose: boolean }>
  >({});

  function getViewOptions(tabId: string) {
    return (
      viewOptionsByTabId()[tabId] ?? { hideNullColumns: false, transpose: false }
    );
  }

  function toggleViewOption(
    tabId: string,
    option: "hideNullColumns" | "transpose",
  ) {
    setViewOptionsByTabId((current) => {
      const existing = current[tabId] ?? {
        hideNullColumns: false,
        transpose: false,
      };
      return {
        ...current,
        [tabId]: { ...existing, [option]: !existing[option] },
      };
    });
  }

  /**
   * Columns whose value is NULL/empty across every supplied row — the set
   * "Hide NULL Columns" removes. Pure read over the current page's rows.
   */
  function getNullColumns(
    columns: string[],
    rows: Record<string, unknown>[],
  ): string[] {
    if (rows.length === 0) return [];
    return columns.filter((column) =>
      rows.every((row) => {
        const value = row[column];
        return value === null || value === undefined || value === "";
      }),
    );
  }

  function loadAndCacheSchema(
    connection: DbConnection,
    databaseName?: string | null,
  ) {
    const key = schemaCompletionKey(connection.id, databaseName);
    if (schemaCompletionCache()[key]) return;
    void loadSchemaCompletionData(connection, databaseName).then((schema) => {
      setSchemaCompletionCache((current) => ({ ...current, [key]: schema }));
    });
  }

  async function cancelCurrentExecution() {
    const tab = activeTab();
    if (!tab) return;
    const execution = executionByTabId()[tab.id];
    if (!canCancelDbExecution(execution)) return;
    const requestId =
      execution.status === "running" ? execution.requestId : null;
    if (!requestId) return;

    try {
      await cancelDbExecution(requestId);
      setExecutionByTabId((current) => ({
        ...current,
        [tab.id]: { status: "error", message: "Query cancelled." },
      }));
    } catch (error) {
      setExecutionWarning(
        error instanceof Error ? error.message : "Failed to cancel query.",
      );
    }
  }

  function getActiveResultRows() {
    const tab = activeTab();
    if (!tab) return [] as Array<Record<string, unknown>>;
    const result = resultByTabId()[tab.id];
    return result?.kind === "sql" ? (result.data.rows ?? []) : [];
  }

  function getResultPageSize(tabId: string) {
    return resultPageSizeByTabId()[tabId] ?? 50;
  }

  function getResultPage(tabId: string) {
    return resultPageByTabId()[tabId] ?? 1;
  }

  async function copyCurrentResult() {
    const tab = activeTab();
    if (!tab || !navigator?.clipboard?.writeText) return;
    const result = resultByTabId()[tab.id];
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result.data, null, 2));
  }

  function exportCurrentResult(format: "json" | "csv" | "sql" | "excel") {
    const tab = activeTab();
    if (!tab) return;
    const result = resultByTabId()[tab.id];
    if (!result) return;

    let content = "";
    let type = "application/json;charset=utf-8";
    let extension: string = format;

    const isSql = result.kind === "sql";
    const columns = isSql ? (result.data.columns ?? []) : [];
    const rows = isSql ? (result.data.rows ?? []) : [];

    if (format === "csv" && isSql) {
      content = [
        columns.map(escapeCsvCell).join(","),
        ...rows.map((row) =>
          columns.map((column) => escapeCsvCell(row[column])).join(","),
        ),
      ].join("\n");
      type = "text/csv;charset=utf-8";
    } else if (format === "sql" && isSql) {
      // INSERT statements. Target name from the bound source, else a hint.
      const target =
        tab.source?.qualifiedName ?? tab.source?.label ?? "exported_table";
      const columnList = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
      content = rows
        .map(
          (row) =>
            `INSERT INTO ${target} (${columnList}) VALUES (${columns
              .map((column) => sqlLiteral(row[column]))
              .join(", ")});`,
        )
        .join("\n");
      type = "text/plain;charset=utf-8";
    } else if (format === "excel" && isSql) {
      // SpreadsheetML 2003 — a real, typed spreadsheet Excel/LibreOffice open
      // natively, with no third-party library or ZIP writer needed.
      content = buildSpreadsheetXml(columns, rows);
      type = "application/vnd.ms-excel;charset=utf-8";
      extension = "xls";
    } else {
      content = JSON.stringify(result.data, null, 2);
      extension = "json";
    }

    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${tab.title.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "result"}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function getEditedRows(tabId: string) {
    return editedRowsByTabId()[tabId] ?? {};
  }

  function getVisibleRowValue(
    tabId: string,
    row: Record<string, unknown>,
    index: number,
    column: string,
  ) {
    const rowKey = getRowKey(row, index);
    const edited = getEditedRows(tabId)[rowKey]?.[column];
    if (edited != null) return edited;
    const value = row[column];
    if (value == null) return "NULL";
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  }

  function updateEditedCell(
    tabId: string,
    row: Record<string, unknown>,
    index: number,
    column: string,
    value: string,
  ) {
    const rowKey = getRowKey(row, index);
    setEditedRowsByTabId((current) => ({
      ...current,
      [tabId]: {
        ...(current[tabId] ?? {}),
        [rowKey]: {
          ...((current[tabId] ?? {})[rowKey] ?? {}),
          [column]: value,
        },
      },
    }));
  }

  function resetEditedRow(tabId: string, rowKey: string) {
    setEditedRowsByTabId((current) => ({
      ...current,
      [tabId]: Object.fromEntries(
        Object.entries(current[tabId] ?? {}).filter(([key]) => key !== rowKey),
      ),
    }));
  }

  function getTabQuery(tab: DbTab): string {
    return liveQueryByTabId()[tab.id] ?? tab.query;
  }

  function getClientSort(tabId: string): DbSortOrder | undefined {
    return clientSortByTabId()[tabId];
  }

  function getHiddenColumns(tabId: string): string[] {
    return hiddenColumnsByTabId()[tabId] ?? [];
  }

  /** Filter a column list down to the ones not hidden for this tab. */
  function getVisibleColumns(tabId: string, columns: string[]): string[] {
    const hidden = hiddenColumnsByTabId()[tabId];
    if (!hidden?.length) return columns;
    const hiddenSet = new Set(hidden);
    return columns.filter((column) => !hiddenSet.has(column));
  }

  function toggleColumnVisibility(tabId: string, column: string) {
    setHiddenColumnsByTabId((current) => {
      const existing = current[tabId] ?? [];
      const next = existing.includes(column)
        ? existing.filter((entry) => entry !== column)
        : [...existing, column];
      if (next.length === 0) {
        const { [tabId]: _omit, ...rest } = current;
        return rest;
      }
      return { ...current, [tabId]: next };
    });
  }

  function resetColumnVisibility(tabId: string) {
    setHiddenColumnsByTabId((current) => {
      if (!(tabId in current)) return current;
      const { [tabId]: _omit, ...rest } = current;
      return rest;
    });
  }

  /** Cycle an ad-hoc result column asc → desc → unsorted (mirrors server sort). */
  function toggleClientSort(tabId: string, column: string) {
    setClientSortByTabId((current) => {
      const existing = current[tabId];
      const next = { ...current };
      if (!existing || existing.column !== column) {
        next[tabId] = { column, dir: "asc" };
      } else if (existing.dir === "asc") {
        next[tabId] = { column, dir: "desc" };
      } else {
        delete next[tabId];
      }
      return next;
    });
  }

  /**
   * Stable, type-aware in-memory sort of ad-hoc rows. Numbers compare
   * numerically, everything else by locale string; nullish sorts last on asc.
   * Returns the input untouched when no sort is set (no copy, no churn).
   */
  function sortRowsForClient(
    tabId: string,
    rows: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    const sort = clientSortByTabId()[tabId];
    if (!sort) return rows;
    const factor = sort.dir === "desc" ? -1 : 1;
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const av = a.row[sort.column];
        const bv = b.row[sort.column];
        if (av == null && bv == null) return a.index - b.index;
        if (av == null) return 1;
        if (bv == null) return -1;
        let cmp: number;
        if (typeof av === "number" && typeof bv === "number") {
          cmp = av - bv;
        } else {
          cmp = String(av).localeCompare(String(bv), undefined, {
            numeric: true,
          });
        }
        if (cmp === 0) return a.index - b.index;
        return cmp * factor;
      })
      .map((entry) => entry.row);
  }

  return {
    // execution atoms
    schemaCompletionCache,
    setSchemaCompletionCache,
    resultByTabId,
    setResultByTabId,
    rawByTabId,
    setRawByTabId,
    executionByTabId,
    setExecutionByTabId,
    redisKeyNameDraftByTabId,
    setRedisKeyNameDraftByTabId,
    redisKeyTtlDraftByTabId,
    setRedisKeyTtlDraftByTabId,
    resultViewByTabId,
    setResultViewByTabId,
    resultPageByTabId,
    setResultPageByTabId,
    resultPageSizeByTabId,
    setResultPageSizeByTabId,
    editedRowsByTabId,
    setEditedRowsByTabId,
    rowSavePendingKeys,
    setRowSavePendingKeys,
    executionWarning,
    setExecutionWarning,
    liveQueryByTabId,
    setLiveQueryByTabId,
    clientSortByTabId,
    setClientSortByTabId,
    hiddenColumnsByTabId,
    setHiddenColumnsByTabId,
    viewOptionsByTabId,
    setViewOptionsByTabId,
    // methods
    loadAndCacheSchema,
    cancelCurrentExecution,
    getActiveResultRows,
    getResultPageSize,
    getResultPage,
    copyCurrentResult,
    exportCurrentResult,
    getEditedRows,
    getVisibleRowValue,
    updateEditedCell,
    resetEditedRow,
    getTabQuery,
    getClientSort,
    toggleClientSort,
    sortRowsForClient,
    getHiddenColumns,
    getVisibleColumns,
    toggleColumnVisibility,
    resetColumnVisibility,
    getViewOptions,
    toggleViewOption,
    getNullColumns,
  };
}
