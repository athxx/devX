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
import { getRowKey, schemaCompletionKey } from "./db-state-helpers";
import type {
  DbConnection,
  DbExecutionState,
  DbResultPayload,
  DbTab,
} from "../models";

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
    Record<string, "table" | "raw">
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

  function exportCurrentResult(format: "json" | "csv") {
    const tab = activeTab();
    if (!tab) return;
    const result = resultByTabId()[tab.id];
    if (!result) return;

    let content = "";
    let type = "application/json;charset=utf-8";
    let extension = format;

    if (format === "csv" && result.kind === "sql") {
      const columns = result.data.columns ?? [];
      const rows = result.data.rows ?? [];
      content = [
        columns.join(","),
        ...rows.map((row) =>
          columns
            .map((column) =>
              JSON.stringify(row[column] ?? "").replace(/^"|"$/g, ""),
            )
            .join(","),
        ),
      ].join("\n");
      type = "text/csv;charset=utf-8";
    } else {
      content = JSON.stringify(result.data, null, 2);
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
  };
}
