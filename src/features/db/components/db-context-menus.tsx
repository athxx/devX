import { Show, type JSX } from 'solid-js'

type MenuState = { x: number; y: number }

type DbContextMenuProps = {
  open: boolean;
  menu: MenuState | null;
  zIndex?: number;
  children: JSX.Element;
}

export function DbContextMenu(props: DbContextMenuProps) {
  return (
    <Show when={props.open && props.menu}>
      <div
        class="theme-panel-soft fixed inline-grid auto-cols-max overflow-hidden rounded-[18px] border p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
        data-db-menu-root
        style={{
          'border-color': 'var(--app-border)',
          left: `${props.menu!.x}px`,
          top: `${props.menu!.y}px`,
          'z-index': String(props.zIndex ?? 300),
        }}
      >
        {props.children}
      </div>
    </Show>
  )
}
