import { For } from "solid-js";
import { render } from "solid-js/web";
import { tools } from "../app/tool-registry";
import { AppShell } from "../components/app-shell";
import { SectionCard } from "../components/section-card";
import { ToolCard } from "../components/tool-card";
import "../styles/main.css";

function SidePanelApp() {
  const readyTools = tools.filter((tool) => tool.status === "ready");
  const plannedTools = tools.filter((tool) => tool.status === "planned");

  return (
    <AppShell
      title="DevOX Workspace"
      subtitle="这是一层偏产品化的底盘：Side Panel 作为主工作区，后面直接往里加 API 测试、格式转换、文本对比等 feature 就可以。"
      actions={
        <div class="rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-right">
          <p class="text-xs uppercase tracking-[0.18em] text-white/45">Mode</p>
          <p class="text-sm font-semibold text-white">Extension Only</p>
        </div>
      }
    >
      <div class="grid gap-5 xl:grid-cols-[1.45fr_0.95fr]">
        <SectionCard eyebrow="Workspace" title="Ready To Build">
          <div class="grid gap-4 md:grid-cols-2">
            <For each={readyTools}>{(tool) => <ToolCard tool={tool} />}</For>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Roadmap" title="Next Slots">
          <div class="grid gap-4">
            <For each={plannedTools}>{(tool) => <ToolCard tool={tool} />}</For>
          </div>
        </SectionCard>
      </div>

      <div class="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <SectionCard eyebrow="Architecture" title="Suggested Feature Layout">
          <div class="grid gap-3 text-sm leading-6 text-white/72">
            <div class="rounded-2xl border border-white/8 bg-white/4 p-4">
              <p class="font-medium text-white">Network</p>
              <p>Request builder, environment variables, response viewer, and saved collections.</p>
            </div>
            <div class="rounded-2xl border border-white/8 bg-white/4 p-4">
              <p class="font-medium text-white">Transform</p>
              <p>Diff, formatting, encoding, and schema-aware converters in shared editor panels.</p>
            </div>
            <div class="rounded-2xl border border-white/8 bg-white/4 p-4">
              <p class="font-medium text-white">Data</p>
              <p>Result tabs, query scratchpads, mock payload fixtures, and export helpers.</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Notes" title="Current Boundaries">
          <div class="space-y-3 text-sm leading-6 text-white/72">
            <p>
              `host_permissions: &lt;all_urls&gt;` is already wired so API tooling can evolve without
              revisiting the manifest.
            </p>
            <p>
              The background service worker only does startup defaults for now, which keeps the runtime
              small and leaves room for message routing later.
            </p>
            <p>
              SSH stays out of scope in this shell because pure extensions cannot open raw TCP sessions.
            </p>
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Side panel root element not found");
}

render(() => <SidePanelApp />, root);

