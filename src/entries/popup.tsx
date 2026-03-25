import { For } from "solid-js";
import { render } from "solid-js/web";
import "./setup";
import { tools } from "../app/tool-registry";
import { AppShell } from "../components/app-shell";
import { openAppPage, openOptionsPage } from "../lib/runtime";

function PopupApp() {
  const quickTools = tools
    .filter((tool) => tool.status === "ready")
    .slice(0, 4);

  const handleOpenApp = async () => {
    await openAppPage();
    window.close();
  };

  const handleOpenOptions = async () => {
    await openOptionsPage();
    window.close();
  };

  return (
    <section class="rounded-3xl border border-white/10 bg-ink-900/72 p-4 shadow-panel">
      <div class="grid gap-3">
        <button
          class="rounded-2xl bg-accent-500 px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-accent-400"
          onClick={() => void handleOpenApp()}
        >
          Open App
        </button>
        <button
          class="rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10"
          onClick={() => void handleOpenOptions()}
        >
          Settings
        </button>
      </div>
    </section>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Popup root element not found");
}

render(() => <PopupApp />, root);
