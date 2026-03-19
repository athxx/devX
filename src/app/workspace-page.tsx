import {
  ErrorBoundary,
  For,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { AppShell } from "../components/app-shell";
import { DbPanel } from "../features/db/components/db-panel";
import { SshPanel } from "../features/ssh/components/ssh-panel";
import {
  HomeWorkspace,
  SettingsWorkspace,
  ToolsWorkspace,
} from "./workspace-sections";
import {
  workspaceCopy,
  workspaceLocaleOptions,
  type WorkspaceLocale,
} from "./workspace-copy";
import { RestPlayground } from "../features/rest/components/rest-playground";
import { startSyncScheduler } from "../features/sync/service";

type WorkspacePlatform = "extension" | "web";
type WorkspaceTab = "home" | "api" | "db" | "tools" | "ssh" | "settings";

type WorkspacePageProps = {
  platform: WorkspacePlatform;
};

const topTabs = [
  { id: "home" },
  { id: "api" },
  { id: "db" },
  { id: "ssh" },
  { id: "tools" },
] as const;

function HomeIcon() {
  return (
    <svg
      aria-hidden="true"
      class="h-4 w-4"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M9.686.764c1.272-1.02 3.348-1.02 4.632.011l8.315 6.648c.923.744 1.524 2.315 1.332 3.49l-1.596 9.552c-.288 1.691-1.932 3.084-3.648 3.084H5.283c-1.728 0-3.36-1.38-3.648-3.084L.04 10.914c-.204-1.176.396-2.747 1.332-3.491L9.686.763zm2.316 9.214a3 3 0 1 0 0 5.999 3 3 0 0 0 0-5.999z"
        fill="#FFBF00"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      class="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M13.752 4.693c0-.835-.61-1.544-1.436-1.67a2.111 2.111 0 0 0-.632 0 1.689 1.689 0 0 0-1.436 1.67v1.181c-.471.135-.92.322-1.34.556l-.836-.835a1.689 1.689 0 0 0-2.196-.166c-.17.126-.32.277-.447.447a1.689 1.689 0 0 0 .166 2.196l.835.835a6.33 6.33 0 0 0-.556 1.341h-1.18c-.836 0-1.545.61-1.67 1.436-.032.21-.032.423 0 .632a1.689 1.689 0 0 0 1.67 1.436h1.18c.135.471.322.92.556 1.34l-.835.836c-.59.59-.66 1.523-.166 2.196.126.17.277.32.447.447a1.688 1.688 0 0 0 2.196-.166l.835-.835c.42.234.87.421 1.341.556v1.18c0 .836.61 1.545 1.436 1.67.21.032.423.032.632 0a1.688 1.688 0 0 0 1.436-1.67v-1.18a6.335 6.335 0 0 0 1.34-.556l.836.835c.59.59 1.523.66 2.196.166a2.11 2.11 0 0 0 .447-.447 1.688 1.688 0 0 0-.166-2.196l-.835-.835c.234-.42.421-.87.556-1.341h1.18c.836 0 1.545-.61 1.67-1.436.032-.21.032-.423 0-.632a1.688 1.688 0 0 0-1.67-1.436h-1.18a6.332 6.332 0 0 0-.556-1.34l.835-.836c.59-.59.66-1.524.166-2.196a2.11 2.11 0 0 0-.447-.447 1.689 1.689 0 0 0-2.196.166l-.835.835a6.328 6.328 0 0 0-1.341-.556v-1.18z"
        stroke="#676767"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M9.5 12a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0z"
        stroke="#676767"
        stroke-width="1.5"
      />
    </svg>
  );
}

function PanelError(props: { error: Error; name: string }) {
  return (
    <div class="flex h-full items-center justify-center p-8">
      <div class="max-w-lg rounded-2xl border border-red-300 bg-red-50 p-6 text-left dark:border-red-800 dark:bg-red-950">
        <p class="text-base font-semibold text-red-700 dark:text-red-300">
          {props.name} panel crashed
        </p>
        <pre class="mt-3 overflow-auto whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">
          {props.error?.message ?? String(props.error)}
          {"\n"}
          {props.error?.stack}
        </pre>
      </div>
    </div>
  );
}

export function WorkspacePage(_props: WorkspacePageProps) {
  const sidebarWidthStorageKey = "devx-sidebar-width";
  const topTabHoverDelayMs = 300;
  const clampSidebarWidth = (value: number) =>
    Math.min(520, Math.max(180, Math.round(value)));
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
    const savedSidebarWidth = window.localStorage.getItem(
      sidebarWidthStorageKey,
    );

    if (savedTheme === "dark" || savedTheme === "light") {
      setDarkMode(savedTheme === "dark");
    } else {
      const preferredDark = window.matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches;
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
      const nextWidth = clampSidebarWidth(
        startWidth + (moveEvent.clientX - startX),
      );
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

  const tabPanelStyle = (tab: WorkspaceTab) =>
    activeTab() === tab ? { display: "contents" } : { display: "none" };

  return (
    <AppShell
      workspace
      title="DevX Workspace"
      nav={
        <nav class="flex h-9 items-center gap-1" aria-label="Primary">
          <button
            aria-label={
              sidebarOpen()
                ? copy().actions.collapseSidebar
                : copy().actions.expandSidebar
            }
            title={
              sidebarOpen()
                ? copy().actions.collapseSidebar
                : copy().actions.expandSidebar
            }
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
                aria-label={tab.id === "home" ? copy().tabs.home : undefined}
                aria-current={activeTab() === tab.id ? "page" : undefined}
                onMouseEnter={() => scheduleTopTabHover(tab.id)}
                onMouseLeave={cancelTopTabHover}
                onFocus={() => setActiveTab(tab.id)}
              >
                {tab.id === "home" ? <HomeIcon /> : null}
                {tab.id === "home" ? null : copy().tabs[tab.id]}
              </button>
            )}
          </For>
        </nav>
      }
      actions={
        <div class="flex h-9 items-center gap-2">
          <button
            class="theme-donate-button inline-flex h-7 items-center justify-center rounded-full px-3.5 text-sm font-semibold transition hover:brightness-105"
            onClick={() => setActiveTab("home")}
          >
            {copy().actions.donate}
          </button>
          <select
            id="workspace-locale-select"
            aria-label={copy().actions.language}
            class="theme-input h-7 rounded-full px-3 text-sm"
            value={locale()}
            onInput={(event) =>
              setLocale(event.currentTarget.value as WorkspaceLocale)
            }
          >
            <For each={workspaceLocaleOptions}>
              {(option) => <option value={option.code}>{option.label}</option>}
            </For>
          </select>
          <button
            aria-label={
              darkMode()
                ? copy().actions.switchToLightMode
                : copy().actions.switchToDarkMode
            }
            title={
              darkMode()
                ? copy().actions.switchToLightMode
                : copy().actions.switchToDarkMode
            }
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
      <div style={tabPanelStyle("home")}>
        <HomeWorkspace />
      </div>
      <div style={tabPanelStyle("api")}>
        <ErrorBoundary
          fallback={(err) => <PanelError error={err} name="REST" />}
        >
          <RestPlayground
            sidebarOpen={sidebarOpen()}
            sidebarWidth={sidebarWidth()}
            sidebarResizing={sidebarResizing()}
            onSidebarResizeStart={handleSidebarResizeStart}
          />
        </ErrorBoundary>
      </div>
      <div style={tabPanelStyle("db")}>
        <ErrorBoundary fallback={(err) => <PanelError error={err} name="DB" />}>
          <DbPanel
            sidebarOpen={sidebarOpen()}
            sidebarWidth={sidebarWidth()}
            sidebarResizing={sidebarResizing()}
            onSidebarResizeStart={handleSidebarResizeStart}
          />
        </ErrorBoundary>
      </div>
      <div style={tabPanelStyle("ssh")}>
        <ErrorBoundary
          fallback={(err) => <PanelError error={err} name="SSH" />}
        >
          <SshPanel
            sidebarOpen={sidebarOpen()}
            sidebarWidth={sidebarWidth()}
            sidebarResizing={sidebarResizing()}
            onSidebarResizeStart={handleSidebarResizeStart}
          />
        </ErrorBoundary>
      </div>
      <div style={tabPanelStyle("tools")}>
        <ToolsWorkspace
          sidebarOpen={sidebarOpen()}
          sidebarWidth={sidebarWidth()}
          sidebarResizing={sidebarResizing()}
          onSidebarResizeStart={handleSidebarResizeStart}
        />
      </div>
      <div style={tabPanelStyle("settings")}>
        <SettingsWorkspace
          sidebarOpen={sidebarOpen()}
          sidebarWidth={sidebarWidth()}
          sidebarResizing={sidebarResizing()}
          onSidebarResizeStart={handleSidebarResizeStart}
        />
      </div>
    </AppShell>
  );
}
