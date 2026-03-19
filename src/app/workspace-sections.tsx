import type { JSX } from "solid-js";
import { For, Show, createSignal } from "solid-js";
import { SectionCard } from "../components/section-card";
import { WorkspaceSection } from "../components/workspace-section";
import { WorkspaceSidebarLayout } from "../components/workspace-sidebar-layout";
import { ProxyPanel } from "../features/proxy/components/proxy-panel";
import { SyncPanel } from "../features/sync/components/sync-panel";

type SidebarWorkspaceProps = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarResizing: boolean;
  onSidebarResizeStart: (event: MouseEvent) => void;
};

const homeCards = [
  {
    title: "API Requests",
    meta: "12 collections",
    summary: "继续进入 REST 工作台，管理请求集合、历史记录和环境变量。",
  },
  {
    title: "Database",
    meta: "4 connections",
    summary: "预留数据库连接、查询历史和结果查看的工作区。",
  },
  {
    title: "Tools",
    meta: "8 utilities",
    summary: "格式转换、Diff、编码解码、JSON 处理等工具集入口。",
  },
];

const toolGroups = [
  { name: "Formatter", summary: "JSON / SQL / XML / YAML 格式化与压缩。" },
  { name: "Diff", summary: "文本、配置、接口返回值差异对比。" },
  { name: "Encode", summary: "Base64、URL、JWT、Hash、Timestamp 等常用转换。" },
];

type SettingsSectionId =
  | "proxy"
  | "sync"
  | "account"
  | "team"
  | "billing"
  | "about";

const settingsSections: Array<{
  id: SettingsSectionId;
  title: string;
  summary: string;
}> = [
  {
    id: "proxy",
    title: "Proxy",
    summary: "API / DB / SSH 的代理入口与连通性测试。",
  },
  { id: "sync", title: "Sync", summary: "云同步、备份和导入导出。" },
  { id: "account", title: "Account", summary: "个人身份、偏好和访问控制。" },
  { id: "team", title: "Team", summary: "团队版、统一管理和工作区分发。" },
  { id: "billing", title: "Billing", summary: "赞助、订阅和企业采购入口。" },
  { id: "about", title: "About", summary: "产品说明、版本信息和支持入口。" },
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
            <p class="theme-text-muted mt-2 text-sm leading-6">
              {props.summary}
            </p>
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
          <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">
            Status
          </p>
          <p class="theme-text mt-2 text-lg font-semibold">Planning Slot</p>
          <p class="theme-text-muted mt-3 text-sm leading-6">
            这里现在先保留后台管理模板式的信息位，方便后面继续扩展成完整设置中心。
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

export function HomeWorkspace() {
  return (
    <div class="mt-4 grid gap-4 px-4 pb-4 xl:grid-cols-[1.2fr_0.8fr]">
      <SectionCard eyebrow="Overview" title="Workspace Home">
        <div class="grid gap-4 md:grid-cols-3">
          <For each={homeCards}>
            {(card) => (
              <article class="theme-control rounded-3xl p-4">
                <p class="theme-text text-sm font-semibold">{card.title}</p>
                <p class="theme-text-soft mt-1 text-xs uppercase tracking-[0.18em]">
                  {card.meta}
                </p>
                <p class="theme-text-muted mt-3 text-sm leading-6">
                  {card.summary}
                </p>
              </article>
            )}
          </For>
        </div>
      </SectionCard>

      <SectionCard eyebrow="Today" title="Recent Activity">
        <div class="grid gap-3">
          <div class="theme-control rounded-2xl px-4 py-4">
            <p class="theme-text text-sm font-medium">
              REST collection refreshed
            </p>
            <p class="theme-text-soft mt-1 text-xs">Core APIs · 12 requests</p>
          </div>
          <div class="theme-control rounded-2xl px-4 py-4">
            <p class="theme-text text-sm font-medium">
              JSON diff snapshot saved
            </p>
            <p class="theme-text-soft mt-1 text-xs">Billing payload · 09:21</p>
          </div>
          <div class="theme-control rounded-2xl px-4 py-4">
            <p class="theme-text text-sm font-medium">
              Environment switched to Staging
            </p>
            <p class="theme-text-soft mt-1 text-xs">Shared workspace state</p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

export function SettingsWorkspace(props: SidebarWorkspaceProps) {
  const [activeSection, setActiveSection] =
    createSignal<SettingsSectionId>("proxy");

  const renderSettingsContent = () => {
    switch (activeSection()) {
      case "proxy":
        return <ProxyPanel />;
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
            title="About DevX"
            summary="适合放版本、路线图、开源说明、社区入口和支持联系方式。"
            bullets={["Version", "Roadmap", "Support"]}
          />
        );
      case "sync":
      default:
        return <SyncPanel />;
    }
  };

  return (
    <WorkspaceSidebarLayout
      sidebarOpen={props.sidebarOpen}
      sidebarWidth={props.sidebarWidth}
      sidebarResizing={props.sidebarResizing}
      onResizeStart={props.onSidebarResizeStart}
      contentClass="mt-4 grid gap-4"
      sidebar={
        <>
          <div class="grid gap-1">
            <For each={settingsSections}>
              {(section) => (
                <button
                  class={`theme-sidebar-item w-full rounded-xl px-3 py-2.5 text-left ${
                    activeSection() === section.id
                      ? "theme-sidebar-item-active"
                      : ""
                  }`}
                  onClick={() => setActiveSection(section.id)}
                >
                  <p class="theme-text text-sm font-semibold">
                    {section.title}
                  </p>
                  <p class="theme-text-soft mt-1 text-xs leading-5">
                    {section.summary}
                  </p>
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
          <div
            class="mb-5 border-b pb-4"
            style={{ "border-color": "var(--app-border)" }}
          >
            <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.24em]">
              Utilities
            </p>
            <h2 class="theme-text mt-2 text-lg font-semibold">Tools</h2>
            <p class="theme-text-soft mt-1 text-sm leading-6">
              格式转换、差异对比和编码工具统一放在左侧菜单里。
            </p>
          </div>

          <div class="grid gap-3">
            <For each={toolGroups}>
              {(tool) => (
                <div class="theme-sidebar-item rounded-xl px-3 py-2.5">
                  <p class="theme-text text-sm font-semibold">{tool.name}</p>
                  <p class="theme-text-soft mt-1 text-xs uppercase tracking-[0.18em]">
                    utility module
                  </p>
                </div>
              )}
            </For>
          </div>
        </>
      }
    >
      <WorkspaceSection eyebrow="Toolkit" title="Utility Modules">
        <div class="grid gap-4 md:grid-cols-3">
          <For each={toolGroups}>
            {(tool) => (
              <div
                class="border px-4 py-4"
                style={{ "border-color": "var(--app-border)" }}
              >
                <p class="theme-text text-sm font-semibold">{tool.name}</p>
                <p class="theme-text-muted mt-3 text-sm leading-6">
                  {tool.summary}
                </p>
              </div>
            )}
          </For>
        </div>
      </WorkspaceSection>

      <WorkspaceSection
        eyebrow="Scratchpad"
        title="Transform Playground"
        class="border-b"
      >
        <div
          class="theme-code border px-4 py-4"
          style={{ "border-color": "var(--app-border)" }}
        >
          <pre class="theme-text-muted overflow-x-auto font-mono text-sm leading-7">
            <code>{`{
  "mode": "formatter",
  "input": "base64 / url / json / jwt",
  "output": "preview here"
}`}</code>
          </pre>
        </div>
      </WorkspaceSection>
    </WorkspaceSidebarLayout>
  );
}
