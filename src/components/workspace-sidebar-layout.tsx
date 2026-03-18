import type { JSX } from "solid-js";
import { Show } from "solid-js";

type WorkspaceSidebarLayoutProps = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarResizing?: boolean;
  onResizeStart: (event: MouseEvent) => void;
  sidebar: JSX.Element;
  children: JSX.Element;
  contentClass?: string;
  contentStyle?: JSX.CSSProperties;
  rootClass?: string;
};

export function WorkspaceSidebarLayout(props: WorkspaceSidebarLayoutProps) {
  const layoutStyle = () =>
    ({
      "--workspace-sidebar-width": `${props.sidebarWidth}px`
    }) as JSX.CSSProperties;

  return (
    <div
      class={`workspace-sidebar-layout ${props.rootClass ?? ""}`}
      data-sidebar-open={props.sidebarOpen ? "true" : "false"}
      data-sidebar-resizing={props.sidebarResizing ? "true" : "false"}
      style={layoutStyle()}
    >
      <Show when={props.sidebarOpen}>
        <aside class="workspace-sidebar theme-sidebar relative z-30 py-2">{props.sidebar}</aside>
        <div
          class="workspace-sidebar-resizer"
          aria-hidden="true"
          onMouseDown={(event) => props.onResizeStart(event)}
        />
      </Show>
      <div class={`relative z-0 ${props.contentClass ?? ""}`} style={props.contentStyle}>
        {props.children}
      </div>
    </div>
  );
}
