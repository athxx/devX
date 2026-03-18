import type { JSX } from "solid-js";
import { For, Show } from "solid-js";

export type RequestTabBarItem = {
  id: string;
  name: string;
  badgeLabel: string;
  badgeClass: string;
  active: boolean;
  pinned: boolean;
};

type RequestTabsBarProps = {
  items: RequestTabBarItem[];
  draggedId: string | null;
  dropTargetId: string | null;
  renderCloseIcon: () => JSX.Element;
  renderPinIcon: () => JSX.Element;
  onTabOpen: (id: string) => void;
  onTabClose: (id: string) => void;
  onTabContextMenu: (id: string, event: MouseEvent) => void;
  onDragStart: (id: string, event: DragEvent) => void;
  onDragEnd: () => void;
  onTabDragOver: (id: string, event: DragEvent) => void;
  onTabDrop: (id: string, event: DragEvent) => void;
  onStripDragOver: (event: DragEvent) => void;
  onStripDrop: (event: DragEvent) => void;
};

export function RequestTabsBar(props: RequestTabsBarProps) {
  return (
    <div class="overflow-visible">
      <div
        class="theme-request-tab-strip relative z-10 grid min-w-0 w-full auto-cols-fr grid-flow-col items-stretch overflow-hidden border"
        style={{ "border-color": "var(--app-border)" }}
        onDragOver={props.onStripDragOver}
        onDrop={props.onStripDrop}
      >
        <For each={props.items}>
          {(item, index) => (
            <div
              class={`group relative min-w-0 transition ${
                item.active ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)] opacity-80" : ""
              } ${
                props.dropTargetId === item.id && props.draggedId !== item.id
                  ? "ring-1 ring-[var(--app-accent)]"
                  : ""
              } ${
                props.draggedId === item.id ? "opacity-60" : ""
              }`}
              style={{
                "border-left": index() === 0 ? "0" : "1px solid var(--app-border)"
              }}
              draggable={!item.pinned}
              onDragStart={(event) => {
                if (item.pinned) {
                  event.preventDefault();
                  return;
                }
                props.onDragStart(item.id, event);
              }}
              onDragOver={(event) => props.onTabDragOver(item.id, event)}
              onDrop={(event) => props.onTabDrop(item.id, event)}
              onDragEnd={props.onDragEnd}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onTabContextMenu(item.id, event);
              }}
            >
              <button
                class="flex h-full w-full min-w-0 items-center justify-center gap-1.5 px-9 py-2 text-center"
                onClick={() => props.onTabOpen(item.id)}
              >
                <span class={`${item.badgeClass} shrink-0`}>{item.badgeLabel}</span>
                <span class="truncate text-center text-sm font-medium">{item.name}</span>
              </button>

              <Show when={item.pinned}>
                <span class="pointer-events-none absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center text-[var(--app-accent)]">
                  {props.renderPinIcon()}
                </span>
              </Show>

              <Show when={!item.pinned}>
                <button
                  class="absolute left-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onTabClose(item.id);
                  }}
                >
                  {props.renderCloseIcon()}
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
