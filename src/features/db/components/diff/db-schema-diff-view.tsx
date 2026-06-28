import { createSignal, For, Show } from "solid-js";
import { useDbPanel } from "../db-panel-context";
import {
  schemaDiffIsEmpty,
  type SchemaDiff,
  type TableDiff,
} from "../../lib/schema-diff";

// ── Schema diff (Phase 4) ────────────────────────────────────────────────────
// Compare the full table structure of two same-kind connections. Each side is a
// snapshot (table name -> DbObjectDetail) assembled by loadSchemaSnapshot(); the
// pure diffSchemas() in lib/schema-diff.ts produces the structured delta this
// view renders. The connection picker is filtered to the launching connection's
// kind so a diff only ever compares wire-compatible schemas.

function changeCount(diff: TableDiff): number {
  return (
    diff.columnsAdded.length +
    diff.columnsRemoved.length +
    diff.columnsChanged.length +
    diff.indexesAdded.length +
    diff.indexesRemoved.length +
    diff.foreignKeysAdded.length +
    diff.foreignKeysRemoved.length
  );
}

function TableDiffCard(props: { diff: TableDiff }) {
  const [open, setOpen] = createSignal(true);
  return (
    <div
      class="rounded-md border"
      style={{ "border-color": "var(--app-border)" }}
    >
      <button
        class="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span class="theme-text text-sm font-semibold">{props.diff.table}</span>
        <span class="theme-text-soft text-xs">
          {changeCount(props.diff)} change(s)
        </span>
      </button>
      <Show when={open()}>
        <div class="flex flex-col gap-1 px-3 pb-3 text-xs">
          <For each={props.diff.columnsAdded}>
            {(col) => (
              <div style={{ color: "var(--theme-success, #16a34a)" }}>
                + column {col.name} {col.type}
              </div>
            )}
          </For>
          <For each={props.diff.columnsRemoved}>
            {(col) => (
              <div style={{ color: "var(--theme-danger, #dc2626)" }}>
                − column {col.name} {col.type}
              </div>
            )}
          </For>
          <For each={props.diff.columnsChanged}>
            {(change) => (
              <div style={{ color: "var(--theme-warn, #d97706)" }}>
                ~ column {change.name}: {change.changes.join(", ")}
              </div>
            )}
          </For>
          <For each={props.diff.indexesAdded}>
            {(idx) => (
              <div style={{ color: "var(--theme-success, #16a34a)" }}>
                + index {idx.name} ({idx.columns.join(", ")})
              </div>
            )}
          </For>
          <For each={props.diff.indexesRemoved}>
            {(idx) => (
              <div style={{ color: "var(--theme-danger, #dc2626)" }}>
                − index {idx.name} ({idx.columns.join(", ")})
              </div>
            )}
          </For>
          <For each={props.diff.foreignKeysAdded}>
            {(fk) => (
              <div style={{ color: "var(--theme-success, #16a34a)" }}>
                + fk {fk.name} → {fk.referencedTable}
              </div>
            )}
          </For>
          <For each={props.diff.foreignKeysRemoved}>
            {(fk) => (
              <div style={{ color: "var(--theme-danger, #dc2626)" }}>
                − fk {fk.name} → {fk.referencedTable}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function DiffBody(props: { diff: SchemaDiff }) {
  return (
    <Show
      when={!schemaDiffIsEmpty(props.diff)}
      fallback={
        <div class="theme-success rounded-md px-3 py-2 text-sm">
          Schemas are identical ({props.diff.tablesUnchanged.length} tables).
        </div>
      }
    >
      <div class="flex flex-col gap-4">
        <Show when={props.diff.tablesAdded.length > 0}>
          <section class="flex flex-col gap-1">
            <h3
              class="text-xs font-semibold uppercase"
              style={{ color: "var(--theme-success, #16a34a)" }}
            >
              Added tables ({props.diff.tablesAdded.length})
            </h3>
            <For each={props.diff.tablesAdded}>
              {(name) => <div class="theme-text text-sm">+ {name}</div>}
            </For>
          </section>
        </Show>
        <Show when={props.diff.tablesRemoved.length > 0}>
          <section class="flex flex-col gap-1">
            <h3
              class="text-xs font-semibold uppercase"
              style={{ color: "var(--theme-danger, #dc2626)" }}
            >
              Removed tables ({props.diff.tablesRemoved.length})
            </h3>
            <For each={props.diff.tablesRemoved}>
              {(name) => <div class="theme-text text-sm">− {name}</div>}
            </For>
          </section>
        </Show>
        <Show when={props.diff.tablesChanged.length > 0}>
          <section class="flex flex-col gap-2">
            <h3
              class="text-xs font-semibold uppercase"
              style={{ color: "var(--theme-warn, #d97706)" }}
            >
              Changed tables ({props.diff.tablesChanged.length})
            </h3>
            <For each={props.diff.tablesChanged}>
              {(diff) => <TableDiffCard diff={diff} />}
            </For>
          </section>
        </Show>
      </div>
    </Show>
  );
}

export function DbSchemaDiffView() {
  const {
    activeTab,
    activeConnection,
    getSameKindConnections,
    schemaDiffByTabId,
    runSchemaDiffForTab,
  } = useDbPanel();

  const tab = activeTab();
  const connection = activeConnection();
  const candidates = getSameKindConnections(connection);

  const [sourceId, setSourceId] = createSignal(connection?.id ?? "");
  const [targetId, setTargetId] = createSignal(
    candidates.find((c) => c.id !== connection?.id)?.id ?? connection?.id ?? "",
  );

  const state = () => (tab ? schemaDiffByTabId()[tab.id] : undefined);

  function compare() {
    if (!tab) return;
    void runSchemaDiffForTab(tab.id, sourceId(), targetId());
  }

  return (
    <div class="flex h-full min-h-0 w-full flex-col">
      <div
        class="flex flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{ "border-color": "var(--app-border)" }}
      >
        <span class="theme-text text-sm font-semibold">Schema Diff</span>
        <span class="theme-text-soft text-xs">Source</span>
        <select
          class="theme-input h-8 min-w-[180px] rounded-md px-3 text-sm"
          value={sourceId()}
          onInput={(e) => setSourceId(e.currentTarget.value)}
        >
          <For each={candidates}>
            {(c) => <option value={c.id}>{c.name}</option>}
          </For>
        </select>
        <span class="theme-text-soft text-xs">Target</span>
        <select
          class="theme-input h-8 min-w-[180px] rounded-md px-3 text-sm"
          value={targetId()}
          onInput={(e) => setTargetId(e.currentTarget.value)}
        >
          <For each={candidates}>
            {(c) => <option value={c.id}>{c.name}</option>}
          </For>
        </select>
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
          when={state()?.status === "ready" && state()?.diff}
          fallback={
            <div class="flex h-full items-center justify-center">
              <Show
                when={state()?.status === "error"}
                fallback={
                  <span class="theme-text-soft text-sm">
                    {state()?.status === "loading"
                      ? "Loading both schemas…"
                      : "Pick two connections and press Compare."}
                  </span>
                }
              >
                <span class="text-sm" style={{ color: "var(--theme-warn, #d97706)" }}>
                  {state()?.error}
                </span>
              </Show>
            </div>
          }
        >
          <DiffBody diff={state()!.diff!} />
        </Show>
      </div>
    </div>
  );
}
