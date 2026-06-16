import type { JSX } from "solid-js";
import { For, Show, createSignal, onCleanup } from "solid-js";

export type TabBarItem = {
  id: string;
  name: string;
  badgeLabel: string;
  badgeClass: string;
  active: boolean;
  pinned: boolean;
};

type TabsBarProps = {
  items: TabBarItem[];
  draggedId: string | null;
  dropTargetId: string | null;
  closeButtonShortcut?: string;
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

export function TabsBar(props: TabsBarProps) {
  const [closeHintTabId, setCloseHintTabId] = createSignal<string | null>(null);
  let closeHintTimer: number | null = null;
  let hoverOpenTimer: number | null = null;

  const clearHoverOpenTimer = () => {
    if (hoverOpenTimer !== null) {
      window.clearTimeout(hoverOpenTimer);
      hoverOpenTimer = null;
    }
  };

  const scheduleHoverOpen = (id: string, active: boolean) => {
    clearHoverOpenTimer();
    if (active) {
      return;
    }
    hoverOpenTimer = window.setTimeout(() => {
      hoverOpenTimer = null;
      props.onTabOpen(id);
    }, 400);
  };

  return (
    <div class="overflow-visible">
      <div
        class="theme-request-tab-strip relative z-10 grid min-w-0 w-full auto-cols-fr grid-flow-col items-stretch overflow-visible border"
        style={{ "border-color": "var(--app-border)" }}
        onDragOver={props.onStripDragOver}
        onDrop={props.onStripDrop}
      >
        <For each={props.items}>
          {(item, index) => (
            <div
              class={`group relative min-w-0 transition ${
                item.active
                  ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)] opacity-80"
                  : ""
              } ${
                props.dropTargetId === item.id && props.draggedId !== item.id
                  ? "ring-1 ring-[var(--app-accent)]"
                  : ""
              } ${props.draggedId === item.id ? "opacity-60" : ""}`}
              style={{
                "border-left":
                  index() === 0 ? "0" : "1px solid var(--app-border)",
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
              onMouseEnter={() => {
                scheduleHoverOpen(item.id, item.active);
                if (props.closeButtonShortcut) {
                  closeHintTimer = window.setTimeout(() => {
                    closeHintTimer = null;
                    setCloseHintTabId(item.id);
                  }, 300);
                }
              }}
              onMouseLeave={() => {
                clearHoverOpenTimer();
                if (closeHintTimer !== null) {
                  window.clearTimeout(closeHintTimer);
                  closeHintTimer = null;
                }
                setCloseHintTabId(null);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onTabContextMenu(item.id, event);
              }}
            >
              <button
                class="flex h-full w-full min-w-0 items-center justify-center gap-1.5 px-8 py-1.5 text-center"
                onClick={() => {
                  clearHoverOpenTimer();
                  props.onTabOpen(item.id);
                }}
              >
                <span class={`${item.badgeClass} shrink-0`}>
                  {item.badgeLabel}
                </span>
                <span class="truncate text-center text-[13px] font-medium leading-5">
                  {item.name}
                </span>
              </button>

              <Show when={item.pinned}>
                <span class="pointer-events-none absolute right-1.5 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center text-[var(--app-accent)]">
                  {props.renderPinIcon()}
                </span>
              </Show>

              <Show when={!item.pinned}>
                <div class="absolute left-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    class="relative inline-flex h-4 w-4 items-center justify-center"
                    onClick={(event) => {
                      event.stopPropagation();
                      clearHoverOpenTimer();
                      props.onTabClose(item.id);
                    }}
                  >
                    {props.renderCloseIcon()}
                  </button>
                  <Show when={closeHintTabId() === item.id && !!props.closeButtonShortcut}>
                    <div
                      class="theme-text-soft pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium"
                      style={{ background: "var(--app-surface, #1e1e1e)", border: "1px solid var(--app-border)" }}
                    >
                      {props.closeButtonShortcut}
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

/** @deprecated Use `TabsBar` and `TabBarItem` instead */
export type RequestTabBarItem = TabBarItem;
/** @deprecated Use `TabsBar` instead */
export const RequestTabsBar = TabsBar;
