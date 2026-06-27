import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useDbPanel } from "../db-panel-context";

/**
 * Chart view (Phase 4C — dbx QueryChart). Plots the active SQL result with
 * uPlot (canvas, no framework dependency). The first non-numeric column is
 * used as the X label/category; every numeric column becomes a line series.
 * When no X-like column exists, the row index is the X axis. Purely a view
 * over already-fetched rows — no re-query, no backend involvement.
 */

const SERIES_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function DbChartView() {
  const { activeTab, resultByTabId } = useDbPanel();

  // Numeric columns = those whose every non-null value parses as a number.
  const model = createMemo(() => {
    const tab = activeTab();
    if (!tab) return null;
    const result = resultByTabId()[tab.id];
    if (result?.kind !== "sql") return null;
    const columns = result.data.columns ?? [];
    const rows = result.data.rows ?? [];
    if (columns.length === 0 || rows.length === 0) return null;

    const numericColumns = columns.filter((column) =>
      rows.some((row) => toNumber(row[column]) !== null) &&
      rows.every((row) => {
        const v = row[column];
        return v == null || v === "" || toNumber(v) !== null;
      }),
    );
    if (numericColumns.length === 0) return null;
    // X = first non-numeric column if present, else row index.
    const labelColumn = columns.find((c) => !numericColumns.includes(c)) ?? null;
    return { columns, rows, numericColumns, labelColumn };
  });

  // Which numeric series are toggled on (default: all).
  const [enabled, setEnabled] = createSignal<Record<string, boolean>>({});

  const activeSeries = createMemo(() => {
    const m = model();
    if (!m) return [];
    const state = enabled();
    return m.numericColumns.filter((c) => state[c] !== false);
  });

  function toggleSeries(column: string) {
    setEnabled((current) => ({
      ...current,
      [column]: current[column] === false,
    }));
  }

  let host: HTMLDivElement | undefined;
  let plot: uPlot | undefined;

  function destroy() {
    plot?.destroy();
    plot = undefined;
  }
  onCleanup(destroy);

  // Rebuild the plot whenever the data, series selection, or size changes.
  createEffect(() => {
    const m = model();
    const series = activeSeries();
    if (!host || !m) {
      destroy();
      return;
    }
    const xs = m.rows.map((_, index) => index);
    const ys = series.map((column) =>
      m.rows.map((row) => toNumber(row[column])),
    );
    const data = [xs, ...ys] as uPlot.AlignedData;

    const width = host.clientWidth || 600;
    const height = host.clientHeight || 320;

    destroy();
    const opts: uPlot.Options = {
      width,
      height,
      legend: { show: false },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: "var(--app-text-soft)",
          grid: { stroke: "var(--app-border)", width: 1 },
          ticks: { stroke: "var(--app-border)" },
          values: (_self, splits) =>
            splits.map((value) => {
              if (m.labelColumn) {
                const row = m.rows[value];
                return row ? String(row[m.labelColumn!] ?? value) : "";
              }
              return String(value);
            }),
        },
        {
          stroke: "var(--app-text-soft)",
          grid: { stroke: "var(--app-border)", width: 1 },
          ticks: { stroke: "var(--app-border)" },
        },
      ],
      series: [
        {},
        ...series.map((column, index) => ({
          label: column,
          stroke: SERIES_COLORS[index % SERIES_COLORS.length],
          width: 2,
          points: { show: m.rows.length <= 50 },
        })),
      ],
    };
    plot = new uPlot(opts, data, host);
  });

  return (
    <Show
      when={model()}
      fallback={
        <div class="theme-text-soft p-3 text-sm">
          No numeric columns to chart — run a query that returns numbers.
        </div>
      }
    >
      <div class="flex min-h-0 flex-1 flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2 px-1">
          <For each={model()!.numericColumns}>
            {(column, index) => {
              const on = () => enabled()[column] !== false;
              return (
                <button
                  class="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition"
                  classList={{ "opacity-40": !on() }}
                  style={{ border: "1px solid var(--app-border)" }}
                  onClick={() => toggleSeries(column)}
                >
                  <span
                    class="inline-block h-2.5 w-2.5 rounded-full"
                    style={{
                      background:
                        SERIES_COLORS[index() % SERIES_COLORS.length],
                    }}
                  />
                  {column}
                </button>
              );
            }}
          </For>
        </div>
        <div ref={host} class="min-h-0 flex-1" />
      </div>
    </Show>
  );
}
