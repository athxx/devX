import type { JSX } from "solid-js";
import { For, Show, createSignal } from "solid-js";
import { SectionCard } from "../../../components/section-card";

type EditorTab = "params" | "headers" | "body" | "auth";
type ResponseTab = "body" | "headers" | "timeline";

type KeyValueRow = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

const editorTabs: { id: EditorTab; label: string }[] = [
  { id: "params", label: "Params" },
  { id: "headers", label: "Headers" },
  { id: "body", label: "Body" },
  { id: "auth", label: "Auth" }
];

const responseTabs: { id: ResponseTab; label: string }[] = [
  { id: "body", label: "Body" },
  { id: "headers", label: "Headers" },
  { id: "timeline", label: "Timeline" }
];

const mockParams: KeyValueRow[] = [
  { id: "param-1", key: "page", value: "1", enabled: true },
  { id: "param-2", key: "limit", value: "20", enabled: true },
  { id: "param-3", key: "sort", value: "created_at:desc", enabled: false }
];

const mockHeaders: KeyValueRow[] = [
  { id: "header-1", key: "Accept", value: "application/json", enabled: true },
  { id: "header-2", key: "X-Workspace", value: "{{workspace}}", enabled: true },
  { id: "header-3", key: "X-Debug", value: "1", enabled: false }
];

const mockHistory = [
  {
    id: "history-1",
    name: "List Users",
    method: "GET",
    status: 200,
    time: "184 ms"
  },
  {
    id: "history-2",
    name: "Create Session",
    method: "POST",
    status: 201,
    time: "242 ms"
  },
  {
    id: "history-3",
    name: "Get Healthcheck",
    method: "GET",
    status: 502,
    time: "61 ms"
  }
];

const mockCollections = [
  { id: "collection-1", name: "Core APIs", count: 12 },
  { id: "collection-2", name: "Auth Flow", count: 5 },
  { id: "collection-3", name: "Billing", count: 8 }
];

const navItems = [
  { id: "rest", name: "REST", summary: "Active module", active: true },
  { id: "graphql", name: "GraphQL", summary: "Planned", active: false },
  { id: "websocket", name: "WebSocket", summary: "Planned", active: false },
  { id: "diff", name: "Diff", summary: "Soon", active: false }
];

const mockResponseBody = `{
  "data": [
    {
      "id": "usr_1024",
      "name": "Avery Chen",
      "role": "admin"
    },
    {
      "id": "usr_1025",
      "name": "Maya Singh",
      "role": "developer"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 48
  }
}`;

function TabButton(props: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      class={`rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
        props.active
          ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
          : "theme-control theme-text-soft"
      }`}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

function KeyValueTable(props: { rows: KeyValueRow[] }) {
  return (
    <div class="overflow-hidden rounded-2xl border" style={{ "border-color": "var(--app-border)" }}>
      <div class="theme-kv-grid grid grid-cols-[88px_1fr_1fr] gap-px">
        <div class="theme-kv-head px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em]">State</div>
        <div class="theme-kv-head px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em]">Key</div>
        <div class="theme-kv-head px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em]">Value</div>
        <For each={props.rows}>
          {(row) => (
            <>
              <div class="theme-kv-cell-muted px-3 py-3 text-sm">
                <span
                  class={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                    row.enabled ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]" : "theme-chip"
                  }`}
                >
                  {row.enabled ? "On" : "Off"}
                </span>
              </div>
              <div class="theme-kv-cell px-3 py-3 text-sm">{row.key}</div>
              <div class="theme-kv-cell-muted px-3 py-3 font-mono text-sm">{row.value}</div>
            </>
          )}
        </For>
      </div>
    </div>
  );
}

function SidebarListSection(props: { title: string; eyebrow: string; children: JSX.Element }) {
  return (
    <section class="space-y-3">
      <div class="space-y-1">
        <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">{props.eyebrow}</p>
        <h3 class="theme-text text-sm font-semibold">{props.title}</h3>
      </div>
      <div class="grid gap-1">{props.children}</div>
    </section>
  );
}

export function RestPlayground(props: { sidebarOpen: boolean }) {
  const [editorTab, setEditorTab] = createSignal<EditorTab>("params");
  const [responseTab, setResponseTab] = createSignal<ResponseTab>("body");

  return (
    <div class={`grid min-h-[calc(100vh-72px)] gap-4 ${props.sidebarOpen ? "xl:grid-cols-[220px_minmax(0,1fr)_320px]" : "xl:grid-cols-[minmax(0,1fr)_320px]"}`}>
      {props.sidebarOpen ? (
        <aside class="theme-sidebar py-2">
          <div class="mb-5 border-b pb-4" style={{ "border-color": "var(--app-border)" }}>
            <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.24em]">Workspace</p>
            <h2 class="theme-text mt-2 text-lg font-semibold">API Studio</h2>
            <p class="theme-text-soft mt-1 text-sm leading-6">全屏工作区，按后台管理台的节奏组织模块和资源。</p>
          </div>

          <div class="mb-5 grid gap-2">
            <For each={navItems}>
              {(item) => (
                <button
                  class={`theme-sidebar-item w-full rounded-xl px-3 py-2.5 text-left ${
                    item.active ? "theme-sidebar-item-active" : "theme-text-muted"
                  }`}
                >
                  <p class={`text-sm font-semibold ${item.active ? "theme-text" : "theme-text-muted"}`}>
                    {item.name}
                  </p>
                  <p class="theme-text-soft mt-1 text-xs uppercase tracking-[0.18em]">{item.summary}</p>
                </button>
              )}
            </For>
          </div>

          <div class="space-y-5">
            <SidebarListSection eyebrow="Collections" title="Saved Requests">
              <For each={mockCollections}>
                {(collection) => (
                  <button class="theme-sidebar-item w-full rounded-xl px-3 py-2.5 text-left">
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <p class="theme-text text-sm font-semibold">{collection.name}</p>
                        <p class="theme-text-soft mt-1 text-xs uppercase tracking-[0.18em]">Request group</p>
                      </div>
                      <span class="theme-chip rounded-full px-2.5 py-1 text-xs font-medium">{collection.count}</span>
                    </div>
                  </button>
                )}
              </For>
            </SidebarListSection>

            <SidebarListSection eyebrow="History" title="Recent Runs">
              <For each={mockHistory}>
                {(entry) => (
                  <button class="theme-sidebar-item w-full rounded-xl px-3 py-2.5 text-left">
                    <div class="mb-2 flex items-center justify-between gap-3">
                      <span
                        class={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                          entry.method === "GET" ? "theme-success" : "theme-warn"
                        }`}
                      >
                        {entry.method}
                      </span>
                      <span class="theme-text-soft text-xs">{entry.time}</span>
                    </div>
                    <p class="theme-text text-sm font-medium">{entry.name}</p>
                    <p class="theme-text-muted mt-1 text-xs">HTTP {entry.status}</p>
                  </button>
                )}
              </For>
            </SidebarListSection>
          </div>
        </aside>
      ) : null}

      <div class="grid min-h-0 gap-4">
        <div class="theme-panel rounded-3xl p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">Request Toolbar</p>
              <h2 class="theme-text mt-2 text-lg font-semibold">User Service / List Users</h2>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <span class="theme-chip rounded-full px-3 py-2 text-xs uppercase tracking-[0.18em]">
                Env: Development
              </span>
              <span class="theme-chip rounded-full px-3 py-2 text-xs uppercase tracking-[0.18em]">
                Collection: Core APIs
              </span>
              <button class="theme-control rounded-2xl px-4 py-3 text-sm font-medium transition">
                Duplicate
              </button>
              <button class="theme-control rounded-2xl px-4 py-3 text-sm font-medium transition">Save</button>
              <button class="theme-button-primary rounded-2xl px-5 py-3 text-sm font-semibold transition">
                Send
              </button>
            </div>
          </div>
        </div>

        <SectionCard eyebrow="Request Builder" title="REST Playground">
          <div class="space-y-4">
            <div class="flex flex-wrap items-center gap-3">
              <div class="theme-control inline-flex rounded-2xl p-1">
                <button class="theme-button-primary rounded-xl px-4 py-3 text-sm font-semibold">GET</button>
                <button class="theme-text-soft rounded-xl px-4 py-3 text-sm font-medium">POST</button>
                <button class="theme-text-soft rounded-xl px-4 py-3 text-sm font-medium">PUT</button>
                <button class="theme-text-soft rounded-xl px-4 py-3 text-sm font-medium">DELETE</button>
              </div>
              <input
                class="theme-input min-w-[260px] flex-1 rounded-2xl px-4 py-3 text-sm transition"
                value="{{baseUrl}}/v1/users"
              />
              <select class="theme-input rounded-2xl px-4 py-3 text-sm">
                <option>Development</option>
                <option>Staging</option>
                <option>Production</option>
              </select>
              <button class="theme-control rounded-2xl px-4 py-3 text-sm font-medium transition">Save</button>
              <button class="theme-button-primary rounded-2xl px-5 py-3 text-sm font-semibold transition">
                Send
              </button>
            </div>

            <div class="theme-panel-soft rounded-3xl p-4">
              <div class="mb-4 flex flex-wrap items-center gap-2">
                <For each={editorTabs}>
                  {(tab) => (
                    <TabButton
                      active={editorTab() === tab.id}
                      label={tab.label}
                      onClick={() => setEditorTab(tab.id)}
                    />
                  )}
                </For>
              </div>

              <Show when={editorTab() === "params"}>
                <KeyValueTable rows={mockParams} />
              </Show>

              <Show when={editorTab() === "headers"}>
                <KeyValueTable rows={mockHeaders} />
              </Show>

              <Show when={editorTab() === "body"}>
                <div class="grid gap-4">
                  <div class="flex items-center gap-3">
                    <span class="theme-chip rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]">
                      JSON
                    </span>
                    <span class="theme-text-soft text-xs">application/json</span>
                  </div>
                  <textarea
                    class="theme-input min-h-[220px] w-full rounded-2xl px-4 py-4 font-mono text-sm leading-6 transition"
                    value={`{
  "filters": {
    "role": "admin"
  },
  "include": ["teams", "permissions"]
}`}
                  />
                </div>
              </Show>

              <Show when={editorTab() === "auth"}>
                <div class="grid gap-4 md:grid-cols-2">
                  <label class="theme-text-muted grid gap-2 text-sm">
                    <span class="theme-text font-medium">Auth Type</span>
                    <select class="theme-input rounded-2xl px-4 py-3 text-sm">
                      <option>Bearer Token</option>
                      <option>Basic Auth</option>
                      <option>API Key</option>
                      <option>None</option>
                    </select>
                  </label>
                  <label class="theme-text-muted grid gap-2 text-sm">
                    <span class="theme-text font-medium">Token</span>
                    <input class="theme-input rounded-2xl px-4 py-3 text-sm" value="{{accessToken}}" />
                  </label>
                </div>
              </Show>
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Response" title="Response Viewer">
          <div class="space-y-4">
            <div class="flex flex-wrap items-center gap-3">
              <div class="theme-success rounded-2xl px-4 py-3">
                <p class="text-xs uppercase tracking-[0.18em]">Status</p>
                <p class="mt-1 text-base font-semibold">200 OK</p>
              </div>
              <div class="theme-chip rounded-2xl px-4 py-3">
                <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Time</p>
                <p class="theme-text mt-1 text-base font-semibold">184 ms</p>
              </div>
              <div class="theme-chip rounded-2xl px-4 py-3">
                <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Size</p>
                <p class="theme-text mt-1 text-base font-semibold">1.8 KB</p>
              </div>
              <div class="theme-chip rounded-2xl px-4 py-3">
                <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Content-Type</p>
                <p class="theme-text mt-1 text-base font-semibold">application/json</p>
              </div>
            </div>

            <div class="theme-panel-soft rounded-3xl p-4">
              <div class="mb-4 flex flex-wrap items-center gap-2">
                <For each={responseTabs}>
                  {(tab) => (
                    <TabButton
                      active={responseTab() === tab.id}
                      label={tab.label}
                      onClick={() => setResponseTab(tab.id)}
                    />
                  )}
                </For>
              </div>

              <Show when={responseTab() === "body"}>
                <pre class="theme-code theme-text-muted overflow-x-auto rounded-2xl px-4 py-4 font-mono text-sm leading-6">
                  <code>{mockResponseBody}</code>
                </pre>
              </Show>

              <Show when={responseTab() === "headers"}>
                <KeyValueTable
                  rows={[
                    {
                      id: "response-header-1",
                      key: "content-type",
                      value: "application/json; charset=utf-8",
                      enabled: true
                    },
                    {
                      id: "response-header-2",
                      key: "cache-control",
                      value: "no-store",
                      enabled: true
                    },
                    {
                      id: "response-header-3",
                      key: "x-request-id",
                      value: "req_49bbd2fd51",
                      enabled: true
                    }
                  ]}
                />
              </Show>

              <Show when={responseTab() === "timeline"}>
                <div class="grid gap-3">
                  <div class="theme-control rounded-2xl px-4 py-4">
                    <div class="flex items-center justify-between gap-3">
                      <p class="theme-text text-sm font-medium">DNS + TCP</p>
                      <span class="theme-text-soft text-sm">16 ms</span>
                    </div>
                  </div>
                  <div class="theme-control rounded-2xl px-4 py-4">
                    <div class="flex items-center justify-between gap-3">
                      <p class="theme-text text-sm font-medium">TTFB</p>
                      <span class="theme-text-soft text-sm">98 ms</span>
                    </div>
                  </div>
                  <div class="theme-control rounded-2xl px-4 py-4">
                    <div class="flex items-center justify-between gap-3">
                      <p class="theme-text text-sm font-medium">Download</p>
                      <span class="theme-text-soft text-sm">70 ms</span>
                    </div>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </SectionCard>
      </div>

      <aside class="grid gap-4">
        <SectionCard eyebrow="Environment" title="Runtime Context">
          <div class="grid gap-3">
            <div class="theme-control rounded-2xl px-4 py-4">
              <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Base URL</p>
              <p class="theme-text mt-2 font-mono text-sm">https://api.dev.internal</p>
            </div>
            <div class="theme-control rounded-2xl px-4 py-4">
              <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Auth</p>
              <p class="theme-text mt-2 text-sm">
                Bearer token from <code class="theme-text-muted font-mono text-xs">{"{{accessToken}}"}</code>
              </p>
            </div>
            <div class="theme-control rounded-2xl px-4 py-4">
              <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Timeout</p>
              <p class="theme-text mt-2 text-sm">15,000 ms</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Inspector" title="Request Summary">
          <div class="theme-text-muted grid gap-3 text-sm">
            <div class="theme-control rounded-2xl px-4 py-4">
              <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Resolved URL</p>
              <p class="theme-text-muted mt-2 break-all font-mono text-xs leading-6">
                https://api.dev.internal/v1/users?page=1&amp;limit=20
              </p>
            </div>
            <div class="theme-control rounded-2xl px-4 py-4">
              <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Body Mode</p>
              <p class="theme-text mt-2 text-sm">JSON</p>
            </div>
            <div class="theme-control rounded-2xl px-4 py-4">
              <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Flags</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <span class="theme-chip rounded-full px-3 py-1 text-xs">History On</span>
                <span class="theme-chip rounded-full px-3 py-1 text-xs">Auth Ready</span>
                <span class="theme-chip rounded-full px-3 py-1 text-xs">Collection Saved</span>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Tips" title="Next Build Steps">
          <div class="theme-text-muted space-y-3 text-sm leading-6">
            <p>先把当前请求区接成真实 `fetch`，再把响应面板替换成真实返回值。</p>
            <p>接下来左侧的 `History` 和 `Collections` 可以直接绑定到 `chrome.storage`。</p>
            <p>右侧 `Inspector` 后面适合放变量解析结果和请求执行日志。</p>
          </div>
        </SectionCard>
      </aside>
    </div>
  );
}
