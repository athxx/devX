import { For, Show, type JSX } from 'solid-js'
import { RefreshIcon } from '../../../components/ui-primitives'

type DbExplorerPaneProps<TSchema, TCategory, TLeaf> = {
  heading: string;
  subtitle: string;
  objectFilter: string;
  showSchemaSelect: boolean;
  totalSchemaObjectCount: number;
  selectedSchemaId: string;
  schemaNodes: TSchema[];
  categories: TCategory[];
  hasConnection: boolean;
  hasRoot: boolean;
  isRootLoading: boolean;
  explorerStatus?: 'idle' | 'loading' | 'ready' | 'error';
  explorerError?: string;
  renderSchemaOption: (schema: TSchema) => JSX.Element;
  renderCategory: (category: TCategory) => JSX.Element;
  onObjectFilterInput: (value: string) => void;
  onSchemaChange: (value: string) => void;
  onRefreshConnection: () => void;
  onRetryExplorer: () => void;
}

export function DbExplorerPane<TSchema, TCategory, TLeaf>(props: DbExplorerPaneProps<TSchema, TCategory, TLeaf>) {
  return (
    <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden pt-2">
      <div class="mb-2 flex items-center justify-between gap-2">
        <div class="min-w-0">
          <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.24em]">{props.heading}</p>
          <p class="theme-text-soft mt-1 truncate text-[11px]">{props.subtitle}</p>
        </div>
        <Show when={props.hasConnection}>
          <button
            class="inline-flex h-6 w-6 items-center justify-center rounded-md p-0 transition hover:opacity-80"
            title="Refresh"
            aria-label="Refresh"
            onClick={props.onRefreshConnection}
          >
            <RefreshIcon />
          </button>
        </Show>
      </div>

      <div class="mb-2">
        <input
          class="theme-input h-8 w-full rounded-md px-2.5 text-sm"
          placeholder="Search in tables, views, functions"
          value={props.objectFilter}
          onInput={(event) => props.onObjectFilterInput(event.currentTarget.value)}
        />
      </div>

      <Show when={props.showSchemaSelect}>
        <div class="mb-3 flex items-center gap-2">
          <span class="theme-text-soft shrink-0 text-[11px] font-medium uppercase tracking-[0.16em]">Schema</span>
          <select class="theme-input h-8 min-w-0 flex-1 rounded-md px-2.5 text-sm" value={props.selectedSchemaId} onInput={(event) => props.onSchemaChange(event.currentTarget.value)}>
            <option value="__all__">{`All schemas (${props.totalSchemaObjectCount})`}</option>
            <For each={props.schemaNodes}>{props.renderSchemaOption}</For>
          </select>
        </div>
      </Show>

      <div class="min-h-0 flex-1 overflow-auto">
        <Show when={props.hasConnection} fallback={<div class="theme-text-soft px-2 py-3 text-xs">No active connection.</div>}>
          <Show when={props.explorerStatus === 'error'}>
            <button class="theme-control mb-2 rounded-lg px-3 py-2 text-left text-[11px]" onClick={props.onRetryExplorer}>
              {props.explorerError || 'Failed to load database objects.'}
            </button>
          </Show>
          <Show when={props.hasRoot || props.explorerStatus === 'error'}>
            <Show when={props.isRootLoading}>
              <div class="theme-text-soft px-2 py-2 text-[11px]">Loading objects...</div>
            </Show>
            <Show when={!props.isRootLoading && props.categories.length === 0}>
              <div class="theme-text-soft px-2 py-3 text-xs">No objects found.</div>
            </Show>
            <div class="grid gap-1">
              <For each={props.categories}>{props.renderCategory}</For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
