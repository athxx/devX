// Declarative context-menu shell — SolidJS re-implementation of dbx's
// CustomContextMenu.vue. The single renderer for every right-click menu in the
// DB panel (tree / grid / tab bar / editor). Driven by a ContextMenuItem[]
// model rather than hand-rolled <button> children so each call site only
// describes WHAT the menu contains; positioning, submenus, keyboard/outside
// dismissal, viewport clamping and destructive styling live here once.
//
// Theme: reuses theme-menu-popover / theme-sidebar-item so colors track the
// app theme; only layout/interaction mirror dbx, per the approved plan.
import {
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { Icon, type DbIconName } from "./db-icons";

/**
 * One context-menu entry. Mirrors dbx's CustomContextMenu item contract:
 * a row with optional icon/shortcut, an action OR a nested submenu, an enabled
 * flag, a destructive (red) variant, a visibility flag, and a separator form.
 */
export type ContextMenuItem = {
  /** Visible label. Ignored when `separator` is set. */
  label?: string;
  /** Click handler for a leaf item. Mutually exclusive with `children`. */
  action?: () => void | Promise<void>;
  /** When true, render a horizontal divider instead of a row. */
  separator?: boolean;
  /** Greyed-out, non-interactive. */
  disabled?: boolean;
  /** Leading Lucide icon name (see db-icons). */
  icon?: DbIconName;
  /** Extra class for the icon (e.g. a color tint). */
  iconClass?: string;
  /** Right-aligned shortcut hint, e.g. "⌘↵". Display only. */
  shortcut?: string;
  /** "destructive" renders the row red. */
  variant?: "default" | "destructive";
  /** When false, the item is omitted entirely. Defaults to true. */
  visible?: boolean;
  /** Nested submenu. Mutually exclusive with `action`. */
  children?: ContextMenuItem[];
};

export type ContextMenuPosition = { x: number; y: number };

type ContextMenuProps = {
  /** Anchor position (viewport coords) of the right-click. Null = closed. */
  position: ContextMenuPosition | null;
  items: ContextMenuItem[];
  /** Called when the menu should close (action chosen / Escape / outside). */
  onClose: () => void;
  /** Base z-index; submenus stack above. */
  zIndex?: number;
};

const SUBMENU_CLOSE_DELAY = 150;
const VIEWPORT_MARGIN = 8;
const ROW_HEIGHT = 30; // approx; used only for pre-clamp height estimate

function visibleItems(items: ContextMenuItem[]): ContextMenuItem[] {
  return items.filter((item) => item.visible !== false);
}

/**
 * A single menu surface (root or submenu). Measures itself on mount and clamps
 * within the viewport (8px margin), flipping left/up when it would overflow.
 */
function MenuPanel(props: {
  items: ContextMenuItem[];
  x: number;
  y: number;
  zIndex: number;
  /** Open to the left of x instead of the right (for flipped submenus). */
  flipX?: boolean;
  onClose: () => void;
}) {
  let panelRef: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal({ x: props.x, y: props.y });
  // Track which item index currently has its submenu open.
  const [openSubmenu, setOpenSubmenu] = createSignal<number | null>(null);
  const [submenuAnchor, setSubmenuAnchor] = createSignal<{
    x: number;
    y: number;
    flipX: boolean;
  } | null>(null);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const items = () => visibleItems(props.items);

  const clamp = () => {
    const el = panelRef;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = props.x;
    let y = props.y;
    if (props.flipX) x = props.x - rect.width;
    if (x + rect.width > vw - VIEWPORT_MARGIN) {
      x = Math.max(VIEWPORT_MARGIN, vw - VIEWPORT_MARGIN - rect.width);
    }
    if (x < VIEWPORT_MARGIN) x = VIEWPORT_MARGIN;
    if (y + rect.height > vh - VIEWPORT_MARGIN) {
      y = Math.max(VIEWPORT_MARGIN, vh - VIEWPORT_MARGIN - rect.height);
    }
    if (y < VIEWPORT_MARGIN) y = VIEWPORT_MARGIN;
    setPos({ x, y });
  };

  onMount(clamp);

  const cancelClose = () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  const scheduleSubmenuClose = () => {
    cancelClose();
    closeTimer = setTimeout(() => {
      setOpenSubmenu(null);
      setSubmenuAnchor(null);
    }, SUBMENU_CLOSE_DELAY);
  };

  const openSubmenuAt = (index: number, rowEl: HTMLElement) => {
    cancelClose();
    const rect = rowEl.getBoundingClientRect();
    const vw = window.innerWidth;
    // Default: open to the right of this panel; flip left if no room.
    const wantRight = rect.right + 200 < vw - VIEWPORT_MARGIN;
    setSubmenuAnchor({
      x: wantRight ? rect.right : rect.left,
      y: rect.top,
      flipX: !wantRight,
    });
    setOpenSubmenu(index);
  };

  onCleanup(cancelClose);

  const runAction = (item: ContextMenuItem) => {
    if (item.disabled || item.children) return;
    void item.action?.();
    props.onClose();
  };

  return (
    <div
      ref={panelRef}
      class="theme-panel-soft theme-menu-popover fixed min-w-[180px] overflow-visible border p-1.5"
      data-db-menu-root
      style={{
        "border-color": "var(--app-border)",
        left: `${pos().x}px`,
        top: `${pos().y}px`,
        "z-index": String(props.zIndex),
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <For each={items()}>
        {(item, index) => (
          <Show
            when={!item.separator}
            fallback={
              <div
                class="my-1 h-px"
                style={{ background: "var(--app-border)" }}
              />
            }
          >
            <button
              type="button"
              disabled={item.disabled}
              class="theme-sidebar-item group flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-2.5 py-1.5 text-left text-[13px]"
              classList={{
                "opacity-40 pointer-events-none": !!item.disabled,
                "text-[var(--app-danger,#ef4444)]":
                  item.variant === "destructive",
              }}
              onClick={() => runAction(item)}
              onMouseEnter={(e) => {
                if (item.children && !item.disabled) {
                  openSubmenuAt(index(), e.currentTarget);
                } else {
                  cancelClose();
                  setOpenSubmenu(null);
                  setSubmenuAnchor(null);
                }
              }}
              onMouseLeave={() => {
                if (item.children) scheduleSubmenuClose();
              }}
            >
              <Show
                when={item.icon}
                fallback={<span class="h-4 w-4 shrink-0" />}
              >
                <Icon
                  name={item.icon!}
                  class={`h-4 w-4 shrink-0 ${item.iconClass ?? ""}`}
                />
              </Show>
              <span class="flex-1">{item.label}</span>
              <Show when={item.shortcut}>
                <span class="theme-text-muted ml-4 text-[11px] tabular-nums">
                  {item.shortcut}
                </span>
              </Show>
              <Show when={item.children}>
                <Icon
                  name="ChevronRight"
                  class="theme-text-muted ml-1 h-3.5 w-3.5 shrink-0"
                />
              </Show>
            </button>
          </Show>
        )}
      </For>

      <Show when={openSubmenu() !== null && submenuAnchor()}>
        {(() => {
          const idx = openSubmenu()!;
          const anchor = submenuAnchor()!;
          const child = items()[idx];
          if (!child?.children) return null;
          return (
            <div
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleSubmenuClose}
            >
              <MenuPanel
                items={child.children}
                x={anchor.x}
                y={anchor.y}
                flipX={anchor.flipX}
                zIndex={props.zIndex + 1}
                onClose={props.onClose}
              />
            </div>
          );
        })()}
      </Show>
    </div>
  );
}

/**
 * Public context-menu component. Render once near the panel root; pass the
 * right-click `position` (null to close), the `items` model, and an `onClose`.
 * Handles Escape, outside-click, and right-click-elsewhere dismissal.
 */
export function ContextMenu(props: ContextMenuProps) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose();
  };
  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-db-menu-root]")) return;
    props.onClose();
  };

  onMount(() => {
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
  });
  onCleanup(() => {
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
  });

  return (
    <Show when={props.position}>
      {(pos) => (
        <Portal>
          <MenuPanel
            items={props.items}
            x={pos().x}
            y={pos().y}
            zIndex={props.zIndex ?? 600}
            onClose={props.onClose}
          />
        </Portal>
      )}
    </Show>
  );
}

export type { JSX };
