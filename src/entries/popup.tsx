import { For } from "solid-js";
import { render } from "solid-js/web";
import "./setup";
import { tools } from "../app/tool-registry";
import { AppShell } from "../components/app-shell";
import { openAppPage, openOptionsPage } from "../lib/runtime";

function PopupApp() {
  const quickTools = tools.filter((tool) => tool.status === "ready").slice(0, 4);

  const handleOpenApp = async () => {
    await openAppPage();
    window.close();
  };

  const handleOpenOptions = async () => {
    await openOptionsPage();
    window.close();
  };

  return (
    <AppShell
      compact
      title="DevX"
      subtitle="开发者工具箱现在以完整页面为主工作区，点击后会打开独立标签页。"
    >
      <section class="rounded-3xl border border-white/10 bg-ink-900/72 p-4 shadow-panel">
        <div class="grid gap-3">
          <button
            class="rounded-2xl bg-accent-500 px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-accent-400"
            onClick={() => void handleOpenApp()}
          >
            Open Full App
          </button>
          <button
            class="rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10"
            onClick={() => void handleOpenOptions()}
          >
            Open Settings
          </button>
        </div>
      </section>

      <section class="rounded-3xl border border-white/10 bg-ink-900/72 p-4 shadow-panel">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold uppercase tracking-[0.18em] text-white/70">
            Quick Modules
          </h2>
          <span class="text-xs text-white/45">{quickTools.length} ready</span>
        </div>
        <div class="grid gap-3">
          <For each={quickTools}>
            {(tool) => (
              <div class="rounded-2xl border border-white/8 bg-white/4 px-3 py-3">
                <p class="text-sm font-medium text-white">{tool.name}</p>
                <p class="mt-1 text-xs leading-5 text-white/65">{tool.summary}</p>
              </div>
            )}
          </For>
        </div>
      </section>
    </AppShell>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Popup root element not found");
}

render(() => <PopupApp />, root);
