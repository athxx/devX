import { For } from "solid-js";
import { SectionCard } from "../components/section-card";

const homeCards = [
  { title: "API Requests", meta: "12 collections", summary: "继续进入 REST 工作台，管理请求集合、历史记录和环境变量。" },
  { title: "Database", meta: "4 connections", summary: "预留数据库连接、查询历史和结果查看的工作区。" },
  { title: "Tools", meta: "8 utilities", summary: "格式转换、Diff、编码解码、JSON 处理等工具集入口。" }
];

const toolGroups = [
  { name: "Formatter", summary: "JSON / SQL / XML / YAML 格式化与压缩。" },
  { name: "Diff", summary: "文本、配置、接口返回值差异对比。" },
  { name: "Encode", summary: "Base64、URL、JWT、Hash、Timestamp 等常用转换。" }
];

export function HomeWorkspace() {
  return (
    <div class="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <SectionCard eyebrow="Overview" title="Workspace Home">
        <div class="grid gap-4 md:grid-cols-3">
          <For each={homeCards}>
            {(card) => (
              <article class="theme-control rounded-3xl p-4">
                <p class="theme-text text-sm font-semibold">{card.title}</p>
                <p class="theme-text-soft mt-1 text-xs uppercase tracking-[0.18em]">{card.meta}</p>
                <p class="theme-text-muted mt-3 text-sm leading-6">{card.summary}</p>
              </article>
            )}
          </For>
        </div>
      </SectionCard>

      <SectionCard eyebrow="Today" title="Recent Activity">
        <div class="grid gap-3">
          <div class="theme-control rounded-2xl px-4 py-4">
            <p class="theme-text text-sm font-medium">REST collection refreshed</p>
            <p class="theme-text-soft mt-1 text-xs">Core APIs · 12 requests</p>
          </div>
          <div class="theme-control rounded-2xl px-4 py-4">
            <p class="theme-text text-sm font-medium">JSON diff snapshot saved</p>
            <p class="theme-text-soft mt-1 text-xs">Billing payload · 09:21</p>
          </div>
          <div class="theme-control rounded-2xl px-4 py-4">
            <p class="theme-text text-sm font-medium">Environment switched to Staging</p>
            <p class="theme-text-soft mt-1 text-xs">Shared workspace state</p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

export function DbWorkspace() {
  return (
    <div class="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
      <aside class="theme-sidebar py-2">
        <div class="mb-5 border-b pb-4" style={{ "border-color": "var(--app-border)" }}>
          <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.24em]">Connections</p>
          <h2 class="theme-text mt-2 text-lg font-semibold">Database</h2>
          <p class="theme-text-soft mt-1 text-sm leading-6">连接、查询历史和结果视图都从这里进入。</p>
        </div>

        <div class="grid gap-3">
          <div class="theme-sidebar-item rounded-xl px-3 py-2.5">
            <p class="theme-text text-sm font-semibold">Primary PostgreSQL</p>
            <p class="theme-text-soft mt-1 text-xs uppercase tracking-[0.18em]">staging / readonly</p>
          </div>
          <div class="theme-sidebar-item rounded-xl px-3 py-2.5">
            <p class="theme-text text-sm font-semibold">Analytics MySQL</p>
            <p class="theme-text-soft mt-1 text-xs uppercase tracking-[0.18em]">warehouse / readonly</p>
          </div>
          <div class="theme-sidebar-item rounded-xl px-3 py-2.5">
            <p class="theme-text text-sm font-semibold">Redis Cache</p>
            <p class="theme-text-soft mt-1 text-xs uppercase tracking-[0.18em]">session / inspect</p>
          </div>
        </div>
      </aside>

      <div class="grid gap-4">
        <SectionCard eyebrow="Query Editor" title="Query Draft">
          <div class="theme-code rounded-3xl px-4 py-4">
            <pre class="theme-text-muted overflow-x-auto font-mono text-sm leading-7">
              <code>{`SELECT id, name, status
FROM users
WHERE deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 50;`}</code>
            </pre>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Preview" title="Result Viewer">
          <div class="grid gap-3 md:grid-cols-3">
            <div class="theme-control rounded-2xl px-4 py-4">
              <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Rows</p>
              <p class="theme-text mt-2 text-lg font-semibold">50</p>
            </div>
            <div class="theme-control rounded-2xl px-4 py-4">
              <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Runtime</p>
              <p class="theme-text mt-2 text-lg font-semibold">84 ms</p>
            </div>
            <div class="theme-control rounded-2xl px-4 py-4">
              <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Source</p>
              <p class="theme-text mt-2 text-lg font-semibold">PostgreSQL</p>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

export function ToolsWorkspace() {
  return (
    <div class="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
      <aside class="theme-sidebar py-2">
        <div class="mb-5 border-b pb-4" style={{ "border-color": "var(--app-border)" }}>
          <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.24em]">Utilities</p>
          <h2 class="theme-text mt-2 text-lg font-semibold">Tools</h2>
          <p class="theme-text-soft mt-1 text-sm leading-6">格式转换、差异对比和编码工具统一放在左侧菜单里。</p>
        </div>

        <div class="grid gap-3">
          <For each={toolGroups}>
            {(tool) => (
              <div class="theme-sidebar-item rounded-xl px-3 py-2.5">
                <p class="theme-text text-sm font-semibold">{tool.name}</p>
                <p class="theme-text-soft mt-1 text-xs uppercase tracking-[0.18em]">utility module</p>
              </div>
            )}
          </For>
        </div>
      </aside>

      <div class="grid gap-4">
        <SectionCard eyebrow="Toolkit" title="Utility Modules">
          <div class="grid gap-4 md:grid-cols-3">
            <For each={toolGroups}>
              {(tool) => (
                <div class="theme-control rounded-3xl p-4">
                  <p class="theme-text text-sm font-semibold">{tool.name}</p>
                  <p class="theme-text-muted mt-3 text-sm leading-6">{tool.summary}</p>
                </div>
              )}
            </For>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Scratchpad" title="Transform Playground">
          <div class="theme-code rounded-3xl px-4 py-4">
            <pre class="theme-text-muted overflow-x-auto font-mono text-sm leading-7">
              <code>{`{
  "mode": "formatter",
  "input": "base64 / url / json / jwt",
  "output": "preview here"
}`}</code>
            </pre>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

export function SshWorkspace() {
  return (
    <div class="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
      <aside class="theme-sidebar py-2">
        <div class="mb-5 border-b pb-4" style={{ "border-color": "var(--app-border)" }}>
          <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.24em]">Profiles</p>
          <h2 class="theme-text mt-2 text-lg font-semibold">SSH</h2>
          <p class="theme-text-soft mt-1 text-sm leading-6">连接配置、跳板机和终端会话统一放在左侧管理。</p>
        </div>

        <div class="grid gap-3">
          <div class="theme-sidebar-item rounded-xl px-3 py-2.5">
            <p class="theme-text text-sm font-semibold">Staging Web 01</p>
            <p class="theme-text-soft mt-1 text-xs uppercase tracking-[0.18em]">deploy · jump enabled</p>
          </div>
          <div class="theme-sidebar-item rounded-xl px-3 py-2.5">
            <p class="theme-text text-sm font-semibold">Production Bastion</p>
            <p class="theme-text-soft mt-1 text-xs uppercase tracking-[0.18em]">ops · restricted</p>
          </div>
          <div class="theme-sidebar-item rounded-xl px-3 py-2.5">
            <p class="theme-text text-sm font-semibold">Local Sandbox</p>
            <p class="theme-text-soft mt-1 text-xs uppercase tracking-[0.18em]">testing shell</p>
          </div>
        </div>
      </aside>

      <div class="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <SectionCard eyebrow="SSH" title="Terminal Workspace">
          <div class="theme-code rounded-3xl px-4 py-4">
            <pre class="theme-text-muted overflow-x-auto font-mono text-sm leading-7">
              <code>{`devops@staging-web-01:~$ ssh deploy@10.0.1.24
Connecting...
Waiting for transport adapter...
`}</code>
            </pre>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Status" title="Connection Notes">
          <div class="grid gap-3">
            <div class="theme-control rounded-2xl px-4 py-4">
              <p class="theme-text text-sm font-medium">Profiles</p>
              <p class="theme-text-soft mt-1 text-xs">Production / Staging / Jump Host</p>
            </div>
            <div class="theme-control rounded-2xl px-4 py-4">
              <p class="theme-text text-sm font-medium">Current state</p>
              <p class="theme-text-soft mt-1 text-xs">UI shell only, execution pipeline pending</p>
            </div>
            <div class="theme-control rounded-2xl px-4 py-4">
              <p class="theme-text text-sm font-medium">Next step</p>
              <p class="theme-text-soft mt-1 text-xs">确认 SSH 的平台策略后再接真实连接层</p>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
