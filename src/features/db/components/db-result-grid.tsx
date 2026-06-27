import { createMemo, createSignal, For, Show } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";

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
  /** Right-click on a data cell — opens the dbx grid context menu. */
  onCellContextMenu?: (
    row: Record<string, unknown>,
    rowIndex: number,
    column: string,
    event: MouseEvent,
  ) => void;
  /** Right-click on a column header — opens the header/sort context menu. */
  onHeaderContextMenu?: (column: string, event: MouseEvent) => void;
};

const DefaultColumnWidth = 150;
const MinColumnWidth = 60;
const EstimatedRowHeight = 30;
// Below this row count windowing buys nothing — render the lot and skip the
// virtualizer's measurement/scroll bookkeeping (which fights manual resize).
const VirtualizeThreshold = 100;

export function DbResultGrid(props: DbResultGridProps) {
  const [columnWidths, setColumnWidths] = createSignal<Record<string, number>>(
    {},
  );
  let scrollRef: HTMLDivElement | undefined;

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

  const shouldVirtualize = createMemo(
    () => props.rows.length > VirtualizeThreshold,
  );

  // Headless windowing. Measured against the scroll container; rows keep their
  // natural <tr> height via measureElement so dynamic (editable textarea) rows
  // don't clip. When row count is small we bypass this entirely (see render).
  const virtualizer = createVirtualizer({
    get count() {
      return props.rows.length;
    },
    getScrollElement: () => scrollRef ?? null,
    estimateSize: () => EstimatedRowHeight,
    overscan: 12,
  });

  const borderColor = "var(--app-border)";
  const headerBg = "var(--app-surface)";

  function renderRow(row: Record<string, unknown>, index: number) {
    const rowKey = props.getRowKey(row, index);
    const dirty = () => props.dirtyRowKeys?.includes(rowKey) ?? false;
    const pending = () => props.pendingRowKeys?.includes(rowKey) ?? false;

    return (
      <>
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
              onContextMenu={(event) => {
                if (!props.onCellContextMenu) return;
                event.preventDefault();
                event.stopPropagation();
                props.onCellContextMenu(row, index, column, event);
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
                    props.onCellInput?.(rowKey, column, event.currentTarget.value)
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
      </>
    );
  }

  return (
    <div ref={scrollRef} class="h-full w-full overflow-auto">
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
                  onContextMenu={(event) => {
                    if (!props.onHeaderContextMenu) return;
                    event.preventDefault();
                    event.stopPropagation();
                    props.onHeaderContextMenu(column, event);
                  }}
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
          <Show
            when={shouldVirtualize()}
            fallback={
              <For each={props.rows}>
                {(row, index) => (
                  <tr class="hover:bg-[var(--app-hover)]">
                    {renderRow(row, index())}
                  </tr>
                )}
              </For>
            }
          >
            {/* Top spacer absorbs the rows scrolled above the window. */}
            <Show when={virtualizer.getVirtualItems()[0]}>
              {(first) => (
                <tr aria-hidden="true">
                  <td
                    colSpan={props.columns.length + (props.editable ? 1 : 0)}
                    style={{ height: `${first().start}px`, padding: "0" }}
                  />
                </tr>
              )}
            </Show>
            <For each={virtualizer.getVirtualItems()}>
              {(virtualRow) => {
                const row = props.rows[virtualRow.index];
                return (
                  <tr
                    class="hover:bg-[var(--app-hover)]"
                    ref={(el) => virtualizer.measureElement(el)}
                    data-index={virtualRow.index}
                  >
                    {renderRow(row, virtualRow.index)}
                  </tr>
                );
              }}
            </For>
            {/* Bottom spacer absorbs the rows below the window. */}
            <Show when={virtualizer.getVirtualItems().length > 0}>
              <tr aria-hidden="true">
                <td
                  colSpan={props.columns.length + (props.editable ? 1 : 0)}
                  style={{
                    height: `${
                      virtualizer.getTotalSize() -
                      (virtualizer.getVirtualItems().at(-1)?.end ?? 0)
                    }px`,
                    padding: "0",
                  }}
                />
              </tr>
            </Show>
          </Show>
        </tbody>
      </table>
    </div>
  );
}
