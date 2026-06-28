import { createMemo, createSignal, For, Show } from "solid-js";
import { useDbPanel } from "../db-panel-context";
import type { ErEdge, ErModel, ErTable } from "../../service";

// ── ER diagram (Phase 4) ─────────────────────────────────────────────────────
// A self-contained SVG entity-relationship view. Zero new dependencies: the
// layout is a simple longest-path layering (tables with no incoming FK in
// column 0, each referenced table pushed one column to the right), table boxes
// are <rect>+<text>, and FK relationships are orthogonal polylines from the
// referencing column row to the referenced table. Pan via background drag,
// zoom via wheel, "Fit" recenters. The model is assembled connection-side by
// loadErModel() and cached in panel context keyed by tab id.

const ROW_HEIGHT = 22;
const HEADER_HEIGHT = 28;
const BOX_WIDTH = 220;
const COL_GAP = 120;
const ROW_GAP = 36;
const PADDING = 40;
const MAX_ROWS = 18; // cap very wide tables so a box stays readable

type Positioned = {
  table: ErTable;
  x: number;
  y: number;
  width: number;
  height: number;
  rowIndexByColumn: Map<string, number>;
};

/**
 * Assign each table a column (depth) via longest-path layering over the FK
 * graph. Referencing table sits left of the table it references. Cycles are
 * tolerated — a visited set bounds the recursion so a self/mutual reference
 * just keeps the smaller depth.
 */
function layerTables(tables: ErTable[], edges: ErEdge[]): Map<string, number> {
  const byName = new Map(tables.map((t) => [t.name, t]));
  // referencer -> set of referenced tables (children sit to the right)
  const refersTo = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.fromTable === edge.toTable) continue;
    if (!byName.has(edge.fromTable) || !byName.has(edge.toTable)) continue;
    if (!refersTo.has(edge.fromTable)) refersTo.set(edge.fromTable, new Set());
    refersTo.get(edge.fromTable)!.add(edge.toTable);
  }

  const depth = new Map<string, number>();
  function visit(name: string, seen: Set<string>): number {
    if (depth.has(name)) return depth.get(name)!;
    if (seen.has(name)) return 0;
    seen.add(name);
    let max = 0;
    for (const target of refersTo.get(name) ?? []) {
      max = Math.max(max, visit(target, seen) + 1);
    }
    seen.delete(name);
    depth.set(name, max);
    return max;
  }
  for (const table of tables) visit(table.name, new Set());
  return depth;
}

function boxHeight(table: ErTable): number {
  const rows = Math.min(table.columns.length, MAX_ROWS);
  return HEADER_HEIGHT + rows * ROW_HEIGHT;
}

function layout(model: ErModel): { boxes: Positioned[]; width: number; height: number } {
  const depth = layerTables(model.tables, model.edges);
  // Group tables by column (depth), stacking them vertically within a column.
  const columns = new Map<number, ErTable[]>();
  for (const table of model.tables) {
    const d = depth.get(table.name) ?? 0;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(table);
  }

  const boxes: Positioned[] = [];
  let maxBottom = 0;
  let maxRight = 0;
  const sortedDepths = [...columns.keys()].sort((a, b) => a - b);
  for (const d of sortedDepths) {
    const colTables = columns.get(d)!.slice().sort((a, b) => a.name.localeCompare(b.name));
    const x = PADDING + d * (BOX_WIDTH + COL_GAP);
    let y = PADDING;
    for (const table of colTables) {
      const height = boxHeight(table);
      const rowIndexByColumn = new Map<string, number>();
      table.columns.slice(0, MAX_ROWS).forEach((col, i) => {
        rowIndexByColumn.set(col.name, i);
      });
      boxes.push({ table, x, y, width: BOX_WIDTH, height, rowIndexByColumn });
      y += height + ROW_GAP;
      maxBottom = Math.max(maxBottom, y);
    }
    maxRight = Math.max(maxRight, x + BOX_WIDTH);
  }

  return {
    boxes,
    width: maxRight + PADDING,
    height: maxBottom + PADDING,
  };
}

/** Anchor point on the right edge of a referencing column's row. */
function fromAnchor(box: Positioned, columnName: string): { x: number; y: number } {
  const rowIndex = box.rowIndexByColumn.get(columnName) ?? 0;
  return {
    x: box.x + box.width,
    y: box.y + HEADER_HEIGHT + rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2,
  };
}

/** Anchor point on the left edge of the referenced table's header. */
function toAnchor(box: Positioned): { x: number; y: number } {
  return { x: box.x, y: box.y + HEADER_HEIGHT / 2 };
}

/** Orthogonal 3-segment polyline between two anchors (left-to-right routing). */
function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const midX = (from.x + to.x) / 2;
  return `M ${from.x} ${from.y} H ${midX} V ${to.y} H ${to.x}`;
}

export function DbErView() {
  const { activeTab, erModelByTabId, loadErModelForTab } = useDbPanel();

  const tab = activeTab();
  const state = createMemo(() => (tab ? erModelByTabId()[tab.id] : undefined));

  const [zoom, setZoom] = createSignal(1);
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  let dragging = false;
  let dragStart = { x: 0, y: 0 };
  let panStart = { x: 0, y: 0 };

  const placed = createMemo(() => {
    const model = state()?.model;
    if (!model) return null;
    return layout(model);
  });

  const boxByName = createMemo(() => {
    const p = placed();
    if (!p) return new Map<string, Positioned>();
    return new Map(p.boxes.map((b) => [b.table.name, b]));
  });

  function fit() {
    const p = placed();
    if (!p) return;
    const container = containerRef;
    if (!container) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const rect = container.getBoundingClientRect();
    const scale = Math.min(
      rect.width / p.width,
      rect.height / p.height,
      1,
    );
    setZoom(scale > 0 ? scale : 1);
    setPan({ x: 0, y: 0 });
  }

  let containerRef: HTMLDivElement | undefined;

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    setZoom((z) => Math.min(3, Math.max(0.2, z * delta)));
  }

  function onPointerDown(event: PointerEvent) {
    dragging = true;
    dragStart = { x: event.clientX, y: event.clientY };
    panStart = pan();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    setPan({
      x: panStart.x + (event.clientX - dragStart.x),
      y: panStart.y + (event.clientY - dragStart.y),
    });
  }

  function onPointerUp(event: PointerEvent) {
    dragging = false;
    try {
      (event.currentTarget as Element).releasePointerCapture(event.pointerId);
    } catch {
      /* capture may already be released */
    }
  }

  return (
    <div class="flex h-full min-h-0 w-full flex-col">
      <div
        class="flex items-center gap-2 border-b px-3 py-2"
        style={{ "border-color": "var(--app-border)" }}
      >
        <span class="theme-text text-sm font-semibold">ER Diagram</span>
        <Show when={state()?.status === "ready" && placed()}>
          <span class="theme-text-soft text-xs">
            {placed()!.boxes.length} tables · {state()!.model!.edges.length} relations
          </span>
        </Show>
        <div class="ml-auto flex items-center gap-2">
          <button
            class="theme-control h-7 rounded-md px-2 text-xs font-medium"
            onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
          >
            +
          </button>
          <button
            class="theme-control h-7 rounded-md px-2 text-xs font-medium"
            onClick={() => setZoom((z) => Math.max(0.2, z / 1.2))}
          >
            −
          </button>
          <button
            class="theme-control h-7 rounded-md px-3 text-xs font-medium"
            onClick={fit}
          >
            Fit
          </button>
          <button
            class="theme-control h-7 rounded-md px-3 text-xs font-medium"
            onClick={() => tab && void loadErModelForTab(tab.id, { force: true })}
          >
            Reload
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        class="relative min-h-0 flex-1 overflow-hidden"
        style={{ "background-color": "var(--app-code)", cursor: "grab" }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <Show
          when={state()?.status === "ready" && placed()}
          fallback={
            <div class="flex h-full items-center justify-center">
              <Show
                when={state()?.status === "error"}
                fallback={
                  <span class="theme-text-soft text-sm">
                    {state()?.status === "loading"
                      ? "Loading schema…"
                      : "No model loaded."}
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
          <svg
            width="100%"
            height="100%"
            style={{ display: "block" }}
          >
            <defs>
              <marker
                id="er-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--app-accent)" />
              </marker>
            </defs>
            <g
              transform={`translate(${pan().x} ${pan().y}) scale(${zoom()})`}
            >
              {/* edges first so boxes paint over them */}
              <For each={state()!.model!.edges}>
                {(edge) => {
                  const fromBox = boxByName().get(edge.fromTable);
                  const toBox = boxByName().get(edge.toTable);
                  if (!fromBox || !toBox) return null;
                  const from = fromAnchor(fromBox, edge.fromColumns[0] ?? "");
                  const to = toAnchor(toBox);
                  return (
                    <path
                      d={edgePath(from, to)}
                      fill="none"
                      stroke="var(--app-accent)"
                      stroke-width="1.5"
                      stroke-opacity="0.7"
                      marker-end="url(#er-arrow)"
                    />
                  );
                }}
              </For>

              <For each={placed()!.boxes}>
                {(box) => (
                  <g transform={`translate(${box.x} ${box.y})`}>
                    <rect
                      width={box.width}
                      height={box.height}
                      rx="6"
                      fill="var(--theme-input, #1e1e1e)"
                      stroke="var(--app-border)"
                      stroke-width="1"
                    />
                    <rect
                      width={box.width}
                      height={HEADER_HEIGHT}
                      rx="6"
                      fill="var(--app-accent-soft)"
                    />
                    <text
                      x="10"
                      y={HEADER_HEIGHT / 2 + 4}
                      font-size="12"
                      font-weight="600"
                      fill="var(--app-accent)"
                    >
                      {box.table.name}
                    </text>
                    <For each={box.table.columns.slice(0, MAX_ROWS)}>
                      {(column, i) => (
                        <g
                          transform={`translate(0 ${HEADER_HEIGHT + i() * ROW_HEIGHT})`}
                        >
                          <text
                            x="10"
                            y={ROW_HEIGHT / 2 + 4}
                            font-size="11"
                            fill="var(--app-text)"
                            font-weight={column.pk ? "600" : "400"}
                          >
                            {column.pk ? "🔑 " : column.fk ? "↗ " : ""}
                            {column.name}
                          </text>
                          <text
                            x={box.width - 10}
                            y={ROW_HEIGHT / 2 + 4}
                            font-size="10"
                            text-anchor="end"
                            fill="var(--app-text-soft, #888)"
                          >
                            {column.type}
                          </text>
                        </g>
                      )}
                    </For>
                    <Show when={box.table.columns.length > MAX_ROWS}>
                      <text
                        x="10"
                        y={box.height - 6}
                        font-size="10"
                        fill="var(--app-text-soft, #888)"
                      >
                        +{box.table.columns.length - MAX_ROWS} more…
                      </text>
                    </Show>
                  </g>
                )}
              </For>
            </g>
          </svg>
        </Show>
      </div>
    </div>
  );
}
