import { For, Show, type JSX } from 'solid-js'

type SidebarSection = 'connections' | 'favorites' | 'history'

type DbSidebarContentPaneProps<TFavorite, THistory> = {
  section: SidebarSection;
  compact?: boolean;
  favorites: TFavorite[];
  history: THistory[];
  renderFavorite: (item: TFavorite) => JSX.Element;
  renderHistory: (item: THistory) => JSX.Element;
  onSectionChange: (section: SidebarSection) => void;
  onClearHistory: () => void;
}

export function DbSidebarContentPane<TFavorite, THistory>(
  props: DbSidebarContentPaneProps<TFavorite, THistory>,
) {
  return (
    <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden pt-2">
      <div classList={{ 'min-h-0 flex-1 overflow-hidden': !props.compact }}>
      <div class="mb-2 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <button
            class={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${props.section === 'connections' ? 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]' : 'theme-text-soft hover:text-[var(--app-text)]'}`}
            onClick={() => props.onSectionChange('connections')}
          >
            Explorer
          </button>
          <button
            class={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${props.section === 'favorites' ? 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]' : 'theme-text-soft hover:text-[var(--app-text)]'}`}
            onClick={() => props.onSectionChange('favorites')}
          >
            Favorites
          </button>
          <button
            class={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${props.section === 'history' ? 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]' : 'theme-text-soft hover:text-[var(--app-text)]'}`}
            onClick={() => props.onSectionChange('history')}
          >
            History
          </button>
        </div>
        <Show when={props.section === 'history' && props.history.length > 0}>
          <button
            class="theme-control h-7 rounded-lg px-2.5 text-[11px] font-medium"
            onClick={props.onClearHistory}
          >
            Clear
          </button>
        </Show>
      </div>

      <Show when={!props.compact && props.section === 'favorites'}>
        <div class="min-h-0 flex-1 overflow-auto">
          <div class="grid gap-2">
            <For each={props.favorites}>{props.renderFavorite}</For>
            <Show when={props.favorites.length === 0}>
              <div class="theme-text-soft rounded-xl px-2 py-3 text-xs">
                No saved favorites.
              </div>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={!props.compact && props.section === 'history'}>
        <div class="min-h-0 flex-1 overflow-auto">
          <div class="grid gap-2">
            <For each={props.history}>{props.renderHistory}</For>
            <Show when={props.history.length === 0}>
              <div class="theme-text-soft rounded-xl px-2 py-3 text-xs">
                No query history yet.
              </div>
            </Show>
          </div>
        </div>
      </Show>
      </div>
    </div>
  )
}
