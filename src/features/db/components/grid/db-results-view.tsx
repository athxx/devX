import { For, Show } from "solid-js";
import { DbResultGrid } from "../db-result-grid";
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
    saveEditedRow,
  } = useDbPanel();

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
    const pageSize = tab.source?.pageSize ?? getResultPageSize(tab.id);
    const currentPage = tab.source?.page ?? getResultPage(tab.id);
    const totalRows = sqlResult?.data.rows?.length ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const canGoNext = tab.source
      ? totalRows >= pageSize
      : currentPage < totalPages;
    const pagedRows =
      sqlResult?.data.rows?.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize,
      ) ?? [];
    const activeDetail = getTabObjectDetail(tab) ?? getActiveObjectDetail();
    const dirtyRowKeys = Object.keys(getEditedRows(tab.id));
    const editableSql = Boolean(
      connection &&
      tab.source?.nodeKind === "table" &&
      activeDetail?.primaryKeys?.length &&
      sqlResult?.data.columns?.length,
    );

    const resultMeta = result
      ? `${formatBytes(formatResultSize(result.data))}${
          "durationMs" in result.data && result.data.durationMs
            ? ` | ${result.data.durationMs} ms`
            : ""
        }`
      : null;

    return (
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
                  <div class="min-h-0 flex-1">
                    <DbResultGrid
                      columns={sqlResult?.data.columns ?? []}
                      rows={pagedRows}
                      editable={editableSql}
                      dirtyRowKeys={dirtyRowKeys}
                      pendingRowKeys={rowSavePendingKeys()}
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
                    />
                  </div>
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
                          <div
                            class="theme-code h-full overflow-auto rounded-[18px] border p-3"
                            style={{ "border-color": "var(--app-border)" }}
                          >
                            <pre class="m-0 whitespace-pre-wrap break-words font-mono text-xs">
                              {raw}
                            </pre>
                          </div>
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
          </Show>
        </div>
      </div>
    );
  }

  return renderResultView();
}
