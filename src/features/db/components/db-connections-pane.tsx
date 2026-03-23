import { For, Show, type JSX } from 'solid-js'
import { ControlDot } from '../../../components/ui-primitives'

type DbConnectionsPaneProps<T> = {
  sidebarConnectionsHeight: number;
  filter: string;
  connectedCount: number;
  filteredItems: T[];
  onFilterInput: (value: string) => void;
  onOpenSavedConnections: () => void;
  onResizeStart: (event: PointerEvent) => void;
  renderItem: (item: T) => JSX.Element;
}

export function DbConnectionsPane<T>(props: DbConnectionsPaneProps<T>) {
  return (
    <>
      <div
        class="flex min-h-[220px] flex-col overflow-hidden"
        style={{ flex: `0 0 ${props.sidebarConnectionsHeight}%` }}
      >
        <div class="mb-3 border-b pb-3" style={{ 'border-color': 'var(--app-border)' }}>
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.24em]">
              Connections
            </p>
            <button
              class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
              title="Saved connections"
              onClick={props.onOpenSavedConnections}
            >
              <ControlDot size="small" variant="warn" />
            </button>
          </div>

          <input
            class="theme-input h-8 w-full rounded-md px-2.5 text-sm"
            placeholder="Search connection or database"
            value={props.filter}
            onInput={(event) => props.onFilterInput(event.currentTarget.value)}
          />
        </div>

        <div class="min-h-0 flex-1 overflow-auto">
          <div class="grid gap-1">
            <For each={props.filteredItems}>{props.renderItem}</For>

            <Show when={props.filteredItems.length === 0}>
              <div class="theme-text-soft rounded-xl px-2 py-2 text-xs">
                {props.connectedCount === 0
                  ? 'No connected databases. Click the yellow dot to connect.'
                  : 'No matches'}
              </div>
            </Show>
          </div>
        </div>
      </div>

      <button
        class="group relative h-4 shrink-0 cursor-row-resize select-none bg-transparent p-0"
        title="Resize sidebar sections"
        onPointerDown={(event) => props.onResizeStart(event)}
      >
        <span
          class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--app-border)] transition-colors group-hover:bg-[var(--app-accent)]"
          aria-hidden="true"
        />
        <span
          class="absolute left-1/2 top-1/2 h-1.5 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--app-border)] transition-colors group-hover:bg-[var(--app-accent)]"
          aria-hidden="true"
        />
      </button>
    </>
  )
}
