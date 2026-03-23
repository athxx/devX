import { For, Show, type JSX } from 'solid-js'
import { ControlDot } from '../../../components/ui-primitives'

type DbSavedConnectionsModalProps<T> = {
  open: boolean;
  filter: string;
  error: string | null;
  items: T[];
  onClose: () => void;
  onFilterInput: (value: string) => void;
  onCreate: () => void;
  renderItem: (item: T) => JSX.Element;
}

export function DbSavedConnectionsModal<T>(props: DbSavedConnectionsModalProps<T>) {
  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-[320] flex items-center justify-center bg-[rgba(15,23,42,0.3)] px-4 py-6"
        data-db-menu-root
        onClick={props.onClose}
      >
        <div
          class="theme-panel-soft w-full max-w-3xl rounded-[22px] border p-5 shadow-[0_24px_60px_rgba(15,23,42,0.24)]"
          style={{ 'border-color': 'var(--app-border)' }}
          onClick={(event) => event.stopPropagation()}
        >
          <div class="flex items-start justify-between gap-4 border-b pb-4" style={{ 'border-color': 'var(--app-border)' }}>
            <div>
              <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">Saved Connections</p>
            </div>
            <button class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0" onClick={props.onClose}>
              <ControlDot size="small" variant="delete" />
            </button>
          </div>

          <div class="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
            <input
              class="theme-input h-9 flex-1 rounded-xl px-3 text-sm"
              placeholder="Search saved databases"
              value={props.filter}
              onInput={(event) => props.onFilterInput(event.currentTarget.value)}
            />
            <button class="theme-button-primary h-9 rounded-xl px-4 text-sm font-semibold" onClick={props.onCreate}>
              New
            </button>
          </div>

          <Show when={props.error}>
            <div class="mt-4 rounded-xl border px-3 py-2 text-sm text-[#ff8b8b]" style={{ 'border-color': 'rgba(255, 95, 87, 0.35)' }}>
              {props.error}
            </div>
          </Show>

          <div class="mt-4 max-h-[55vh] overflow-auto">
            <div class="grid gap-2">
              <For each={props.items}>{props.renderItem}</For>
              <Show when={props.items.length === 0}>
                <div class="theme-control rounded-[18px] px-4 py-5 text-center">
                  <p class="theme-text text-sm font-semibold">No saved connections</p>
                  <p class="theme-text-soft mt-1 text-sm">Create one first, then connect it from here.</p>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  )
}
