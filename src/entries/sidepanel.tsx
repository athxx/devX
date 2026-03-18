import { render } from "solid-js/web";
import "./setup";
import { AppShell } from "../components/app-shell";
import { RestPlayground } from "../features/rest/components/rest-playground";

function SidePanelApp() {
  return (
    <AppShell
      title="DevX Workspace"
      subtitle="先把 REST API 调试界面做出来。当前这版是静态骨架，接下来再逐步补请求执行、历史记录和环境变量。"
      actions={
        <div class="rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-right">
          <p class="text-xs uppercase tracking-[0.18em] text-white/45">Module</p>
          <p class="text-sm font-semibold text-white">REST Playground</p>
        </div>
      }
    >
      <RestPlayground
        sidebarOpen={true}
        sidebarWidth={220}
        sidebarResizing={false}
        onSidebarResizeStart={() => undefined}
      />
    </AppShell>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Side panel root element not found");
}

render(() => <SidePanelApp />, root);
