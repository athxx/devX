import { createSignal, For, Show } from "solid-js";

type DbResultGridProps = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  editable?: boolean;
  dirtyRowKeys?: string[];
  pendingRowKeys?: string[];
  /** Active sort indicator for the header; absent = unsorted. */
  sortColumn?: string | null;
  sortDir?: "asc" | "desc" | null;
  /** Header click. When omitted, headers are not interactive. */
  onSort?: (column: string) => void;
  getCellValue: (row: Record<string, unknown>, column: string) => string;
  getRowKey: (row: Record<string, unknown>, index: number) => string;
  onCellInput?: (rowKey: string, column: string, value: string) => void;
  onSaveRow?: (rowKey: string) => void;
  onResetRow?: (rowKey: string) => void;
};

const DefaultColumnWidth = 150;
const MinColumnWidth = 60;

export function DbResultGrid(props: DbResultGridProps) {
  const [columnWidths, setColumnWidths] = createSignal<Record<string, number>>(
    {},
  );

  function getColumnWidth(column: string): number {
    return columnWidths()[column] ?? DefaultColumnWidth;
  }

  function startColumnResize(column: string, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = getColumnWidth(column);

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = Math.max(MinColumnWidth, startWidth + delta);
      setColumnWidths((prev) => ({ ...prev, [column]: next }));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
  }

  const totalWidth = () => {
    const cols = props.columns;
    let w = 0;
    for (const col of cols) w += getColumnWidth(col);
    if (props.editable) w += 120;
    return w;
  };

  const borderColor = "var(--app-border)";
  const headerBg = "var(--app-surface)";

  return (
    <div class="h-full w-full overflow-auto">
      <table
        class="text-xs font-mono"
        style={{
          "border-collapse": "collapse",
          "table-layout": "fixed",
          width: `${totalWidth()}px`,
        }}
      >
        <thead class="sticky top-0 z-10">
          <tr>
            <For each={props.columns}>
              {(column) => (
                <th
                  class={`relative select-none whitespace-nowrap px-2.5 py-1.5 text-left text-[11px] font-semibold ${
                    props.onSort ? "cursor-pointer hover:text-[var(--app-text)]" : ""
                  }`}
                  style={{
                    width: `${getColumnWidth(column)}px`,
                    "min-width": `${MinColumnWidth}px`,
                    background: headerBg,
                    color: "var(--app-text-soft)",
                    "border-right": `1px solid ${borderColor}`,
                    "border-bottom": `1px solid ${borderColor}`,
                  }}
                  onClick={() => props.onSort?.(column)}
                >
                  <span class="flex items-center gap-1 overflow-hidden">
                    <span class="overflow-hidden text-ellipsis">{column}</span>
                    <Show when={props.sortColumn === column && props.sortDir}>
                      <span class="shrink-0 text-[var(--app-accent)]">
                        {props.sortDir === "desc" ? "▼" : "▲"}
                      </span>
                    </Show>
                  </span>
                  <div
                    class="absolute right-0 top-0 h-full w-1.5 cursor-col-resize"
                    style={{ "z-index": "1" }}
                    onMouseDown={(e) => startColumnResize(column, e)}
                  />
                </th>
              )}
            </For>
            <Show when={props.editable}>
              <th
                class="whitespace-nowrap px-2.5 py-1.5 text-left text-[11px] font-semibold"
                style={{
                  width: "120px",
                  "min-width": "120px",
                  background: headerBg,
                  color: "var(--app-text-soft)",
                  "border-bottom": `1px solid ${borderColor}`,
                }}
              >
                Actions
              </th>
            </Show>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row, index) => {
              const rowKey = props.getRowKey(row, index());
              const dirty = () => props.dirtyRowKeys?.includes(rowKey) ?? false;
              const pending = () =>
                props.pendingRowKeys?.includes(rowKey) ?? false;

              return (
                <tr class="hover:bg-[var(--app-hover)]">
                  <For each={props.columns}>
                    {(column) => (
                      <td
                        class="whitespace-nowrap overflow-hidden text-ellipsis px-2.5 py-1 align-top"
                        style={{
                          width: `${getColumnWidth(column)}px`,
                          "max-width": `${getColumnWidth(column)}px`,
                          "border-right": `1px solid ${borderColor}`,
                          "border-bottom": `1px solid ${borderColor}`,
                          color: "var(--app-text)",
                        }}
                      >
                        <Show
                          when={props.editable && props.onCellInput}
                          fallback={
                            <span class="select-text block overflow-hidden text-ellipsis">
                              {props.getCellValue(row, column)}
                            </span>
                          }
                        >
                          <textarea
                            class="theme-input min-h-[32px] w-full rounded px-1.5 py-0.5 text-xs"
                            value={props.getCellValue(row, column)}
                            onInput={(event) =>
                              props.onCellInput?.(
                                rowKey,
                                column,
                                event.currentTarget.value,
                              )
                            }
                          />
                        </Show>
                      </td>
                    )}
                  </For>
                  <Show when={props.editable}>
                    <td
                      class="whitespace-nowrap px-2.5 py-1 align-top"
                      style={{
                        width: "120px",
                        "border-bottom": `1px solid ${borderColor}`,
                      }}
                    >
                      <div class="flex items-center gap-1.5">
                        <button
                          class="theme-success h-6 rounded px-2 text-[11px] font-semibold"
                          disabled={!dirty() || pending()}
                          onClick={() => props.onSaveRow?.(rowKey)}
                        >
                          {pending() ? "Saving..." : "Save"}
                        </button>
                        <button
                          class="theme-control h-6 rounded px-2 text-[11px]"
                          disabled={!dirty() || pending()}
                          onClick={() => props.onResetRow?.(rowKey)}
                        >
                          Reset
                        </button>
                      </div>
                    </td>
                  </Show>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
    </div>
  );
}
