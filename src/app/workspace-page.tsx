import { For, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { AppShell } from "../components/app-shell";
import { DbWorkspace, HomeWorkspace, SshWorkspace, ToolsWorkspace } from "./workspace-sections";
import { RestPlayground } from "../features/rest/components/rest-playground";
import { startSyncScheduler } from "../features/sync/service";

type WorkspacePlatform = "extension" | "web";
type WorkspaceTab = "home" | "api" | "db" | "tools" | "ssh";

type WorkspacePageProps = {
  platform: WorkspacePlatform;
};

const topTabs = [
  { id: "home", label: "Home" },
  { id: "api", label: "API" },
  { id: "db", label: "DB" },
  { id: "ssh", label: "SSH" },
  { id: "tools", label: "Tools" }
] as const;

function HomeIcon() {
  return (
    <svg
      aria-hidden="true"
      class="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 10.5L12 4l8 6.5"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.8"
      />
      <path
        d="M7 9.5V20h10V9.5"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.8"
      />
    </svg>
  );
}

export function WorkspacePage(_props: WorkspacePageProps) {
  const [darkMode, setDarkMode] = createSignal(true);
  const [activeTab, setActiveTab] = createSignal<WorkspaceTab>("api");
  const [sidebarOpen, setSidebarOpen] = createSignal(true);

  onMount(() => {
    const stopSyncScheduler = startSyncScheduler();
    const savedTheme = window.localStorage.getItem("devox-theme");

    if (savedTheme === "dark" || savedTheme === "light") {
      setDarkMode(savedTheme === "dark");
    } else {
      const preferredDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setDarkMode(preferredDark);
    }

    onCleanup(stopSyncScheduler);
  });

  createEffect(() => {
    const theme = darkMode() ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("devox-theme", theme);
  });

  const renderActivePage = () => {
    switch (activeTab()) {
      case "home":
        return <HomeWorkspace />;
      case "db":
        return <DbWorkspace sidebarOpen={sidebarOpen()} />;
      case "tools":
        return <ToolsWorkspace sidebarOpen={sidebarOpen()} />;
      case "ssh":
        return <SshWorkspace sidebarOpen={sidebarOpen()} />;
      case "api":
      default:
        return <RestPlayground sidebarOpen={sidebarOpen()} />;
    }
  };

  return (
    <AppShell
      workspace
      title="DevOX Workspace"
      nav={
        <nav class="flex h-9 items-center gap-1" aria-label="Primary">
          <button
            aria-label={sidebarOpen() ? "Collapse sidebar" : "Expand sidebar"}
            title={sidebarOpen() ? "Collapse sidebar" : "Expand sidebar"}
            class="theme-control inline-flex h-7 w-7 items-center justify-center rounded-md p-0 transition"
            onClick={() => setSidebarOpen((value) => !value)}
          >
            <svg
              aria-hidden="true"
              class="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M4 6.5h16M4 12h16M4 17.5h16"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.8"
              />
            </svg>
          </button>
          <For each={topTabs}>
            {(tab) => (
              <button
                class={`inline-flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium leading-none transition ${
                  activeTab() === tab.id
                    ? "theme-tab-active"
                    : "theme-tab border-transparent hover:text-[var(--app-text-muted)]"
                }`}
                aria-current={activeTab() === tab.id ? "page" : undefined}
                onMouseEnter={() => setActiveTab(tab.id)}
                onFocus={() => setActiveTab(tab.id)}
              >
                {tab.id === "home" ? <HomeIcon /> : null}
                {tab.id === "home" ? <span class="sr-only">{tab.label}</span> : tab.label}
              </button>
            )}
          </For>
        </nav>
      }
      actions={
        <div class="flex h-9 items-center gap-2">
          <button
            aria-label={darkMode() ? "Switch to light mode" : "Switch to dark mode"}
            title={darkMode() ? "Switch to light mode" : "Switch to dark mode"}
            class={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition ${
              darkMode()
                ? "bg-[var(--app-accent)] text-white"
                : "bg-[var(--app-panel-soft)] text-[var(--app-text-soft)]"
            }`}
            style={{ "border-color": "var(--app-border)" }}
            onClick={() => setDarkMode((value) => !value)}
          >
            <span
              class={`h-2.5 w-2.5 rounded-full transition ${
                darkMode() ? "bg-white" : "bg-[var(--app-accent)]"
              }`}
            />
          </button>
          <button
            class="theme-control inline-flex h-7 items-center rounded-full px-3 text-sm font-medium transition"
            onClick={() => setActiveTab("home")}
          >
            Login
          </button>
        </div>
      }
    >
      {renderActivePage()}
    </AppShell>
  );
}
