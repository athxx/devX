import { createSignal, onMount } from "solid-js";
import { render } from "solid-js/web";
import "./setup";
import { AppShell } from "../components/app-shell";
import { SectionCard } from "../components/section-card";
import { defaultSettings, loadSettings, saveSettings, type AppSettings } from "../lib/storage";

function OptionsApp() {
  const [settings, setSettings] = createSignal<AppSettings>(defaultSettings);
  const [saved, setSaved] = createSignal(false);

  onMount(async () => {
    const current = await loadSettings();
    setSettings(current);
  });

  const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSaved(false);
    setSettings((current) => ({
      ...current,
      [key]: value
    }));
  };

  const handleSave = async () => {
    await saveSettings(settings());
    setSaved(true);
  };

  return (
    <AppShell
      title="Settings"
      subtitle="先把全局工作区配置放这里，后面环境变量、收藏夹、历史请求都可以继续往下挂。"
    >
      <SectionCard eyebrow="Workspace" title="General Preferences">
        <div class="grid gap-4 md:grid-cols-2">
          <label class="grid gap-2 text-sm text-white/72">
            <span class="font-medium text-white">Workspace name</span>
            <input
              class="rounded-2xl border border-white/10 bg-ink-950/80 px-4 py-3 outline-none ring-0 transition focus:border-accent-400/45"
              value={settings().workspaceName}
              onInput={(event) => updateField("workspaceName", event.currentTarget.value)}
            />
          </label>

          <label class="grid gap-2 text-sm text-white/72">
            <span class="font-medium text-white">Default API base URL</span>
            <input
              class="rounded-2xl border border-white/10 bg-ink-950/80 px-4 py-3 outline-none ring-0 transition focus:border-accent-400/45"
              placeholder="https://api.example.com"
              value={settings().apiBaseUrl}
              onInput={(event) => updateField("apiBaseUrl", event.currentTarget.value)}
            />
          </label>

          <label class="grid gap-2 text-sm text-white/72">
            <span class="font-medium text-white">Request timeout (ms)</span>
            <input
              class="rounded-2xl border border-white/10 bg-ink-950/80 px-4 py-3 outline-none ring-0 transition focus:border-accent-400/45"
              type="number"
              min="1000"
              step="500"
              value={String(settings().requestTimeoutMs)}
              onInput={(event) =>
                updateField("requestTimeoutMs", Number(event.currentTarget.value || defaultSettings.requestTimeoutMs))
              }
            />
          </label>

          <label class="grid gap-2 text-sm text-white/72">
            <span class="font-medium text-white">Default module</span>
            <select
              class="rounded-2xl border border-white/10 bg-ink-950/80 px-4 py-3 outline-none ring-0 transition focus:border-accent-400/45"
              value={settings().defaultToolId}
              onChange={(event) => updateField("defaultToolId", event.currentTarget.value)}
            >
              <option value="api-client">API Requests</option>
              <option value="ws-client">WebSocket</option>
              <option value="data-format">Format Convert</option>
              <option value="text-diff">Text Diff</option>
            </select>
          </label>
        </div>

        <label class="mt-4 flex items-center gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-white/72">
          <input
            type="checkbox"
            checked={settings().persistHistory}
            onChange={(event) => updateField("persistHistory", event.currentTarget.checked)}
          />
          <span>Persist request and tool history in extension storage.</span>
        </label>

        <div class="mt-5 flex items-center gap-3">
          <button
            class="rounded-2xl bg-accent-500 px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-accent-400"
            onClick={() => void handleSave()}
          >
            Save Settings
          </button>
          {saved() ? <span class="text-sm text-accent-400">Saved to chrome.storage.sync</span> : null}
        </div>
      </SectionCard>
    </AppShell>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Options root element not found");
}

render(() => <OptionsApp />, root);
