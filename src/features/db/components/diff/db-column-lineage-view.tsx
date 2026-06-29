import { createSignal, For, Show } from "solid-js";
import { useDbPanel } from "../db-panel-context";
import type {
  LineageConfidence,
  LineageRelation,
  LineageSource,
} from "../../lib/column-lineage";

// ── Column lineage (Phase 6) ─────────────────────────────────────────────────
// For a chosen column (or every column of the focus table), surface related
// columns from four schema-level sources — declared foreign keys, view DDL,
// query-history JOIN/WHERE equalities, and same-named columns — each tagged with
// a confidence level. The pure analyzeColumnLineage() does the work; this view
// picks the focus column, filters by confidence, and renders the relations
// grouped by source. Mirrors db-data-compare-view.tsx in shape.

const SOURCE_GROUPS: Array<{ source: LineageSource; label: string }> = [
  { source: "foreign-key", label: "Foreign keys" },
  { source: "view", label: "Views" },
  { source: "query-history", label: "Query history" },
  { source: "same-name", label: "Same-name columns" },
];

const CONFIDENCE_STYLE: Record<
  LineageConfidence,
  { class?: string; style?: Record<string, string>; label: string }
> = {
  high: { class: "theme-success", label: "High" },
  medium: { style: { color: "var(--theme-warn, #d97706)" }, label: "Medium" },
  low: { class: "theme-text-soft", label: "Low" },
};

function RelationRow(props: { relation: LineageRelation }) {
  const conf = () => CONFIDENCE_STYLE[props.relation.confidence];
  return (
    <div class="flex items-center justify-between gap-2 py-0.5">
      <span class="theme-text truncate text-xs">
        {props.relation.fromTable}.{props.relation.fromColumn}
        {" → "}
        {props.relation.toTable}.{props.relation.toColumn}
        <span class="theme-text-soft"> · {props.relation.detail}</span>
      </span>
      <span
        class={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${conf().class ?? ""}`}
        style={conf().style}
      >
        {conf().label}
      </span>
    </div>
  );
}

export function DbColumnLineageView() {
  const { activeTab, activeConnection, lineageByTabId, runColumnLineageForTab } =
    useDbPanel();

  const tab = activeTab();
  const connection = activeConnection();

  const [focusColumn, setFocusColumn] = createSignal("");
  const [showHigh, setShowHigh] = createSignal(true);
  const [showMedium, setShowMedium] = createSignal(true);
  const [showLow, setShowLow] = createSignal(true);

  const state = () => (tab ? lineageByTabId()[tab.id] : undefined);

  function analyze() {
    if (!tab) return;
    void runColumnLineageForTab(tab.id, focusColumn().trim() || undefined);
  }

  function confidenceVisible(c: LineageConfidence): boolean {
    if (c === "high") return showHigh();
    if (c === "medium") return showMedium();
    return showLow();
  }

  const relations = () =>
    (state()?.result?.relations ?? []).filter((r) =>
      confidenceVisible(r.confidence),
    );

  const grouped = (source: LineageSource) =>
    relations().filter((r) => r.source === source);

  return (
    <div class="flex h-full min-h-0 w-full flex-col">
      <div
        class="flex flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{ "border-color": "var(--app-border)" }}
      >
        <span class="theme-text text-sm font-semibold">
          Lineage {tab?.source?.label ?? "table"}
        </span>
        <span class="theme-text-soft text-xs">Column</span>
        <input
          class="theme-input h-8 min-w-[160px] rounded-md px-3 text-sm"
          placeholder="(whole table)"
          value={focusColumn()}
          onInput={(e) => setFocusColumn(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") analyze();
          }}
        />
        <label class="theme-text-soft flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={showHigh()}
            onChange={(e) => setShowHigh(e.currentTarget.checked)}
          />
          High
        </label>
        <label class="theme-text-soft flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={showMedium()}
            onChange={(e) => setShowMedium(e.currentTarget.checked)}
          />
          Medium
        </label>
        <label class="theme-text-soft flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={showLow()}
            onChange={(e) => setShowLow(e.currentTarget.checked)}
          />
          Low
        </label>
        <button
          class="theme-success h-8 rounded-md px-3 text-sm font-semibold"
          disabled={state()?.status === "loading"}
          onClick={analyze}
        >
          {state()?.status === "loading" ? "Analyzing…" : "Analyze"}
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
                      ? "Reading schema and history…"
                      : "Enter a column (or leave blank for the whole table) and press Analyze."}
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
          <div class="flex flex-col gap-4">
            <Show when={state()!.result!.warnings.length > 0}>
              <div class="flex flex-col gap-1">
                <For each={state()!.result!.warnings}>
                  {(w) => (
                    <div
                      class="rounded-md px-3 py-1.5 text-xs"
                      style={{ color: "var(--theme-warn, #d97706)" }}
                    >
                      {w}
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show
              when={relations().length > 0}
              fallback={
                <div class="theme-text-soft text-sm">
                  No related columns found for this selection.
                </div>
              }
            >
              <For each={SOURCE_GROUPS}>
                {(group) => (
                  <Show when={grouped(group.source).length > 0}>
                    <section class="flex flex-col gap-1">
                      <h3 class="theme-text-soft text-xs font-semibold uppercase">
                        {group.label} ({grouped(group.source).length})
                      </h3>
                      <For each={grouped(group.source)}>
                        {(relation) => <RelationRow relation={relation} />}
                      </For>
                    </section>
                  </Show>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
