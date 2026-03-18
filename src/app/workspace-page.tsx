import { For, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { AppShell } from "../components/app-shell";
import {
  DbWorkspace,
  HomeWorkspace,
  SettingsWorkspace,
  SshWorkspace,
  ToolsWorkspace
} from "./workspace-sections";
import { workspaceCopy, workspaceLocaleOptions, type WorkspaceLocale } from "./workspace-copy";
import { RestPlayground } from "../features/rest/components/rest-playground";
import { startSyncScheduler } from "../features/sync/service";

type WorkspacePlatform = "extension" | "web";
type WorkspaceTab = "home" | "api" | "db" | "tools" | "ssh" | "settings";

type WorkspacePageProps = {
  platform: WorkspacePlatform;
};

const topTabs = [{ id: "home" }, { id: "api" }, { id: "db" }, { id: "ssh" }, { id: "tools" }] as const;

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

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      class="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 8.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Z"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.8"
      />
      <path
        d="M19 12a7 7 0 0 0-.09-1.1l1.63-1.27-1.5-2.6-1.97.53a7.02 7.02 0 0 0-1.9-1.1L14.9 4h-3l-.27 2.46a7.02 7.02 0 0 0-1.9 1.1l-1.97-.53-1.5 2.6 1.63 1.27A7 7 0 0 0 8 12c0 .37.03.74.09 1.1l-1.63 1.27 1.5 2.6 1.97-.53c.58.45 1.21.82 1.9 1.1L11.9 20h3l.27-2.46c.69-.28 1.32-.65 1.9-1.1l1.97.53 1.5-2.6-1.63-1.27c.06-.36.09-.73.09-1.1Z"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.4"
      />
    </svg>
  );
}

export function WorkspacePage(_props: WorkspacePageProps) {
  const sidebarWidthStorageKey = "devx-sidebar-width";
  const topTabHoverDelayMs = 300;
  const clampSidebarWidth = (value: number) => Math.min(520, Math.max(180, Math.round(value)));
  const [darkMode, setDarkMode] = createSignal(true);
  const [locale, setLocale] = createSignal<WorkspaceLocale>("zh-CN");
  const [activeTab, setActiveTab] = createSignal<WorkspaceTab>("home");
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [sidebarWidth, setSidebarWidth] = createSignal(220);
  const [sidebarResizing, setSidebarResizing] = createSignal(false);
  const copy = createMemo(() => workspaceCopy[locale()]);
  let topTabHoverTimer: number | undefined;

  onMount(() => {
    const stopSyncScheduler = startSyncScheduler();
    const savedTheme = window.localStorage.getItem("devx-theme");
    const savedLocale = window.localStorage.getItem("devx-locale");
    const savedSidebarWidth = window.localStorage.getItem(sidebarWidthStorageKey);

    if (savedTheme === "dark" || savedTheme === "light") {
      setDarkMode(savedTheme === "dark");
    } else {
      const preferredDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setDarkMode(preferredDark);
    }

    if (savedLocale === "zh-CN" || savedLocale === "en-US") {
      setLocale(savedLocale);
    }

    if (savedSidebarWidth) {
      const parsedWidth = Number(savedSidebarWidth);
      if (!Number.isNaN(parsedWidth)) {
        setSidebarWidth(clampSidebarWidth(parsedWidth));
      }
    }

    onCleanup(stopSyncScheduler);
  });

  onCleanup(() => {
    if (topTabHoverTimer) {
      window.clearTimeout(topTabHoverTimer);
    }
  });

  createEffect(() => {
    const theme = darkMode() ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("devx-theme", theme);
  });

  createEffect(() => {
    document.documentElement.lang = locale();
    window.localStorage.setItem("devx-locale", locale());
  });

  createEffect(() => {
    window.localStorage.setItem(sidebarWidthStorageKey, String(sidebarWidth()));
  });

  const handleSidebarResizeStart = (event: MouseEvent) => {
    if (!sidebarOpen()) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth();
    setSidebarResizing(true);

    const handlePointerMove = (moveEvent: MouseEvent) => {
      const nextWidth = clampSidebarWidth(startWidth + (moveEvent.clientX - startX));
      setSidebarWidth(nextWidth);
    };

    const handlePointerUp = () => {
      setSidebarResizing(false);
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp, { once: true });
  };

  const cancelTopTabHover = () => {
    if (topTabHoverTimer) {
      window.clearTimeout(topTabHoverTimer);
      topTabHoverTimer = undefined;
    }
  };

  const scheduleTopTabHover = (tab: WorkspaceTab) => {
    cancelTopTabHover();
    topTabHoverTimer = window.setTimeout(() => {
      setActiveTab(tab);
      topTabHoverTimer = undefined;
    }, topTabHoverDelayMs);
  };

  const renderActivePage = () => {
    switch (activeTab()) {
      case "settings":
        return (
          <SettingsWorkspace
            sidebarOpen={sidebarOpen()}
            sidebarWidth={sidebarWidth()}
            sidebarResizing={sidebarResizing()}
            onSidebarResizeStart={handleSidebarResizeStart}
          />
        );
      case "home":
        return <HomeWorkspace />;
      case "db":
        return (
          <DbWorkspace
            sidebarOpen={sidebarOpen()}
            sidebarWidth={sidebarWidth()}
            sidebarResizing={sidebarResizing()}
            onSidebarResizeStart={handleSidebarResizeStart}
          />
        );
      case "tools":
        return (
          <ToolsWorkspace
            sidebarOpen={sidebarOpen()}
            sidebarWidth={sidebarWidth()}
            sidebarResizing={sidebarResizing()}
            onSidebarResizeStart={handleSidebarResizeStart}
          />
        );
      case "ssh":
        return (
          <SshWorkspace
            sidebarOpen={sidebarOpen()}
            sidebarWidth={sidebarWidth()}
            sidebarResizing={sidebarResizing()}
            onSidebarResizeStart={handleSidebarResizeStart}
          />
        );
      case "api":
      default:
        return (
          <RestPlayground
            sidebarOpen={sidebarOpen()}
            sidebarWidth={sidebarWidth()}
            sidebarResizing={sidebarResizing()}
            onSidebarResizeStart={handleSidebarResizeStart}
          />
        );
    }
  };

  return (
    <AppShell
      workspace
      title="DevX Workspace"
      nav={
        <nav class="flex h-9 items-center gap-1" aria-label="Primary">
          <button
            aria-label={sidebarOpen() ? copy().actions.collapseSidebar : copy().actions.expandSidebar}
            title={sidebarOpen() ? copy().actions.collapseSidebar : copy().actions.expandSidebar}
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
                onMouseEnter={() => scheduleTopTabHover(tab.id)}
                onMouseLeave={cancelTopTabHover}
                onFocus={() => setActiveTab(tab.id)}
              >
                {tab.id === "home" ? <HomeIcon /> : null}
                {tab.id === "home" ? (
                  <span class="sr-only">{copy().tabs.home}</span>
                ) : (
                  copy().tabs[tab.id]
                )}
              </button>
            )}
          </For>
        </nav>
      }
      actions={
        <div class="flex h-9 items-center gap-2">
          <select
            id="workspace-locale-select"
            aria-label={copy().actions.language}
            class="theme-input h-7 rounded-full px-3 text-sm"
            value={locale()}
            onInput={(event) => setLocale(event.currentTarget.value as WorkspaceLocale)}
          >
            <For each={workspaceLocaleOptions}>
              {(option) => <option value={option.code}>{option.label}</option>}
            </For>
          </select>
          <button
            aria-label={
              darkMode() ? copy().actions.switchToLightMode : copy().actions.switchToDarkMode
            }
            title={darkMode() ? copy().actions.switchToLightMode : copy().actions.switchToDarkMode}
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
            aria-label={copy().actions.openSettings}
            title={copy().actions.openSettings}
            class={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition ${
              activeTab() === "settings"
                ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
                : "theme-control"
            }`}
            style={{ "border-color": "var(--app-border)" }}
            onClick={() => setActiveTab("settings")}
          >
            <SettingsIcon />
          </button>
        </div>
      }
    >
      {renderActivePage()}
    </AppShell>
  );
}
