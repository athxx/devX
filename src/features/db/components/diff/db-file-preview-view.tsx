import { For, Show } from "solid-js";
import { useDbPanel } from "../db-panel-context";

// ── File preview (Phase 6) ───────────────────────────────────────────────────
// Read-only grid for a local CSV/JSON file opened via drag-drop or the picker.
// The file was parsed in the browser by lib/file-preview.ts and the resulting
// grid stored on the tab; this view just renders it. Connection-independent —
// no execution state, no backend. Render is capped to keep large files snappy.

const RENDER_CAP = 500;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DbFilePreviewView() {
  const { activeTab, filePreviewByTabId } = useDbPanel();

  const data = () => {
    const id = activeTab()?.id;
    return id ? filePreviewByTabId()[id] : undefined;
  };

  const visibleRows = () => data()?.rows.slice(0, RENDER_CAP) ?? [];
  const capped = () => (data()?.rowCount ?? 0) > RENDER_CAP;

  return (
    <div class="flex h-full min-h-0 w-full flex-col">
      <Show
        when={data()}
        fallback={
          <div class="flex h-full items-center justify-center">
            <span class="theme-text-soft text-sm">No file loaded.</span>
          </div>
        }
      >
        <div
          class="flex flex-wrap items-center gap-2 border-b px-3 py-2"
          style={{ "border-color": "var(--app-border)" }}
        >
          <span class="theme-text text-sm font-semibold">{data()!.fileName}</span>
          <span class="theme-control rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase">
            {data()!.format}
          </span>
          <span class="theme-text-soft text-xs">
            {data()!.rowCount} rows · {data()!.columns.length} cols
          </span>
          <Show when={data()!.note}>
            <span
              class="text-xs"
              style={{ color: "var(--theme-warn, #d97706)" }}
            >
              {data()!.note}
            </span>
          </Show>
          <Show when={capped()}>
            <span class="theme-text-soft text-xs">
              (showing first {RENDER_CAP})
            </span>
          </Show>
        </div>

        <div class="min-h-0 flex-1 overflow-auto">
          <table class="w-full border-collapse text-xs">
            <thead>
              <tr>
                <For each={data()!.columns}>
                  {(col) => (
                    <th
                      class="theme-text-soft sticky top-0 border-b px-2 py-1 text-left font-semibold"
                      style={{
                        "border-color": "var(--app-border)",
                        "background-color": "var(--app-surface, var(--app-bg))",
                      }}
                    >
                      {col}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={visibleRows()}>
                {(row) => (
                  <tr>
                    <For each={data()!.columns}>
                      {(col) => (
                        <td
                          class="theme-text truncate border-b px-2 py-1"
                          style={{ "border-color": "var(--app-border)" }}
                        >
                          {cellText(row[col])}
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
    </div>
  );
}
