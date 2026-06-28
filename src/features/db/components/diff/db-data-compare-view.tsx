import { createSignal, For, Show } from "solid-js";
import { useDbPanel } from "../db-panel-context";
import { dataDiffIsEmpty, type DataDiff } from "../../lib/data-compare";

// ── Data compare (Phase 6) ───────────────────────────────────────────────────
// Compare the *rows* of one table between two same-kind connections. The table
// identity is fixed by the tab's source node (the leaf the compare was launched
// from); the pure diffTableData() keyed by the source table's primary key
// produces the row delta, and compareTableData() in service.ts also renders the
// sync SQL that would make the target match the source. This view picks the two
// connections, triggers the compare, summarizes the delta, and opens the sync
// SQL in a fresh query tab for review.

function summaryLine(diff: DataDiff): string {
  return (
    `${diff.rowsAdded.length} only in source · ` +
    `${diff.rowsChanged.length} changed · ` +
    `${diff.rowsRemoved.length} only in target · ` +
    `${diff.unchangedCount} identical`
  );
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function DiffBody(props: {
  diff: DataDiff;
  onOpenSync: () => void;
  syncReady: boolean;
}) {
  return (
    <Show
      when={!dataDiffIsEmpty(props.diff)}
      fallback={
        <div class="theme-success rounded-md px-3 py-2 text-sm">
          Data is identical ({props.diff.unchangedCount} rows).
        </div>
      }
    >
      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="theme-text-soft text-xs">{summaryLine(props.diff)}</span>
          <Show when={props.syncReady}>
            <button
              class="theme-success h-8 rounded-md px-3 text-sm font-semibold"
              onClick={props.onOpenSync}
            >
              Open sync SQL
            </button>
          </Show>
        </div>

        <Show when={props.diff.keyColumns.length === 0}>
          <div
            class="rounded-md px-3 py-2 text-xs"
            style={{ color: "var(--theme-warn, #d97706)" }}
          >
            No primary key — rows matched on all columns; only inserts/deletes
            are produced.
          </div>
        </Show>

        <Show when={props.diff.rowsAdded.length > 0}>
          <section class="flex flex-col gap-1">
            <h3
              class="text-xs font-semibold uppercase"
              style={{ color: "var(--theme-success, #16a34a)" }}
            >
              Only in source ({props.diff.rowsAdded.length})
            </h3>
            <For each={props.diff.rowsAdded.slice(0, 200)}>
              {(row) => (
                <div class="theme-text-soft truncate text-xs">
                  + {props.diff.columns.map((c) => cellText(row[c])).join(" | ")}
                </div>
              )}
            </For>
          </section>
        </Show>

        <Show when={props.diff.rowsChanged.length > 0}>
          <section class="flex flex-col gap-1">
            <h3
              class="text-xs font-semibold uppercase"
              style={{ color: "var(--theme-warn, #d97706)" }}
            >
              Changed ({props.diff.rowsChanged.length})
            </h3>
            <For each={props.diff.rowsChanged.slice(0, 200)}>
              {(change) => (
                <div class="theme-text-soft truncate text-xs">
                  ~ {props.diff.keyColumns.map((c) => cellText(change.key[c])).join(", ")}
                  {": "}
                  {change.changedColumns
                    .map(
                      (c) =>
                        `${c} ${cellText(change.target[c])} → ${cellText(change.source[c])}`,
                    )
                    .join("; ")}
                </div>
              )}
            </For>
          </section>
        </Show>

        <Show when={props.diff.rowsRemoved.length > 0}>
          <section class="flex flex-col gap-1">
            <h3
              class="text-xs font-semibold uppercase"
              style={{ color: "var(--theme-danger, #dc2626)" }}
            >
              Only in target ({props.diff.rowsRemoved.length})
            </h3>
            <For each={props.diff.rowsRemoved.slice(0, 200)}>
              {(row) => (
                <div class="theme-text-soft truncate text-xs">
                  − {props.diff.columns.map((c) => cellText(row[c])).join(" | ")}
                </div>
              )}
            </For>
          </section>
        </Show>
      </div>
    </Show>
  );
}

export function DbDataCompareView() {
  const {
    activeTab,
    activeConnection,
    getSameKindConnections,
    dataCompareByTabId,
    runDataCompareForTab,
    openSyncSqlTab,
  } = useDbPanel();

  const tab = activeTab();
  const connection = activeConnection();
  const candidates = getSameKindConnections(connection);

  const [sourceId, setSourceId] = createSignal(connection?.id ?? "");
  const [targetId, setTargetId] = createSignal(
    candidates.find((c) => c.id !== connection?.id)?.id ?? connection?.id ?? "",
  );
  const [includeDeletes, setIncludeDeletes] = createSignal(false);

  const state = () => (tab ? dataCompareByTabId()[tab.id] : undefined);

  function compare() {
    if (!tab) return;
    void runDataCompareForTab(
      tab.id,
      sourceId(),
      targetId(),
      includeDeletes(),
    );
  }

  function openSync() {
    const result = state()?.result;
    if (!result || !connection) return;
    void openSyncSqlTab(
      connection,
      `Sync ${tab?.source?.label ?? "table"}`,
      result.syncSql,
    );
  }

  return (
    <div class="flex h-full min-h-0 w-full flex-col">
      <div
        class="flex flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{ "border-color": "var(--app-border)" }}
      >
        <span class="theme-text text-sm font-semibold">
          Compare {tab?.source?.label ?? "table"}
        </span>
        <span class="theme-text-soft text-xs">Source</span>
        <select
          class="theme-input h-8 min-w-[160px] rounded-md px-3 text-sm"
          value={sourceId()}
          onInput={(e) => setSourceId(e.currentTarget.value)}
        >
          <For each={candidates}>
            {(c) => <option value={c.id}>{c.name}</option>}
          </For>
        </select>
        <span class="theme-text-soft text-xs">Target</span>
        <select
          class="theme-input h-8 min-w-[160px] rounded-md px-3 text-sm"
          value={targetId()}
          onInput={(e) => setTargetId(e.currentTarget.value)}
        >
          <For each={candidates}>
            {(c) => <option value={c.id}>{c.name}</option>}
          </For>
        </select>
        <label class="theme-text-soft flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={includeDeletes()}
            onChange={(e) => setIncludeDeletes(e.currentTarget.checked)}
          />
          Emit DELETEs
        </label>
        <button
          class="theme-success h-8 rounded-md px-3 text-sm font-semibold"
          disabled={state()?.status === "loading"}
          onClick={compare}
        >
          {state()?.status === "loading" ? "Comparing…" : "Compare"}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-auto p-3">
        <Show
          when={state()?.status === "ready" && state()?.result}
          fallback={
            <div class="flex h-full items-center justify-center">
              <Show
                when={state()?.status === "error"}
                fallback={
                  <span class="theme-text-soft text-sm">
                    {state()?.status === "loading"
                      ? "Reading both tables…"
                      : "Pick two connections and press Compare."}
                  </span>
                }
              >
                <span
                  class="text-sm"
                  style={{ color: "var(--theme-warn, #d97706)" }}
                >
                  {state()?.error}
                </span>
              </Show>
            </div>
          }
        >
          <DiffBody
            diff={state()!.result!.diff}
            onOpenSync={openSync}
            syncReady={!dataDiffIsEmpty(state()!.result!.diff)}
          />
        </Show>
      </div>
    </div>
  );
}
