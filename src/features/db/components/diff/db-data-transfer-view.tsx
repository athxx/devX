import { createSignal, For, Show } from "solid-js";
import { useDbPanel } from "../db-panel-context";

// ── Data transfer / migration (Phase 6) ──────────────────────────────────────
// Copy a table's rows from this connection to another same-kind connection. The
// source table identity is fixed by the tab's source node; the user picks a
// destination connection, an optional destination table/schema name, and whether
// to TRUNCATE first. transferTableData() reads the source in full and renders the
// INSERT SQL, which is opened in a fresh editable query tab on the destination —
// reviewed and run by hand, never auto-executed.

export function DbDataTransferView() {
  const {
    activeTab,
    activeConnection,
    getSameKindConnections,
    dataTransferByTabId,
    runDataTransferForTab,
  } = useDbPanel();

  const tab = activeTab();
  const connection = activeConnection();
  const sourceLabel = tab?.source?.label ?? "table";
  // Destination candidates are same-kind connections other than the source.
  const candidates = getSameKindConnections(connection).filter(
    (c) => c.id !== connection?.id,
  );

  const [targetId, setTargetId] = createSignal(candidates[0]?.id ?? "");
  const [targetTable, setTargetTable] = createSignal(sourceLabel);
  const [truncateFirst, setTruncateFirst] = createSignal(false);
  const [bulkInsert, setBulkInsert] = createSignal(true);

  const state = () => (tab ? dataTransferByTabId()[tab.id] : undefined);

  function transfer() {
    if (!tab) return;
    void runDataTransferForTab(tab.id, targetId(), {
      targetTable: targetTable().trim() || undefined,
      truncateFirst: truncateFirst(),
      bulkInsert: bulkInsert(),
    });
  }

  return (
    <div class="flex h-full min-h-0 w-full flex-col">
      <div
        class="flex flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{ "border-color": "var(--app-border)" }}
      >
        <span class="theme-text text-sm font-semibold">
          Transfer {sourceLabel}
        </span>
        <span class="theme-text-soft text-xs">To</span>
        <select
          class="theme-input h-8 min-w-[160px] rounded-md px-3 text-sm"
          value={targetId()}
          onInput={(e) => setTargetId(e.currentTarget.value)}
        >
          <For each={candidates}>
            {(c) => <option value={c.id}>{c.name}</option>}
          </For>
        </select>
        <span class="theme-text-soft text-xs">as</span>
        <input
          class="theme-input h-8 min-w-[140px] rounded-md px-3 text-sm"
          value={targetTable()}
          placeholder={sourceLabel}
          onInput={(e) => setTargetTable(e.currentTarget.value)}
        />
        <label class="theme-text-soft flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={truncateFirst()}
            onChange={(e) => setTruncateFirst(e.currentTarget.checked)}
          />
          Truncate first
        </label>
        <label class="theme-text-soft flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={bulkInsert()}
            onChange={(e) => setBulkInsert(e.currentTarget.checked)}
          />
          Bulk insert
        </label>
        <button
          class="theme-success h-8 rounded-md px-3 text-sm font-semibold"
          disabled={state()?.status === "loading" || candidates.length === 0}
          onClick={transfer}
        >
          {state()?.status === "loading" ? "Generating…" : "Generate SQL"}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-auto p-3">
        <Show
          when={candidates.length > 0}
          fallback={
            <div class="flex h-full items-center justify-center">
              <span class="theme-text-soft text-sm">
                No other {connection?.kind} connection to transfer into.
              </span>
            </div>
          }
        >
          <Show
            when={state()?.status === "error"}
            fallback={
              <Show
                when={state()?.status === "ready"}
                fallback={
                  <span class="theme-text-soft text-sm">
                    {state()?.status === "loading"
                      ? "Reading source rows…"
                      : "Pick a destination and press Generate SQL. The INSERT statements open in a new tab for review."}
                  </span>
                }
              >
                <div class="theme-success rounded-md px-3 py-2 text-sm">
                  Generated INSERTs for {state()?.rowCount ?? 0} row(s) — opened
                  in a new query tab on the destination.
                </div>
              </Show>
            }
          >
            <span
              class="text-sm"
              style={{ color: "var(--theme-warn, #d97706)" }}
            >
              {state()?.error}
            </span>
          </Show>
        </Show>
      </div>
    </div>
  );
}
