import type { JSX } from "solid-js";
import { For, Show, createSignal } from "solid-js";
import { SectionCard } from "../components/section-card";
import { WorkspaceSidebarLayout } from "../components/workspace-sidebar-layout";
import { SyncPanel } from "../features/sync/components/sync-panel";

type SidebarWorkspaceProps = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarResizing: boolean;
  onSidebarResizeStart: (event: MouseEvent) => void;
};

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

type SettingsSectionId = "sync" | "account" | "team" | "billing" | "about";

const settingsSections: Array<{
  id: SettingsSectionId;
  title: string;
  summary: string;
}> = [
  { id: "sync", title: "Sync", summary: "云同步、备份和导入导出。" },
  { id: "account", title: "Account", summary: "个人身份、偏好和访问控制。" },
  { id: "team", title: "Team", summary: "团队版、统一管理和工作区分发。" },
  { id: "billing", title: "Billing", summary: "赞助、订阅和企业采购入口。" },
  { id: "about", title: "About", summary: "产品说明、版本信息和支持入口。" }
];

function SettingsPlaceholder(props: {
  eyebrow: string;
  title: string;
  summary: string;
  bullets: string[];
}) {
  return (
    <SectionCard eyebrow={props.eyebrow} title={props.title}>
      <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div class="grid gap-3">
          <div class="theme-control rounded-3xl p-4">
            <p class="theme-text text-sm font-semibold">{props.title}</p>
            <p class="theme-text-muted mt-2 text-sm leading-6">{props.summary}</p>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <For each={props.bullets}>
              {(item) => (
                <div class="theme-control rounded-3xl p-4">
                  <p class="theme-text text-sm font-semibold">{item}</p>
                  <p class="theme-text-soft mt-2 text-xs leading-5">
                    这块先作为设置骨架保留，后面可以直接接真实配置和权限逻辑。
                  </p>
                </div>
              )}
            </For>
          </div>
        </div>

        <div class="theme-control rounded-3xl p-4">
          <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Status</p>
          <p class="theme-text mt-2 text-lg font-semibold">Planning Slot</p>
          <p class="theme-text-muted mt-3 text-sm leading-6">
            这里现在先保留后台管理模板式的信息位，方便后面继续扩展成完整设置中心。
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

function LinearWorkspaceSection(props: {
  eyebrow?: string;
  title: string;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <section
      class={`border-t px-4 py-4 ${props.class ?? ""}`}
      style={{ "border-color": "var(--app-border)" }}
    >
      <div class="mb-4 space-y-1">
        <Show when={props.eyebrow}>
          <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">{props.eyebrow}</p>
        </Show>
        <h2 class="theme-text text-base font-semibold">{props.title}</h2>
      </div>
      {props.children}
    </section>
  );
}

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

export function SettingsWorkspace(props: SidebarWorkspaceProps) {
  const [activeSection, setActiveSection] = createSignal<SettingsSectionId>("sync");

  const renderSettingsContent = () => {
    switch (activeSection()) {
      case "account":
        return (
          <SettingsPlaceholder
            eyebrow="Settings / Account"
            title="Account Preferences"
            summary="后面可以放个人登录、身份提供商绑定、默认工作区、访问设备列表和审计信息。"
            bullets={["Profile", "Sessions", "Security"]}
          />
        );
      case "team":
        return (
          <SettingsPlaceholder
            eyebrow="Settings / Team"
            title="Team Workspace"
            summary="这里适合放团队版介绍、成员邀请、企业统一管理、策略下发和组织级工作区能力。"
            bullets={["Members", "Policies", "Managed Config"]}
          />
        );
      case "billing":
        return (
          <SettingsPlaceholder
            eyebrow="Settings / Billing"
            title="Billing & Support"
            summary="这里可以承接赞助、个人订阅、团队套餐和企业采购流程，也能放捐赠入口。"
            bullets={["Donate", "Plans", "Invoices"]}
          />
        );
      case "about":
        return (
          <SettingsPlaceholder
            eyebrow="Settings / About"
            title="About DevOX"
            summary="适合放版本、路线图、开源说明、社区入口和支持联系方式。"
            bullets={["Version", "Roadmap", "Support"]}
          />
        );
      case "sync":
      default:
        return (
          <div class="grid gap-4">
            <SectionCard eyebrow="Settings / Sync" title="Sync & Backup">
              <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div class="grid gap-3">
                  <div class="theme-control rounded-3xl p-4">
                    <p class="theme-text text-sm font-semibold">Workspace Snapshot</p>
                    <p class="theme-text-muted mt-2 text-sm leading-6">
                      管理本地 IndexedDB 快照、云端同步策略和手动导入导出。这里是日常操作入口，
                      不会再占用 Home 的展示空间。
                    </p>
                  </div>
                  <div class="grid gap-3 md:grid-cols-3">
                    <div class="theme-control rounded-3xl p-4">
                      <p class="theme-text text-sm font-semibold">Providers</p>
                      <p class="theme-text-soft mt-2 text-xs leading-5">
                        Dropbox / OneDrive / Google Drive / WebDAV / Local
                      </p>
                    </div>
                    <div class="theme-control rounded-3xl p-4">
                      <p class="theme-text text-sm font-semibold">Local Backup</p>
                      <p class="theme-text-soft mt-2 text-xs leading-5">
                        JSON import and export for portable recovery.
                      </p>
                    </div>
                    <div class="theme-control rounded-3xl p-4">
                      <p class="theme-text text-sm font-semibold">Auto Sync</p>
                      <p class="theme-text-soft mt-2 text-xs leading-5">
                        Periodic background sync with provider-specific settings.
                      </p>
                    </div>
                  </div>
                </div>

                <div class="theme-control rounded-3xl p-4">
                  <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Mode</p>
                  <p class="theme-text mt-2 text-lg font-semibold">Operational Settings</p>
                  <p class="theme-text-muted mt-3 text-sm leading-6">
                    这部分更偏真实运维操作，所以单独收进设置页会更清晰，也更符合后台产品的结构。
                  </p>
                </div>
              </div>
            </SectionCard>

            <SyncPanel />
          </div>
        );
    }
  };

  return (
    <WorkspaceSidebarLayout
      sidebarOpen={props.sidebarOpen}
      sidebarWidth={props.sidebarWidth}
      sidebarResizing={props.sidebarResizing}
      onResizeStart={props.onSidebarResizeStart}
      contentClass="grid gap-4"
      sidebar={
        <>
        <div class="mb-5 border-b pb-4" style={{ "border-color": "var(--app-border)" }}>
          <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.24em]">Settings</p>
          <h2 class="theme-text mt-2 text-lg font-semibold">Workspace</h2>
          <p class="theme-text-soft mt-1 text-sm leading-6">
            把同步、团队版、赞助和产品说明拆开收纳，Home 就能保持更轻。
          </p>
        </div>

        <div class="grid gap-1">
          <For each={settingsSections}>
            {(section) => (
              <button
                class={`theme-sidebar-item w-full rounded-xl px-3 py-2.5 text-left ${
                  activeSection() === section.id ? "theme-sidebar-item-active" : ""
                }`}
                onClick={() => setActiveSection(section.id)}
              >
                <p class="theme-text text-sm font-semibold">{section.title}</p>
                <p class="theme-text-soft mt-1 text-xs leading-5">{section.summary}</p>
              </button>
            )}
          </For>
        </div>
        </>
      }
    >
      {renderSettingsContent()}
    </WorkspaceSidebarLayout>
  );
}

export function DbWorkspace(props: SidebarWorkspaceProps) {
  return (
    <WorkspaceSidebarLayout
      sidebarOpen={props.sidebarOpen}
      sidebarWidth={props.sidebarWidth}
      sidebarResizing={props.sidebarResizing}
      onResizeStart={props.onSidebarResizeStart}
      contentClass="theme-workspace-pane grid gap-0 border-l"
      contentStyle={{ "border-color": "var(--app-border)" }}
      sidebar={
        <>
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
        </>
      }
    >
        <LinearWorkspaceSection eyebrow="Query Editor" title="Query Draft">
          <div class="theme-code border px-4 py-4" style={{ "border-color": "var(--app-border)" }}>
            <pre class="theme-text-muted overflow-x-auto font-mono text-sm leading-7">
              <code>{`SELECT id, name, status
FROM users
WHERE deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 50;`}</code>
            </pre>
          </div>
        </LinearWorkspaceSection>

        <LinearWorkspaceSection eyebrow="Preview" title="Result Viewer" class="border-b">
          <div
            class="grid gap-px overflow-hidden border md:grid-cols-3"
            style={{ "border-color": "var(--app-border)", background: "var(--app-border)" }}
          >
            <div class="theme-kv-cell-muted px-4 py-4">
              <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Rows</p>
              <p class="theme-text mt-2 text-lg font-semibold">50</p>
            </div>
            <div class="theme-kv-cell-muted px-4 py-4">
              <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Runtime</p>
              <p class="theme-text mt-2 text-lg font-semibold">84 ms</p>
            </div>
            <div class="theme-kv-cell-muted px-4 py-4">
              <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">Source</p>
              <p class="theme-text mt-2 text-lg font-semibold">PostgreSQL</p>
            </div>
          </div>
        </LinearWorkspaceSection>
    </WorkspaceSidebarLayout>
  );
}

export function ToolsWorkspace(props: SidebarWorkspaceProps) {
  return (
    <WorkspaceSidebarLayout
      sidebarOpen={props.sidebarOpen}
      sidebarWidth={props.sidebarWidth}
      sidebarResizing={props.sidebarResizing}
      onResizeStart={props.onSidebarResizeStart}
      contentClass="theme-workspace-pane grid gap-0 border-l"
      contentStyle={{ "border-color": "var(--app-border)" }}
      sidebar={
        <>
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
        </>
      }
    >
        <LinearWorkspaceSection eyebrow="Toolkit" title="Utility Modules">
          <div class="grid gap-4 md:grid-cols-3">
            <For each={toolGroups}>
              {(tool) => (
                <div class="border px-4 py-4" style={{ "border-color": "var(--app-border)" }}>
                  <p class="theme-text text-sm font-semibold">{tool.name}</p>
                  <p class="theme-text-muted mt-3 text-sm leading-6">{tool.summary}</p>
                </div>
              )}
            </For>
          </div>
        </LinearWorkspaceSection>

        <LinearWorkspaceSection eyebrow="Scratchpad" title="Transform Playground" class="border-b">
          <div class="theme-code border px-4 py-4" style={{ "border-color": "var(--app-border)" }}>
            <pre class="theme-text-muted overflow-x-auto font-mono text-sm leading-7">
              <code>{`{
  "mode": "formatter",
  "input": "base64 / url / json / jwt",
  "output": "preview here"
}`}</code>
            </pre>
          </div>
        </LinearWorkspaceSection>
    </WorkspaceSidebarLayout>
  );
}

export function SshWorkspace(props: SidebarWorkspaceProps) {
  return (
    <WorkspaceSidebarLayout
      sidebarOpen={props.sidebarOpen}
      sidebarWidth={props.sidebarWidth}
      sidebarResizing={props.sidebarResizing}
      onResizeStart={props.onSidebarResizeStart}
      contentClass="theme-workspace-pane grid gap-0 border-l xl:grid-cols-[1fr_0.9fr]"
      contentStyle={{ "border-color": "var(--app-border)" }}
      sidebar={
        <>
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
        </>
      }
    >
        <LinearWorkspaceSection eyebrow="SSH" title="Terminal Workspace" class="xl:border-r">
          <div class="theme-code border px-4 py-4" style={{ "border-color": "var(--app-border)" }}>
            <pre class="theme-text-muted overflow-x-auto font-mono text-sm leading-7">
              <code>{`devops@staging-web-01:~$ ssh deploy@10.0.1.24
Connecting...
Waiting for transport adapter...
`}</code>
            </pre>
          </div>
        </LinearWorkspaceSection>

        <LinearWorkspaceSection eyebrow="Status" title="Connection Notes" class="border-b">
          <div
            class="grid gap-px overflow-hidden border"
            style={{ "border-color": "var(--app-border)", background: "var(--app-border)" }}
          >
            <div class="theme-kv-cell-muted px-4 py-4">
              <p class="theme-text text-sm font-medium">Profiles</p>
              <p class="theme-text-soft mt-1 text-xs">Production / Staging / Jump Host</p>
            </div>
            <div class="theme-kv-cell-muted px-4 py-4">
              <p class="theme-text text-sm font-medium">Current state</p>
              <p class="theme-text-soft mt-1 text-xs">UI shell only, execution pipeline pending</p>
            </div>
            <div class="theme-kv-cell-muted px-4 py-4">
              <p class="theme-text text-sm font-medium">Next step</p>
              <p class="theme-text-soft mt-1 text-xs">确认 SSH 的平台策略后再接真实连接层</p>
            </div>
          </div>
        </LinearWorkspaceSection>
    </WorkspaceSidebarLayout>
  );
}
