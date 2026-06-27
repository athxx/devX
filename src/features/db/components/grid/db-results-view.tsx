import { createSignal, For, Show } from "solid-js";
import { DbResultGrid } from "../db-result-grid";
import { DbExplainView } from "../explain/db-explain-view";
import { ContextMenu } from "../db-menu";
import type { ContextMenuItem } from "../db-menu";
import { canCancelDbExecution } from "../../service";
import type { DbResultPayload } from "../../models";
import {
  formatBytes,
  formatResultSize,
  useDbPanel,
} from "../db-panel-context";

export function DbResultsView() {
  const {
    activeConnection,
    activeTab,
    executionByTabId,
    executionWarning,
    rawByTabId,
    resultByTabId,
    resultViewByTabId,
    rowSavePendingKeys,
    setResultPageByTabId,
    setResultViewByTabId,
    commitWorkspace,
    cancelCurrentExecution,
    getResultPageSize,
    getResultPage,
    copyCurrentResult,
    exportCurrentResult,
    getActiveObjectDetail,
    getTabObjectDetail,
    getEditedRows,
    getRowKey,
    getVisibleRowValue,
    updateEditedCell,
    resetEditedRow,
    rerunPagedSourceTab,
    setSourceSort,
    setGridSort,
    clearGridSort,
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
    refreshActiveTab,
    copyCellValue,
    copyColumnName,
    copyColumnValues,
    copyRowAs,
    copyTextValue,
    saveEditedRow,
  } = useDbPanel();

  const [columnMenuOpen, setColumnMenuOpen] = createSignal(false);
  const [viewOptionsOpen, setViewOptionsOpen] = createSignal(false);
  const [gridMenu, setGridMenu] = createSignal<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  function renderRedisResult(
    result: Extract<DbResultPayload, { kind: "redis" }>,
  ) {
    const value = result.data.result;

    if (Array.isArray(value)) {
      return (
        <div class="grid gap-2">
          <For each={value}>
            {(item, index) => (
              <div
                class="theme-code rounded-[18px] border px-3 py-2"
                style={{ "border-color": "var(--app-border)" }}
              >
                <p class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
                  Item {index() + 1}
                </p>
                <pre class="mt-2 whitespace-pre-wrap break-all font-mono text-xs">
                  {JSON.stringify(item, null, 2)}
                </pre>
              </div>
            )}
          </For>
        </div>
      );
    }

    if (value && typeof value === "object") {
      return (
        <div
          class="theme-code overflow-auto rounded-[18px] border"
          style={{ "border-color": "var(--app-border)" }}
        >
          <table class="min-w-full border-collapse text-sm">
            <tbody>
              <For each={Object.entries(value as Record<string, unknown>)}>
                {([key, item]) => (
                  <tr>
                    <td
                      class="theme-kv-head border-b px-3 py-2 align-top font-medium"
                      style={{ "border-color": "var(--app-border)" }}
                    >
                      {key}
                    </td>
                    <td
                      class="theme-kv-cell border-b px-3 py-2 align-top"
                      style={{ "border-color": "var(--app-border)" }}
                    >
                      <pre class="m-0 whitespace-pre-wrap break-all font-mono text-xs">
                        {JSON.stringify(item, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div
        class="theme-code rounded-[18px] border p-3"
        style={{ "border-color": "var(--app-border)" }}
      >
        <pre class="m-0 whitespace-pre-wrap break-all font-mono text-xs">
          {String(value ?? "")}
        </pre>
      </div>
    );
  }

  function renderMongoResult(
    result: Extract<DbResultPayload, { kind: "mongo" }>,
  ) {
    const value = result.data.result;
    const documents = Array.isArray(value) ? value : [value];

    return (
      <div class="grid gap-2">
        <For each={documents}>
          {(document, index) => (
            <div
              class="theme-code rounded-[18px] border p-3"
              style={{ "border-color": "var(--app-border)" }}
            >
              <p class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
                {Array.isArray(value) ? `Document ${index() + 1}` : "Document"}
              </p>
              <pre class="mt-2 whitespace-pre-wrap break-all font-mono text-xs">
                {JSON.stringify(document, null, 2)}
              </pre>
            </div>
          )}
        </For>
      </div>
    );
  }

  function renderSearchResult(
    result: Extract<DbResultPayload, { kind: "search" }>,
  ) {
    return (
      <div
        class="theme-code rounded-[18px] border p-3"
        style={{ "border-color": "var(--app-border)" }}
      >
        <pre class="m-0 whitespace-pre-wrap break-all font-mono text-xs">
          {JSON.stringify(result.data.result, null, 2)}
        </pre>
      </div>
    );
  }

  function renderWideColumnResult(
    result: Extract<DbResultPayload, { kind: "wideColumn" }>,
  ) {
    return (
      <div
        class="theme-code rounded-[18px] border p-3"
        style={{ "border-color": "var(--app-border)" }}
      >
        <pre class="m-0 whitespace-pre-wrap break-all font-mono text-xs">
          {JSON.stringify(result.data.result, null, 2)}
        </pre>
      </div>
    );
  }

  function renderResultView() {
    const tab = activeTab();
    if (!tab) return null;

    const connection = activeConnection();
    const result = resultByTabId()[tab.id];
    const raw = rawByTabId()[tab.id];
    const execution = executionByTabId()[tab.id] ?? { status: "idle" };
    const resultView = resultViewByTabId()[tab.id] ?? "table";
    const sqlResult = result?.kind === "sql" ? result : null;
    const redisResult = result?.kind === "redis" ? result : null;
    const mongoResult = result?.kind === "mongo" ? result : null;
    const searchResult = result?.kind === "search" ? result : null;
    const wideColumnResult = result?.kind === "wideColumn" ? result : null;
    const pageSize = tab.source?.pageSize ?? getResultPageSize(tab.id);
    const currentPage = tab.source?.page ?? getResultPage(tab.id);
    const totalRows = sqlResult?.data.rows?.length ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const canGoNext = tab.source
      ? totalRows >= pageSize
      : currentPage < totalPages;
    // Ad-hoc results sort in memory (no re-query); server-paged sources are
    // already ordered by the re-queried ORDER BY, so we don't re-sort them.
    const sortedRows = tab.source
      ? (sqlResult?.data.rows ?? [])
      : sortRowsForClient(tab.id, sqlResult?.data.rows ?? []);
    const pagedRows = sortedRows.slice(
      (currentPage - 1) * pageSize,
      currentPage * pageSize,
    );
    const activeSort = tab.source?.sort ?? getClientSort(tab.id);
    const allColumns = sqlResult?.data.columns ?? [];
    const hiddenColumns = getHiddenColumns(tab.id);
    const viewOptions = getViewOptions(tab.id);
    // Columns that are NULL across the current page — the "Hide NULL Columns"
    // toggle drops these on top of the manual hidden-columns set.
    const nullColumns = sqlResult
      ? getNullColumns(allColumns, pagedRows as Record<string, unknown>[])
      : [];
    const visibleColumns = getVisibleColumns(tab.id, allColumns).filter(
      (column) => !viewOptions.hideNullColumns || !nullColumns.includes(column),
    );
    const activeDetail = getTabObjectDetail(tab) ?? getActiveObjectDetail();
    const dirtyRowKeys = Object.keys(getEditedRows(tab.id));
    const editableSql = Boolean(
      connection &&
      tab.source?.nodeKind === "table" &&
      activeDetail?.primaryKeys?.length &&
      sqlResult?.data.columns?.length,
    );

    // ── Grid context menus (dbx DataGrid.vue gridContextMenuItems) ──────────
    // Server-paged sources sort by re-querying with ORDER BY; ad-hoc results
    // sort in memory. Both routed through setGridSort/clearGridSort so the menu
    // can offer explicit asc/desc/clear rather than the header's cycle.
    const menuTabId = tab.id;
    function buildHeaderMenu(column: string): ContextMenuItem[] {
      const sorted = activeSort?.column === column;
      return [
        {
          label: "Sort Ascending",
          icon: "ArrowUp",
          disabled: sorted && activeSort?.dir === "asc",
          action: () => void setGridSort(menuTabId, column, "asc"),
        },
        {
          label: "Sort Descending",
          icon: "ArrowDown",
          disabled: sorted && activeSort?.dir === "desc",
          action: () => void setGridSort(menuTabId, column, "desc"),
        },
        {
          label: "Clear Sort",
          icon: "ArrowUpDown",
          disabled: !activeSort,
          action: () => void clearGridSort(menuTabId),
        },
        { separator: true },
        {
          label: "Copy Column Name",
          icon: "Copy",
          action: () => copyColumnName(column),
        },
        {
          label: "Copy Column Values",
          icon: "Rows3",
          action: () =>
            copyColumnValues(column, pagedRows as Record<string, unknown>[]),
        },
        { separator: true },
        {
          label: "Hide Column",
          icon: "SquareDashed",
          disabled: visibleColumns.length <= 1,
          action: () => toggleColumnVisibility(menuTabId, column),
        },
      ];
    }

    function buildCellMenu(
      row: Record<string, unknown>,
      column: string,
    ): ContextMenuItem[] {
      return [
        {
          label: "Copy Cell",
          icon: "Copy",
          shortcut: "⌘C",
          action: () => copyCellValue(row, column),
        },
        {
          label: "Copy",
          icon: "CopyPlus",
          children: [
            {
              label: "Copy Row as JSON",
              icon: "Braces",
              action: () => copyRowAs(row, "json"),
            },
            {
              label: "Copy Row as INSERT",
              icon: "FileCode",
              action: () => copyRowAs(row, "insert"),
            },
            {
              label: "Copy Row as INSERT (without PK)",
              icon: "FileCode",
              action: () => copyRowAs(row, "insert-no-pk"),
            },
            {
              label: "Copy Row as UPDATE",
              icon: "FileCode",
              action: () => copyRowAs(row, "update"),
            },
            {
              label: "Copy Row as TSV",
              icon: "Rows3",
              action: () => copyRowAs(row, "tsv"),
            },
            { separator: true },
            {
              label: "Copy Column Name",
              icon: "Copy",
              action: () => copyColumnName(column),
            },
          ],
        },
        { separator: true },
        {
          label: "Sort Ascending",
          icon: "ArrowUp",
          action: () => void setGridSort(menuTabId, column, "asc"),
        },
        {
          label: "Sort Descending",
          icon: "ArrowDown",
          action: () => void setGridSort(menuTabId, column, "desc"),
        },
        { separator: true },
        {
          label: "Export",
          icon: "FileDown",
          disabled: !sqlResult,
          children: [
            {
              label: "Export as CSV",
              icon: "FileDown",
              action: () => exportCurrentResult("csv"),
            },
            {
              label: "Export as Excel (XLSX)",
              icon: "FileDown",
              action: () => exportCurrentResult("excel"),
            },
            {
              label: "Export as JSON",
              icon: "Braces",
              action: () => exportCurrentResult("json"),
            },
            {
              label: "Export as Markdown",
              icon: "FileText",
              action: () => exportCurrentResult("markdown"),
            },
            {
              label: "Export as SQL (INSERT)",
              icon: "FileCode",
              action: () => exportCurrentResult("sql"),
            },
          ],
        },
        { separator: true },
        {
          label: "Refresh",
          icon: "RefreshCw",
          action: () => void refreshActiveTab(),
        },
      ];
    }

    const resultMeta = result
      ? `${formatBytes(formatResultSize(result.data))}${
          "durationMs" in result.data && result.data.durationMs
            ? ` | ${result.data.durationMs} ms`
            : ""
        }`
      : null;

    return (
      <>
      <div class="flex min-h-0 flex-1 flex-col">
        <div
          class="flex shrink-0 items-center justify-between border-b px-3 py-2"
          style={{ "border-color": "var(--app-border)" }}
        >
          <div class="flex items-center gap-2">
            <button
              class={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                resultView === "table"
                  ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
                  : "theme-text-soft hover:text-[var(--app-text)]"
              }`}
              onClick={() =>
                setResultViewByTabId((current) => ({
                  ...current,
                  [tab.id]: "table",
                }))
              }
            >
              Results
            </button>
            <button
              class={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                resultView === "raw"
                  ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
                  : "theme-text-soft hover:text-[var(--app-text)]"
              }`}
              onClick={() =>
                setResultViewByTabId((current) => ({
                  ...current,
                  [tab.id]: "raw",
                }))
              }
            >
              Raw
            </button>
            <Show when={resultView === "explain"}>
              <button
                class="rounded-lg bg-[var(--app-accent-soft)] px-2 py-1 text-[11px] font-medium text-[var(--app-accent)]"
              >
                Explain
              </button>
            </Show>
            <Show when={tab.source && sqlResult && totalRows > 0}>
              <select
                class="theme-input h-7 rounded-md px-2 text-[11px]"
                value={String(tab.source?.pageSize ?? pageSize)}
                onInput={(event) => {
                  const nextSize = Number(event.currentTarget.value);
                  void commitWorkspace((draft) => {
                    if (!draft.tabsById[tab.id]?.source) return;
                    draft.tabsById[tab.id].source!.pageSize = nextSize;
                    draft.tabsById[tab.id].source!.page = 1;
                  }).then(() => void rerunPagedSourceTab(tab.id, 1));
                }}
              >
                <option value="25">25 rows</option>
                <option value="50">50 rows</option>
                <option value="100">100 rows</option>
                <option value="200">200 rows</option>
              </select>
            </Show>
          </div>
          <div class="flex items-center gap-2">
            <Show when={sqlResult && allColumns.length > 0}>
              <div class="relative">
                <button
                  class="theme-control h-7 rounded-md px-2.5 text-[11px]"
                  onClick={() => setColumnMenuOpen((open) => !open)}
                >
                  Columns
                  <Show when={hiddenColumns.length > 0}>
                    {" "}
                    <span class="text-[var(--app-accent)]">
                      ({visibleColumns.length}/{allColumns.length})
                    </span>
                  </Show>
                </button>
                <Show when={columnMenuOpen()}>
                  <div
                    class="theme-panel-soft absolute right-0 z-20 mt-1 max-h-72 w-52 overflow-auto rounded-lg border p-1 shadow-lg"
                    style={{ "border-color": "var(--app-border)" }}
                  >
                    <div class="flex items-center justify-between px-2 py-1">
                      <span class="theme-text-soft text-[10px] uppercase tracking-[0.14em]">
                        Columns
                      </span>
                      <button
                        class="theme-text-soft text-[10px] hover:text-[var(--app-text)]"
                        disabled={hiddenColumns.length === 0}
                        onClick={() => resetColumnVisibility(tab.id)}
                      >
                        Show all
                      </button>
                    </div>
                    <For each={allColumns}>
                      {(column) => {
                        const hidden = hiddenColumns.includes(column);
                        const lastVisible =
                          !hidden && visibleColumns.length <= 1;
                        return (
                          <label
                            class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] hover:bg-[var(--app-hover)]"
                            classList={{ "opacity-50": lastVisible }}
                          >
                            <input
                              type="checkbox"
                              checked={!hidden}
                              disabled={lastVisible}
                              onChange={() =>
                                toggleColumnVisibility(tab.id, column)
                              }
                            />
                            <span class="overflow-hidden text-ellipsis whitespace-nowrap">
                              {column}
                            </span>
                          </label>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={sqlResult && allColumns.length > 0}>
              <div class="relative">
                <button
                  class="theme-control h-7 rounded-md px-2.5 text-[11px]"
                  onClick={() => setViewOptionsOpen((open) => !open)}
                >
                  View
                  <Show
                    when={
                      viewOptions.hideNullColumns || viewOptions.transpose
                    }
                  >
                    {" "}
                    <span class="text-[var(--app-accent)]">•</span>
                  </Show>
                </button>
                <Show when={viewOptionsOpen()}>
                  <div
                    class="theme-panel-soft absolute right-0 z-20 mt-1 w-56 overflow-auto rounded-lg border p-1 shadow-lg"
                    style={{ "border-color": "var(--app-border)" }}
                  >
                    <div class="px-2 py-1">
                      <span class="theme-text-soft text-[10px] uppercase tracking-[0.14em]">
                        View Options
                      </span>
                    </div>
                    <label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] hover:bg-[var(--app-hover)]">
                      <input
                        type="checkbox"
                        checked={viewOptions.hideNullColumns}
                        onChange={() =>
                          toggleViewOption(tab.id, "hideNullColumns")
                        }
                      />
                      <span>
                        Hide NULL Columns
                        <Show when={nullColumns.length > 0}>
                          {" "}
                          <span class="theme-text-soft">
                            ({nullColumns.length})
                          </span>
                        </Show>
                      </span>
                    </label>
                    <label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] hover:bg-[var(--app-hover)]">
                      <input
                        type="checkbox"
                        checked={viewOptions.transpose}
                        onChange={() => toggleViewOption(tab.id, "transpose")}
                      />
                      <span>Transpose Row</span>
                    </label>
                  </div>
                </Show>
              </div>
            </Show>
            <button
              class="theme-control h-7 rounded-md px-2.5 text-[11px]"
              disabled={!result}
              title="Refresh"
              onClick={() => void refreshActiveTab()}
            >
              Refresh
            </button>
            <button
              class="theme-control h-7 rounded-md px-2.5 text-[11px]"
              disabled={!result}
              onClick={() => void copyCurrentResult()}
            >
              Copy
            </button>
            <button
              class="theme-control h-7 rounded-md px-2.5 text-[11px]"
              disabled={!result}
              onClick={() => exportCurrentResult("json")}
            >
              JSON
            </button>
            <button
              class="theme-control h-7 rounded-md px-2.5 text-[11px]"
              disabled={!sqlResult}
              onClick={() => exportCurrentResult("csv")}
            >
              CSV
            </button>
            <button
              class="theme-control h-7 rounded-md px-2.5 text-[11px]"
              disabled={!sqlResult}
              onClick={() => exportCurrentResult("sql")}
            >
              SQL
            </button>
            <button
              class="theme-control h-7 rounded-md px-2.5 text-[11px]"
              disabled={!sqlResult}
              onClick={() => exportCurrentResult("excel")}
            >
              Excel
            </button>
            <button
              class="theme-control h-7 rounded-md px-2.5 text-[11px]"
              disabled={!sqlResult}
              onClick={() => exportCurrentResult("markdown")}
            >
              Markdown
            </button>
            <Show when={canCancelDbExecution(executionByTabId()[tab.id])}>
              <button
                class="rounded-md bg-[#ffebe9] px-2.5 py-1 text-[11px] font-semibold text-[#b42318]"
                onClick={() => void cancelCurrentExecution()}
              >
                Cancel
              </button>
            </Show>
            <div class="theme-text-soft text-xs">
              <Show when={execution.status === "running"}>Running...</Show>
              <Show when={execution.status === "error"}>
                {execution.status === "error" ? execution.message : ""}
              </Show>
              <Show when={execution.status === "success" && resultMeta}>
                {resultMeta}
              </Show>
            </div>
          </div>
        </div>
        <Show when={executionWarning()}>
          <div
            class="border-b bg-[rgba(255,245,229,0.7)] px-3 py-2 text-[11px] text-[#b54708]"
            style={{ "border-color": "var(--app-border)" }}
          >
            {executionWarning()}
          </div>
        </Show>
        <div class="min-h-0 flex-1 overflow-auto p-3">
          <Show
            when={result}
            fallback={
              <div class="theme-text-soft text-sm">
                Run a query to see results.
              </div>
            }
          >
            <Show when={resultView === "explain"} fallback={
            <Show
              when={resultView === "raw" || result?.kind !== "sql"}
              fallback={
                <Show
                  when={
                    sqlResult && sqlResult.data.columns && sqlResult.data.rows
                  }
                  fallback={
                    <div class="grid gap-3 md:grid-cols-2">
                      <div
                        class="theme-code rounded-[18px] border px-4 py-3"
                        style={{ "border-color": "var(--app-border)" }}
                      >
                        <p class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
                          Affected Rows
                        </p>
                        <p class="theme-text mt-2 text-lg font-semibold">
                          {sqlResult?.data.affectedRows ?? 0}
                        </p>
                      </div>
                      <div
                        class="theme-code rounded-[18px] border px-4 py-3"
                        style={{ "border-color": "var(--app-border)" }}
                      >
                        <p class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
                          Last Insert ID
                        </p>
                        <p class="theme-text mt-2 text-lg font-semibold">
                          {sqlResult?.data.lastInsertId ?? 0}
                        </p>
                      </div>
                    </div>
                  }
                >
                  <Show
                    when={viewOptions.transpose}
                    fallback={
                  <div class="min-h-0 flex-1">
                    <DbResultGrid
                      columns={visibleColumns}
                      rows={pagedRows}
                      editable={editableSql}
                      dirtyRowKeys={dirtyRowKeys}
                      pendingRowKeys={rowSavePendingKeys()}
                      sortColumn={activeSort?.column ?? null}
                      sortDir={activeSort?.dir ?? null}
                      onSort={(column) => {
                        if (tab.source) {
                          void setSourceSort(tab.id, column);
                        } else {
                          toggleClientSort(tab.id, column);
                        }
                      }}
                      getRowKey={(row, index) => getRowKey(row, index)}
                      getCellValue={(row, column) =>
                        getVisibleRowValue(
                          tab.id,
                          row,
                          pagedRows.indexOf(row),
                          column,
                        )
                      }
                      onCellInput={(rowKey, column, value) => {
                        const rowIndex = pagedRows.findIndex(
                          (row, index) => getRowKey(row, index) === rowKey,
                        );
                        if (rowIndex < 0) return;
                        updateEditedCell(
                          tab.id,
                          pagedRows[rowIndex],
                          rowIndex,
                          column,
                          value,
                        );
                      }}
                      onSaveRow={(rowKey) => void saveEditedRow(rowKey)}
                      onResetRow={(rowKey) => resetEditedRow(tab.id, rowKey)}
                      onCellContextMenu={(row, _rowIndex, column, event) =>
                        setGridMenu({
                          x: event.clientX,
                          y: event.clientY,
                          items: buildCellMenu(row, column),
                        })
                      }
                      onHeaderContextMenu={(column, event) =>
                        setGridMenu({
                          x: event.clientX,
                          y: event.clientY,
                          items: buildHeaderMenu(column),
                        })
                      }
                    />
                  </div>
                    }
                  >
                    {/* Transposed view: one row per column key, one value
                        column per source row (dbx "Transpose Multi-Row"). */}
                    <div
                      class="theme-code min-h-0 flex-1 overflow-auto rounded-[18px] border"
                      style={{ "border-color": "var(--app-border)" }}
                    >
                      <table class="min-w-full border-collapse text-sm">
                        <tbody>
                          <For each={visibleColumns}>
                            {(column) => (
                              <tr>
                                <td
                                  class="theme-kv-head border-b px-3 py-2 align-top font-medium"
                                  style={{ "border-color": "var(--app-border)" }}
                                >
                                  {column}
                                </td>
                                <For each={pagedRows}>
                                  {(row, rowIndex) => (
                                    <td
                                      class="theme-kv-cell border-b px-3 py-2 align-top font-mono text-xs"
                                      style={{
                                        "border-color": "var(--app-border)",
                                      }}
                                    >
                                      {getVisibleRowValue(
                                        tab.id,
                                        row,
                                        rowIndex(),
                                        column,
                                      )}
                                    </td>
                                  )}
                                </For>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </Show>
                  <Show
                    when={sqlResult && (tab.source || totalRows > pageSize)}
                  >
                    <div
                      class="shrink-0 flex items-center justify-between gap-2 border-t px-3 py-1.5 text-[11px]"
                      style={{ "border-color": "var(--app-border)" }}
                    >
                      <span class="theme-text-soft">
                        {`Showing ${Math.min((currentPage - 1) * pageSize + 1, totalRows)}-${Math.min(currentPage * pageSize, totalRows)} of ${totalRows}`}
                      </span>
                      <div class="flex items-center gap-2">
                        <button
                          class="theme-control h-7 rounded-md px-2.5"
                          disabled={currentPage <= 1}
                          onClick={() => {
                            const nextPage = Math.max(1, currentPage - 1);
                            if (tab.source) {
                              void rerunPagedSourceTab(tab.id, nextPage);
                            } else {
                              setResultPageByTabId((current) => ({
                                ...current,
                                [tab.id]: nextPage,
                              }));
                            }
                          }}
                        >
                          Prev
                        </button>
                        <span class="theme-text-soft">
                          {tab.source
                            ? `Page ${currentPage}`
                            : `${currentPage} / ${totalPages}`}
                        </span>
                        <button
                          class="theme-control h-7 rounded-md px-2.5"
                          disabled={!canGoNext}
                          onClick={() => {
                            const nextPage = Math.min(
                              totalPages,
                              currentPage + 1,
                            );
                            if (tab.source) {
                              void rerunPagedSourceTab(tab.id, nextPage);
                            } else {
                              setResultPageByTabId((current) => ({
                                ...current,
                                [tab.id]: nextPage,
                              }));
                            }
                          }}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </Show>
                </Show>
              }
            >
              <Show
                when={resultView === "raw"}
                fallback={
                  <Show
                    when={redisResult}
                    fallback={
                      <Show
                        when={mongoResult}
                        fallback={
                          <Show
                            when={searchResult}
                            fallback={
                              <Show
                                when={wideColumnResult}
                                fallback={
                                  <div
                                    class="theme-code h-full overflow-auto rounded-[18px] border p-3"
                                    style={{
                                      "border-color": "var(--app-border)",
                                    }}
                                  >
                                    <pre class="m-0 whitespace-pre-wrap break-words font-mono text-xs">
                                      {raw}
                                    </pre>
                                  </div>
                                }
                              >
                                {renderWideColumnResult(wideColumnResult!)}
                              </Show>
                            }
                          >
                            {renderSearchResult(searchResult!)}
                          </Show>
                        }
                      >
                        {renderMongoResult(mongoResult!)}
                      </Show>
                    }
                  >
                    {renderRedisResult(redisResult!)}
                  </Show>
                }
              >
                <div
                  class="theme-code h-full overflow-auto rounded-[18px] border p-3"
                  style={{ "border-color": "var(--app-border)" }}
                >
                  <pre class="m-0 whitespace-pre-wrap break-words font-mono text-xs">
                    {raw}
                  </pre>
                </div>
              </Show>
            </Show>
            }>
              <DbExplainView />
            </Show>
          </Show>
        </div>
      </div>
      <ContextMenu
        position={gridMenu()}
        items={gridMenu()?.items ?? []}
        onClose={() => setGridMenu(null)}
      />
      </>
    );
  }

  return renderResultView();
}
