import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { SectionCard } from "../../../components/section-card";
import { defaultSettings, type AppSettings } from "../../../lib/storage";
import {
  getDefaultProxyAddress,
  loadProxySettings,
  saveProxySettings,
  testProxyConnection,
  type ProxyTarget
} from "../service";

type ProxySettings = AppSettings["proxy"];

const proxyItems: Array<{
  key: ProxyTarget;
  title: string;
  summary: string;
  placeholder: string;
}> = [
  {
    key: "api",
    title: "API Proxy",
    summary: "填写完整代理接口地址，例如 http://127.0.0.1:8787/api。",
    placeholder: "http://127.0.0.1:8787/api"
  },
  {
    key: "relay",
    title: "DB / SSH Proxy",
    summary: "DB 和 SSH 共用同一个中转服务基地址，系统会分别连接 /db 和 /ssh，例如 ws://127.0.0.1:8787。",
    placeholder: "ws://127.0.0.1:8787"
  }
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
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let testingMessageTimers: Partial<Record<ProxyTarget, ReturnType<typeof setTimeout>>> = {};

  onMount(() => {
    void loadProxySettings().then(setSettings);
  });

  onCleanup(() => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    Object.values(testingMessageTimers).forEach((timer) => {
      if (timer) {
        clearTimeout(timer);
      }
    });
  });

  const queuePersist = (nextSettings: ProxySettings) => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(() => {
      void saveProxySettings(nextSettings).catch(() => {
        // The panel still keeps the latest local state; explicit save can retry.
      });
    }, 250);
  };

  const updateItem = (
    target: ProxyTarget,
    updater: (current: ProxySettings[ProxyTarget]) => ProxySettings[ProxyTarget]
  ) => {
    setNotice(undefined);
    setSettings((current) => {
      const nextSettings = {
        ...current,
        [target]: updater(current[target])
      };

      queuePersist(nextSettings);

      return nextSettings;
    });
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
      const result = await testProxyConnection(address, target);
      setTestingState((current) => ({
        ...current,
        [target]: {
          ok: true,
          message: `Connected (${result.status})`
        }
      }));

      if (testingMessageTimers[target]) {
        clearTimeout(testingMessageTimers[target]);
      }

      testingMessageTimers[target] = setTimeout(() => {
        setTestingState((current) => ({
          ...current,
          [target]: undefined
        }));
        testingMessageTimers[target] = undefined;
      }, 3000);
    } catch (error) {
      if (testingMessageTimers[target]) {
        clearTimeout(testingMessageTimers[target]);
        testingMessageTimers[target] = undefined;
      }

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
                        updateItem(item.key, (value) => {
                          const nextMode = event.currentTarget.value as "none" | "proxy";

                          return {
                            ...value,
                            mode: nextMode,
                            address:
                              nextMode === "proxy" && !value.address.trim()
                                ? getDefaultProxyAddress(item.key)
                                : value.address
                          };
                        })
                      }
                    >
                      <option value="none">None</option>
                      <option value="proxy">Proxy</option>
                    </select>
                  </FieldLabel>

                  <FieldLabel label="Address" hint={item.placeholder}>
                    <input
                      class="theme-input rounded-2xl px-3 py-3"
                      placeholder={item.placeholder}
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
