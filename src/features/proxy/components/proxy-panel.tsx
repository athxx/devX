import { For, Show, createSignal, onMount } from "solid-js";
import { SectionCard } from "../../../components/section-card";
import { defaultSettings, type AppSettings } from "../../../lib/storage";
import { loadProxySettings, saveProxySettings, testProxyConnection, type ProxyTarget } from "../service";

type ProxySettings = AppSettings["proxy"];

const proxyItems: Array<{
  key: ProxyTarget;
  title: string;
  summary: string;
}> = [
  { key: "api", title: "API Proxy", summary: "REST 请求转发。开启后会统一走 /api 并自动附加 ason 头。" },
  { key: "db", title: "DB Proxy", summary: "数据库请求入口。后面 DB 工作区会通过这个地址连接 /ws。" },
  { key: "ssh", title: "SSH Proxy", summary: "SSH relay 入口。后面 SSH 工作区会通过这个地址连接 /ws。" }
];

function FieldLabel(props: { label: string; hint?: string; children: any }) {
  return (
    <label class="grid gap-2">
      <span class="theme-text text-sm font-medium">{props.label}</span>
      <Show when={props.hint}>
        <span class="theme-text-soft text-xs leading-5">{props.hint}</span>
      </Show>
      {props.children}
    </label>
  );
}

export function ProxyPanel() {
  const [settings, setSettings] = createSignal<ProxySettings>(defaultSettings.proxy);
  const [busy, setBusy] = createSignal(false);
  const [notice, setNotice] = createSignal<string>();
  const [testingTarget, setTestingTarget] = createSignal<ProxyTarget>();
  const [testingState, setTestingState] = createSignal<
    Partial<Record<ProxyTarget, { ok: boolean; message: string }>>
  >({});

  onMount(() => {
    void loadProxySettings().then(setSettings);
  });

  const updateItem = (
    target: ProxyTarget,
    updater: (current: ProxySettings[ProxyTarget]) => ProxySettings[ProxyTarget]
  ) => {
    setNotice(undefined);
    setSettings((current) => ({
      ...current,
      [target]: updater(current[target])
    }));
  };

  const handleSave = async () => {
    setBusy(true);
    setNotice(undefined);

    try {
      const saved = await saveProxySettings(settings());
      setSettings(saved);
      setNotice("Proxy settings saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to save proxy settings.");
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async (target: ProxyTarget) => {
    const address = settings()[target].address;
    setTestingTarget(target);
    setNotice(undefined);

    try {
      const result = await testProxyConnection(address);
      setTestingState((current) => ({
        ...current,
        [target]: {
          ok: true,
          message: `Connected (${result.status})`
        }
      }));
    } catch (error) {
      setTestingState((current) => ({
        ...current,
        [target]: {
          ok: false,
          message: error instanceof Error ? error.message : "Connection failed."
        }
      }));
    } finally {
      setTestingTarget(undefined);
    }
  };

  return (
    <SectionCard eyebrow="Settings / Proxy" title="Proxy Routing">
      <div class="grid gap-4">
        <For each={proxyItems}>
          {(item) => {
            const current = () => settings()[item.key];
            const state = () => testingState()[item.key];

            return (
              <div class="theme-control rounded-3xl p-4">
                <div class="grid gap-4 xl:grid-cols-[180px_minmax(0,1fr)_auto] xl:items-end">
                  <FieldLabel label={item.title} hint={item.summary}>
                    <select
                      class="theme-input rounded-2xl px-3 py-3"
                      value={current().mode}
                      onChange={(event) =>
                        updateItem(item.key, (value) => ({
                          ...value,
                          mode: event.currentTarget.value as "none" | "proxy"
                        }))
                      }
                    >
                      <option value="none">None</option>
                      <option value="proxy">Proxy</option>
                    </select>
                  </FieldLabel>

                  <FieldLabel label="Address" hint="例如 http://127.0.0.1:8787">
                    <input
                      class="theme-input rounded-2xl px-3 py-3"
                      placeholder="http://127.0.0.1:8787"
                      value={current().address}
                      disabled={current().mode === "none"}
                      onInput={(event) =>
                        updateItem(item.key, (value) => ({
                          ...value,
                          address: event.currentTarget.value
                        }))
                      }
                    />
                  </FieldLabel>

                  <button
                    class="theme-control rounded-2xl px-4 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    disabled={current().mode === "none" || testingTarget() === item.key}
                    onClick={() => void handleTest(item.key)}
                  >
                    {testingTarget() === item.key ? "Testing..." : "Test"}
                  </button>
                </div>

                <Show when={state()}>
                  {(value) => (
                    <p
                      class={`mt-3 text-sm font-medium ${
                        value().ok ? "text-[#28C840]" : "text-[#FF5F57]"
                      }`}
                    >
                      {value().message}
                    </p>
                  )}
                </Show>
              </div>
            );
          }}
        </For>

        <div class="flex items-center gap-3">
          <button
            class="theme-control rounded-2xl px-4 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={busy()}
            onClick={() => void handleSave()}
          >
            {busy() ? "Saving..." : "Save Proxy Settings"}
          </button>

          <Show when={notice()}>
            {(value) => <span class="theme-text-soft text-sm">{value()}</span>}
          </Show>
        </div>
      </div>
    </SectionCard>
  );
}
