import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount
} from "solid-js";
import { createStore, produce } from "solid-js/store";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { WorkspaceSidebarLayout } from "../../../components/workspace-sidebar-layout";
import { RequestTabsBar } from "../../rest/components/request-tabs-bar";
import { ControlDot, PinIcon } from "../../rest/components/rest-ui-primitives";
import type {
  SshConnectPayload,
  SshFolder,
  SshProfile,
  SshWorkspaceState
} from "../models";
import {
  addSshFolder,
  addSshProfile,
  buildSshRelayUrl,
  deleteSshFolder,
  deleteSshProfile,
  loadSshWorkspace,
  saveSshWorkspace,
  updateSshFolder,
  updateSshProfile
} from "../service";

type SshPanelProps = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarResizing: boolean;
  onSidebarResizeStart: (event: MouseEvent) => void;
};

type SessionState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "connected" }
  | { status: "error"; message: string }
  | { status: "disconnected" };

type ProfileTabMenuState = {
  id: string;
  x: number;
  y: number;
};

type PaneContextMenuState = {
  tabId: string;
  paneId: string;
  x: number;
  y: number;
};

type TerminalPane = {
  id: string;
  profileId: string;
};

type TerminalLayoutNode =
  | {
      type: "leaf";
      paneId: string;
    }
  | {
      type: "split";
      id: string;
      direction: "columns" | "rows";
      ratio: number;
      first: TerminalLayoutNode;
      second: TerminalLayoutNode;
    };

type TerminalTab = {
  id: string;
  root: TerminalLayoutNode;
  activePaneId: string;
    };

type PaneRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type SplitHandleRect = {
  id: string;
  direction: "columns" | "rows";
  left: number;
  top: number;
  width: number;
  height: number;
  containerLeft: number;
  containerTop: number;
  containerWidth: number;
  containerHeight: number;
};

const expandedFoldersStorageKey = "devx-ssh-expanded-folders";
const sshUiStateStorageKey = "devx-ssh-ui-state";

type PersistedSshUiState = {
  openTabIds: string[];
  pinnedTabIds: string[];
  activeTabId: string | null;
  tabsById: Record<string, TerminalTab>;
  panesById: Record<string, TerminalPane>;
};

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const emptyProfile = (folderId: string | null = null): SshProfile => ({
  id: newId(),
  name: "",
  folderId,
  target: "remote",
  host: "",
  port: 22,
  username: "",
  authMethod: "password",
  password: "",
  privateKey: "",
  passphrase: ""
});

function getProfileStatusDotClass(status: SessionState["status"]) {
  if (status === "connected") {
    return "bg-[#28C840] shadow-[0_0_6px_#28C840]";
  }
  if (status === "connecting") {
    return "bg-[#E0AF68] shadow-[0_0_6px_#E0AF68]";
  }
  if (status === "error") {
    return "bg-[#FF5F57] shadow-[0_0_6px_#FF5F57]";
  }
  return "bg-[#7f7f85]";
}

function loadExpandedFolders() {
  const raw = window.localStorage.getItem(expandedFoldersStorageKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function loadPersistedSshUiState(): PersistedSshUiState | null {
  const raw = window.localStorage.getItem(sshUiStateStorageKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedSshUiState;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.openTabIds) ||
      !Array.isArray(parsed.pinnedTabIds) ||
      typeof parsed.tabsById !== "object" ||
      typeof parsed.panesById !== "object"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function arrayMove<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return items.slice();
  }

  const next = items.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, item);
  return next;
}

function reorderByDirection(ids: string[], id: string, direction: "up" | "down") {
  const index = ids.indexOf(id);
  if (index < 0) {
    return ids.slice();
  }

  if (direction === "up" && index > 0) {
    return arrayMove(ids, index, index - 1);
  }

  if (direction === "down" && index < ids.length - 1) {
    return arrayMove(ids, index, index + 1);
  }

  return ids.slice();
}

function cloneLayoutNode(node: TerminalLayoutNode): TerminalLayoutNode {
  if (node.type === "leaf") {
    return { ...node };
  }
  return {
    ...node,
    first: cloneLayoutNode(node.first),
    second: cloneLayoutNode(node.second)
  };
}

function collectPaneIds(node: TerminalLayoutNode): string[] {
  if (node.type === "leaf") {
    return [node.paneId];
  }
  return [...collectPaneIds(node.first), ...collectPaneIds(node.second)];
}

function getFirstPaneId(node: TerminalLayoutNode): string {
  return node.type === "leaf" ? node.paneId : getFirstPaneId(node.first);
}

function findPaneInLayout(node: TerminalLayoutNode, paneId: string): boolean {
  if (node.type === "leaf") {
    return node.paneId === paneId;
  }
  return findPaneInLayout(node.first, paneId) || findPaneInLayout(node.second, paneId);
}

function findPaneForProfileInLayout(
  node: TerminalLayoutNode,
  panesById: Record<string, TerminalPane>,
  profileId: string
): string | null {
  if (node.type === "leaf") {
    return panesById[node.paneId]?.profileId === profileId ? node.paneId : null;
  }
  return (
    findPaneForProfileInLayout(node.first, panesById, profileId) ??
    findPaneForProfileInLayout(node.second, panesById, profileId)
  );
}

function splitLayoutAtPane(
  node: TerminalLayoutNode,
  targetPaneId: string,
  direction: "columns" | "rows",
  newPaneId: string
): TerminalLayoutNode {
  if (node.type === "leaf") {
    if (node.paneId !== targetPaneId) {
      return node;
    }
    return {
      type: "split",
      id: newId(),
      direction,
      ratio: 0.5,
      first: { type: "leaf", paneId: targetPaneId },
      second: { type: "leaf", paneId: newPaneId }
    };
  }

  return {
    ...node,
    first: splitLayoutAtPane(node.first, targetPaneId, direction, newPaneId),
    second: splitLayoutAtPane(node.second, targetPaneId, direction, newPaneId)
  };
}

function removePaneFromLayout(node: TerminalLayoutNode, targetPaneId: string): TerminalLayoutNode | null {
  if (node.type === "leaf") {
    return node.paneId === targetPaneId ? null : node;
  }

  const nextFirst = removePaneFromLayout(node.first, targetPaneId);
  const nextSecond = removePaneFromLayout(node.second, targetPaneId);

  if (!nextFirst && !nextSecond) {
    return null;
  }
  if (!nextFirst) {
    return nextSecond;
  }
  if (!nextSecond) {
    return nextFirst;
  }

  return {
    ...node,
    first: nextFirst,
    second: nextSecond
  };
}

function updateSplitRatioInLayout(
  node: TerminalLayoutNode,
  splitId: string,
  ratio: number
): TerminalLayoutNode {
  if (node.type === "leaf") {
    return node;
  }
  if (node.id === splitId) {
    return {
      ...node,
      ratio
    };
  }
  return {
    ...node,
    first: updateSplitRatioInLayout(node.first, splitId, ratio),
    second: updateSplitRatioInLayout(node.second, splitId, ratio)
  };
}

function computeLayoutRects(
  node: TerminalLayoutNode,
  left: number,
  top: number,
  width: number,
  height: number,
  paneRects: Map<string, PaneRect>,
  splitRects: Map<string, SplitHandleRect>
) {
  if (node.type === "leaf") {
    paneRects.set(node.paneId, { left, top, width, height });
    return;
  }

  if (node.direction === "columns") {
    const firstWidth = width * node.ratio;
    const secondWidth = width - firstWidth;
    computeLayoutRects(node.first, left, top, firstWidth, height, paneRects, splitRects);
    computeLayoutRects(node.second, left + firstWidth, top, secondWidth, height, paneRects, splitRects);
    splitRects.set(node.id, {
      id: node.id,
      direction: "columns",
      left: left + firstWidth,
      top,
      width: 0,
      height,
      containerLeft: left,
      containerTop: top,
      containerWidth: width,
      containerHeight: height
    });
    return;
  }

  const firstHeight = height * node.ratio;
  const secondHeight = height - firstHeight;
  computeLayoutRects(node.first, left, top, width, firstHeight, paneRects, splitRects);
  computeLayoutRects(node.second, left, top + firstHeight, width, secondHeight, paneRects, splitRects);
  splitRects.set(node.id, {
    id: node.id,
    direction: "rows",
    left,
    top: top + firstHeight,
    width,
    height: 0,
    containerLeft: left,
    containerTop: top,
    containerWidth: width,
    containerHeight: height
  });
}

function sanitizeLayoutNode(
  node: TerminalLayoutNode | null | undefined,
  panesById: Record<string, TerminalPane>
): TerminalLayoutNode | null {
  if (!node) {
    return null;
  }

  if (node.type === "leaf") {
    return panesById[node.paneId] ? { type: "leaf", paneId: node.paneId } : null;
  }

  const first = sanitizeLayoutNode(node.first, panesById);
  const second = sanitizeLayoutNode(node.second, panesById);

  if (!first && !second) {
    return null;
  }
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }

  return {
    type: "split",
    id: node.id || newId(),
    direction: node.direction === "rows" ? "rows" : "columns",
    ratio: Math.max(0.18, Math.min(0.82, typeof node.ratio === "number" ? node.ratio : 0.5)),
    first,
    second
  };
}

export function SshPanel(props: SshPanelProps) {
  const [workspace, setWorkspace] = createSignal<SshWorkspaceState>({
    folders: [],
    profiles: []
  });
  const [editingProfile, setEditingProfile] = createSignal<SshProfile | null>(null);
  const [tabsById, setTabsById] = createStore<Record<string, TerminalTab>>({});
  const [panesById, setPanesById] = createStore<Record<string, TerminalPane>>({});
  const [sessionByPaneId, setSessionByPaneId] = createStore<Record<string, SessionState>>({});
  const [relayErrorByPaneId, setRelayErrorByPaneId] = createStore<Record<string, string | null>>({});
  const [headerMenuOpen, setHeaderMenuOpen] = createSignal(false);
  const [folderMenuId, setFolderMenuId] = createSignal<string | null>(null);
  const [profileMenuId, setProfileMenuId] = createSignal<string | null>(null);
  const [profileMoveMenuId, setProfileMoveMenuId] = createSignal<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = createSignal<string[]>([]);
  const [openTabIds, setOpenTabIds] = createSignal<string[]>([]);
  const [pinnedTabIds, setPinnedTabIds] = createSignal<string[]>([]);
  const [draggedTabId, setDraggedTabId] = createSignal<string | null>(null);
  const [tabDropTargetId, setTabDropTargetId] = createSignal<string | null>(null);
  const [activeTabId, setActiveTabId] = createSignal<string | null>(null);
  const [profileTabMenuState, setProfileTabMenuState] = createSignal<ProfileTabMenuState | null>(null);
  const [paneMenuState, setPaneMenuState] = createSignal<PaneContextMenuState | null>(null);
  const [connectionSwitcherPaneId, setConnectionSwitcherPaneId] = createSignal<string | null>(null);
  const [uiStateReady, setUiStateReady] = createSignal(false);

  const termViewportRefs = new Map<string, HTMLDivElement>();
  const termMountRefs = new Map<string, HTMLDivElement>();
  const terminals = new Map<string, Terminal>();
  const fitAddons = new Map<string, FitAddon>();
  const resizeObservers = new Map<string, ResizeObserver>();
  const wsByPaneId = new Map<string, WebSocket>();
  const termDataDisposers = new Map<string, { dispose: () => void }>();

  const rootProfiles = createMemo(() =>
    workspace().profiles.filter((profile) => !profile.folderId)
  );
  const folderEntries = createMemo(() =>
    workspace().folders.map((folder) => ({
      folder,
      profiles: workspace().profiles.filter((profile) => profile.folderId === folder.id)
    }))
  );
  const profileMap = createMemo(() => new Map(workspace().profiles.map((profile) => [profile.id, profile])));
  const activeTab = createMemo(() => (activeTabId() ? tabsById[activeTabId()!] ?? null : null));
  const activePaneId = createMemo(() => activeTab()?.activePaneId ?? null);
  const activePane = createMemo(() => (activePaneId() ? panesById[activePaneId()!] ?? null : null));
  const activePaneProfile = createMemo(() => {
    const pane = activePane();
    if (!pane) {
      return null;
    }
    return profileMap().get(pane.profileId) ?? null;
  });
  const currentTabMenuTab = createMemo(() =>
    profileTabMenuState() ? tabsById[profileTabMenuState()!.id] ?? null : null
  );
  const paneContext = createMemo(() => {
    const state = paneMenuState();
    if (!state) {
      return null;
    }
    return {
      tab: tabsById[state.tabId] ?? null,
      pane: panesById[state.paneId] ?? null
    };
  });

  const tabItems = createMemo(() => {
    const validIds = new Set(Object.keys(tabsById));
    const openIds = openTabIds().filter((id) => validIds.has(id));
    const pinnedIds = new Set(pinnedTabIds().filter((id) => validIds.has(id)));
    const orderedIds = [
      ...openIds.filter((id) => pinnedIds.has(id)),
      ...openIds.filter((id) => !pinnedIds.has(id))
    ];

    return orderedIds
      .map((tabId) => {
        const tab = tabsById[tabId];
        if (!tab) return null;
        const pane = panesById[tab.activePaneId];
        const profile = pane ? profileMap().get(pane.profileId) : null;
        const paneCount = collectPaneIds(tab.root).length;
        const paneCountSuffix = paneCount > 1 ? ` +${paneCount - 1}` : "";
        return {
          id: tab.id,
          name: `${profile?.name ?? "Session"}${paneCountSuffix}`,
          badgeLabel: profile?.target === "local" ? "LOC" : "SSH",
          badgeClass:
            profile?.target === "local"
              ? "theme-method-badge theme-method-get"
              : "theme-method-badge theme-method-default",
          active: activeTabId() === tab.id,
          pinned: pinnedTabIds().includes(tab.id)
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  });

  const openConnectionProfiles = createMemo(() =>
    workspace().profiles.slice().sort((a, b) => a.name.localeCompare(b.name))
  );

  const activeRelayError = createMemo(() =>
    activePaneId() ? relayErrorByPaneId[activePaneId()!] ?? null : null
  );

  function getPaneConnectionLabel(paneId: string) {
    const profileId = panesById[paneId]?.profileId;
    if (!profileId) {
      return "Connections";
    }
    return profileMap().get(profileId)?.name ?? "Connections";
  }

  function getPaneSession(paneId: string): SessionState {
    return sessionByPaneId[paneId] ?? { status: "idle" };
  }

  function getProfileAggregateStatus(profileId: string): SessionState["status"] {
    const statuses = Object.values(panesById)
      .filter((pane) => pane.profileId === profileId)
      .map((pane) => getPaneSession(pane.id).status);
    if (statuses.includes("connected")) return "connected";
    if (statuses.includes("connecting")) return "connecting";
    if (statuses.includes("error")) return "error";
    if (statuses.includes("disconnected")) return "disconnected";
    return "idle";
  }

  function getProfileHoverAction(profileId: string) {
    const status = getProfileAggregateStatus(profileId);
    if (status === "connected" || status === "connecting") {
      return "disconnect";
    }
    return "connect";
  }

  function setTabState(tabId: string, updater: (tab: TerminalTab) => TerminalTab) {
    setTabsById(
      produce((draft) => {
        const current = draft[tabId];
        if (!current) return;
        draft[tabId] = updater({ ...current, root: cloneLayoutNode(current.root) });
      })
    );
  }

  function deleteTabState(tabId: string) {
    setTabsById(
      produce((draft) => {
        delete draft[tabId];
      })
    );
  }

  function setPaneState(paneId: string, profileId: string) {
    setPanesById(
      produce((draft) => {
        draft[paneId] = { id: paneId, profileId };
      })
    );
  }

  function deletePaneState(paneId: string) {
    setPanesById(
      produce((draft) => {
        delete draft[paneId];
      })
    );
    setSessionByPaneId(
      produce((draft) => {
        delete draft[paneId];
      })
    );
    setRelayErrorByPaneId(
      produce((draft) => {
        delete draft[paneId];
      })
    );
  }

  function findOpenTabForProfile(profileId: string) {
    return openTabIds().find((tabId) => {
      const tab = tabsById[tabId];
      return tab ? Boolean(findPaneForProfileInLayout(tab.root, panesById, profileId)) : false;
    }) ?? null;
  }

  function findPaneForProfileInTab(tabId: string, profileId: string) {
    const tab = tabsById[tabId];
    if (!tab) return null;
    return findPaneForProfileInLayout(tab.root, panesById, profileId);
  }

  onMount(() => {
    setExpandedFolderIds(loadExpandedFolders());
    void loadSshWorkspace().then((loaded) => {
      setWorkspace(loaded);
      const persisted = loadPersistedSshUiState();
      const validProfileIds = new Set(loaded.profiles.map((profile) => profile.id));
      const persistedPanes = Object.fromEntries(
        Object.entries(persisted?.panesById ?? {}).filter(([, pane]) => validProfileIds.has(pane.profileId))
      ) as Record<string, TerminalPane>;
      const restoredTabs: Record<string, TerminalTab> = {};

      for (const [tabId, tab] of Object.entries(persisted?.tabsById ?? {})) {
        const root = sanitizeLayoutNode(tab.root, persistedPanes);
        if (!root) {
          continue;
        }
        const paneIds = collectPaneIds(root);
        if (paneIds.length === 0) {
          continue;
        }
        restoredTabs[tabId] = {
          id: tabId,
          root,
          activePaneId: paneIds.includes(tab.activePaneId) ? tab.activePaneId : getFirstPaneId(root)
        };
      }

      const usedPaneIds = new Set(
        Object.values(restoredTabs).flatMap((tab) => collectPaneIds(tab.root))
      );
      const restoredPanes = Object.fromEntries(
        Object.entries(persistedPanes).filter(([paneId]) => usedPaneIds.has(paneId))
      ) as Record<string, TerminalPane>;
      const restoredOpenTabIds = (persisted?.openTabIds ?? []).filter((tabId) => restoredTabs[tabId]);
      const restoredPinnedTabIds = (persisted?.pinnedTabIds ?? []).filter((tabId) => restoredTabs[tabId]);
      const restoredActiveTabId =
        persisted?.activeTabId && restoredTabs[persisted.activeTabId]
          ? persisted.activeTabId
          : restoredOpenTabIds.at(-1) ?? null;

      setTabsById(
        produce((draft) => {
          Object.keys(draft).forEach((key) => delete draft[key]);
          Object.assign(draft, restoredTabs);
        })
      );
      setPanesById(
        produce((draft) => {
          Object.keys(draft).forEach((key) => delete draft[key]);
          Object.assign(draft, restoredPanes);
        })
      );
      setOpenTabIds(restoredOpenTabIds);
      setPinnedTabIds(restoredPinnedTabIds);
      setActiveTabId(restoredActiveTabId);
      setUiStateReady(true);
    });
  });

  createEffect(() => {
    window.localStorage.setItem(expandedFoldersStorageKey, JSON.stringify(expandedFolderIds()));
  });

  createEffect(() => {
    if (!uiStateReady()) {
      return;
    }

    const serializedTabs = Object.fromEntries(
      Object.entries(tabsById).map(([tabId, tab]) => [
        tabId,
        {
          id: tab.id,
          root: cloneLayoutNode(tab.root),
          activePaneId: tab.activePaneId
        }
      ])
    ) as Record<string, TerminalTab>;
    const usedPaneIds = new Set(
      Object.values(serializedTabs).flatMap((tab) => collectPaneIds(tab.root))
    );
    const serializedPanes = Object.fromEntries(
      Object.entries(panesById)
        .filter(([paneId]) => usedPaneIds.has(paneId))
        .map(([paneId, pane]) => [paneId, { id: pane.id, profileId: pane.profileId }])
    ) as Record<string, TerminalPane>;

    window.localStorage.setItem(
      sshUiStateStorageKey,
      JSON.stringify({
        openTabIds: openTabIds(),
        pinnedTabIds: pinnedTabIds(),
        activeTabId: activeTabId(),
        tabsById: serializedTabs,
        panesById: serializedPanes
      } satisfies PersistedSshUiState)
    );
  });

  createEffect(() => {
    const folderIds = new Set(workspace().folders.map((folder) => folder.id));
    setExpandedFolderIds((current) => current.filter((id) => folderIds.has(id)));
  });

  createEffect(() => {
    const validTabIds = new Set(Object.keys(tabsById));
    setOpenTabIds((current) => current.filter((id) => validTabIds.has(id)));
    setPinnedTabIds((current) => current.filter((id) => validTabIds.has(id)));
    if (activeTabId() && !validTabIds.has(activeTabId()!)) {
      setActiveTabId(null);
    }
  });

  createEffect(() => {
    const paneId = activePaneId();
    if (paneId) {
      fitPaneTerminal(paneId);
    }
  });

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-ssh-menu-root]")) {
        return;
      }
      setHeaderMenuOpen(false);
      setFolderMenuId(null);
      setProfileMenuId(null);
      setProfileMoveMenuId(null);
      setProfileTabMenuState(null);
      setPaneMenuState(null);
      setConnectionSwitcherPaneId(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    onCleanup(() => document.removeEventListener("pointerdown", handlePointerDown));
  });

  onCleanup(() => {
    wsByPaneId.forEach((_, paneId) => disconnectPane(paneId, false));
    resizeObservers.forEach((observer) => observer.disconnect());
    termDataDisposers.forEach((disposer) => disposer.dispose());
    terminals.forEach((instance) => instance.dispose());
  });

  function initTerminal(paneId: string) {
    const mountEl = termMountRefs.get(paneId);
    const viewportEl = termViewportRefs.get(paneId);
    if (!mountEl || !viewportEl) {
      return null;
    }

    if (terminals.has(paneId)) {
      return terminals.get(paneId)!;
    }

    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: {
        background: "#0d0e14",
        foreground: "#c0caf5",
        cursor: "#7aa2f7",
        selectionBackground: "rgba(122,162,247,0.25)",
        black: "#1d202f",
        red: "#f7768e",
        green: "#9ece6a",
        yellow: "#e0af68",
        blue: "#7aa2f7",
        magenta: "#bb9af7",
        cyan: "#7dcfff",
        white: "#a9b1d6",
        brightBlack: "#414868",
        brightRed: "#f7768e",
        brightGreen: "#9ece6a",
        brightYellow: "#e0af68",
        brightBlue: "#7aa2f7",
        brightMagenta: "#bb9af7",
        brightCyan: "#7dcfff",
        brightWhite: "#c0caf5"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(mountEl);
    fitAddon.fit();

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      const currentWs = wsByPaneId.get(paneId);
      if (currentWs?.readyState === WebSocket.OPEN && dims) {
        currentWs.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }
    });
    resizeObserver.observe(viewportEl);

    terminals.set(paneId, terminal);
    fitAddons.set(paneId, fitAddon);
    resizeObservers.set(paneId, resizeObserver);
    return terminal;
  }

  async function waitForPaneMount(paneId: string, attempts = 12) {
    for (let index = 0; index < attempts; index += 1) {
      if (termMountRefs.get(paneId) && termViewportRefs.get(paneId)) {
        return true;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return false;
  }

  function fitPaneTerminal(paneId: string) {
    requestAnimationFrame(() => {
      const fitAddon = fitAddons.get(paneId);
      fitAddon?.fit();
      const dims = fitAddon?.proposeDimensions();
      const currentWs = wsByPaneId.get(paneId);
      if (currentWs?.readyState === WebSocket.OPEN && dims) {
        currentWs.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }
    });
  }

  function disconnectPane(paneId: string, setIdle = true) {
    const ws = wsByPaneId.get(paneId);
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
      wsByPaneId.delete(paneId);
    }
    if (setIdle) {
      setSessionByPaneId(paneId, { status: "idle" });
    }
    termDataDisposers.get(paneId)?.dispose();
    termDataDisposers.delete(paneId);
  }

  function cleanupPaneResources(paneId: string) {
    disconnectPane(paneId, false);
    resizeObservers.get(paneId)?.disconnect();
    resizeObservers.delete(paneId);
    fitAddons.delete(paneId);
    terminals.get(paneId)?.dispose();
    terminals.delete(paneId);
    termMountRefs.delete(paneId);
    termViewportRefs.delete(paneId);
    deletePaneState(paneId);
  }

  function clearTerminal(paneId: string) {
    terminals.get(paneId)?.clear();
  }

  function writeTerminalNotice(paneId: string, message: string) {
    terminals.get(paneId)?.writeln(`\r\n\x1b[2;37m${message}\x1b[0m`);
  }

  function createTabForProfile(profile: SshProfile) {
    const tabId = newId();
    const paneId = newId();
    setPaneState(paneId, profile.id);
    setTabsById(
      produce((draft) => {
        draft[tabId] = {
          id: tabId,
          root: { type: "leaf", paneId },
          activePaneId: paneId
        };
      })
    );
    setOpenTabIds((current) => [...current, tabId]);
    setActiveTabId(tabId);
    return { tabId, paneId };
  }

  function activateTab(tabId: string) {
    if (!tabsById[tabId]) return;
    setActiveTabId(tabId);
    fitPaneTerminal(tabsById[tabId].activePaneId);
  }

  function activatePane(tabId: string, paneId: string) {
    setActiveTabId(tabId);
    setTabState(tabId, (tab) => ({ ...tab, activePaneId: paneId }));
    fitPaneTerminal(paneId);
  }

  function closePaneInTab(tabId: string, paneId: string) {
    const tab = tabsById[tabId];
    if (!tab) return;
    const paneIds = collectPaneIds(tab.root);
    if (paneIds.length <= 1) {
      closeTab(tabId);
      return;
    }

    const nextRoot = removePaneFromLayout(tab.root, paneId);
    cleanupPaneResources(paneId);
    if (!nextRoot) {
      closeTab(tabId);
      return;
    }
    setTabState(tabId, (current) => ({
      ...current,
      root: nextRoot,
      activePaneId:
        current.activePaneId === paneId || !findPaneInLayout(nextRoot, current.activePaneId)
          ? getFirstPaneId(nextRoot)
          : current.activePaneId
    }));
    setPaneMenuState(null);
  }

  function closeTab(tabId: string) {
    const tab = tabsById[tabId];
    if (!tab) return;
    collectPaneIds(tab.root).forEach((paneId) => cleanupPaneResources(paneId));
    deleteTabState(tabId);
    const remainingIds = openTabIds().filter((id) => id !== tabId);
    setOpenTabIds(remainingIds);
    setPinnedTabIds((current) => current.filter((id) => id !== tabId));
    if (activeTabId() === tabId) {
      setActiveTabId(remainingIds.at(-1) ?? null);
    }
    setPaneMenuState(null);
    setProfileTabMenuState(null);
  }

  function togglePinnedTab(tabId: string) {
    setPinnedTabIds((current) =>
      current.includes(tabId)
        ? current.filter((id) => id !== tabId)
        : [tabId, ...current.filter((id) => id !== tabId)]
    );
    setProfileTabMenuState(null);
  }

  function closeOtherTabs(tabId: string) {
    const keepIds = openTabIds().filter((id) => id === tabId || pinnedTabIds().includes(id));
    openTabIds()
      .filter((id) => !keepIds.includes(id))
      .forEach((id) => closeTab(id));
    setOpenTabIds(keepIds);
    if (!keepIds.includes(activeTabId() ?? "")) {
      setActiveTabId(tabId);
    }
    setProfileTabMenuState(null);
  }

  function closeAllTabs() {
    const keepIds = pinnedTabIds().filter((id) => openTabIds().includes(id));
    openTabIds()
      .filter((id) => !keepIds.includes(id))
      .forEach((id) => closeTab(id));
    setOpenTabIds(keepIds);
    if (!keepIds.includes(activeTabId() ?? "")) {
      setActiveTabId(keepIds.at(-1) ?? null);
    }
    setProfileTabMenuState(null);
  }

  function closeTabsToDirection(tabId: string, direction: "left" | "right") {
    const currentIds = openTabIds();
    const index = currentIds.indexOf(tabId);
    if (index < 0) return;
    const keepIds = currentIds.filter((id, currentIndex) => {
      if (pinnedTabIds().includes(id) || id === tabId) {
        return true;
      }
      return direction === "left" ? currentIndex > index : currentIndex < index;
    });
    currentIds.filter((id) => !keepIds.includes(id)).forEach((id) => closeTab(id));
    setOpenTabIds(keepIds);
    if (!keepIds.includes(activeTabId() ?? "")) {
      setActiveTabId(tabId);
    }
    setProfileTabMenuState(null);
  }

  function handleTabDragOver(tabId: string, event: DragEvent) {
    event.preventDefault();
    const draggedId = draggedTabId();
    if (!draggedId || pinnedTabIds().includes(draggedId)) {
      return;
    }
    setTabDropTargetId(tabId);
  }

  function handleTabDrop(tabId: string, event: DragEvent) {
    event.preventDefault();
    const draggedId = draggedTabId();
    if (!draggedId || draggedId === tabId || pinnedTabIds().includes(draggedId)) {
      setDraggedTabId(null);
      setTabDropTargetId(null);
      return;
    }
    const currentIds = openTabIds();
    const fromIndex = currentIds.indexOf(draggedId);
    const toIndex = currentIds.indexOf(tabId);
    if (fromIndex < 0 || toIndex < 0) {
      setDraggedTabId(null);
      setTabDropTargetId(null);
      return;
    }
    const moved = arrayMove(currentIds, fromIndex, toIndex);
    const pinned = moved.filter((id) => pinnedTabIds().includes(id));
    const unpinned = moved.filter((id) => !pinnedTabIds().includes(id));
    setOpenTabIds([...pinned, ...unpinned]);
    setDraggedTabId(null);
    setTabDropTargetId(null);
  }

  function handleStripDrop(event: DragEvent) {
    event.preventDefault();
    const draggedId = draggedTabId();
    if (!draggedId || pinnedTabIds().includes(draggedId)) {
      setDraggedTabId(null);
      setTabDropTargetId(null);
      return;
    }
    const currentIds = openTabIds();
    const fromIndex = currentIds.indexOf(draggedId);
    if (fromIndex < 0) {
      setDraggedTabId(null);
      setTabDropTargetId(null);
      return;
    }
    const moved = arrayMove(currentIds, fromIndex, currentIds.length - 1);
    const pinned = moved.filter((id) => pinnedTabIds().includes(id));
    const unpinned = moved.filter((id) => !pinnedTabIds().includes(id));
    setOpenTabIds([...pinned, ...unpinned]);
    setDraggedTabId(null);
    setTabDropTargetId(null);
  }

  async function connectPaneToProfile(paneId: string, profile: SshProfile) {
    setPaneState(paneId, profile.id);
    setRelayErrorByPaneId(paneId, null);
    setSessionByPaneId(paneId, { status: "connecting" });

    const relayUrl = await buildSshRelayUrl();
    if (!relayUrl) {
      setRelayErrorByPaneId(paneId, "未配置 SSH Proxy，请先到 Settings → Proxy 填写地址。");
      setSessionByPaneId(paneId, { status: "error", message: "relay not configured" });
      return;
    }

    const mounted = await waitForPaneMount(paneId);
    if (!mounted) {
      setSessionByPaneId(paneId, { status: "error", message: "terminal element not ready" });
      setRelayErrorByPaneId(paneId, "终端挂载失败，请重试。");
      return;
    }

    const terminal = initTerminal(paneId);
    const fitAddon = fitAddons.get(paneId);
    if (!terminal || !fitAddon) {
      setSessionByPaneId(paneId, { status: "error", message: "terminal element not ready" });
      return;
    }

    disconnectPane(paneId, false);
    clearTerminal(paneId);
    fitPaneTerminal(paneId);

    const ws = new WebSocket(relayUrl);
    wsByPaneId.set(paneId, ws);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      const cols = fitAddon.proposeDimensions()?.cols ?? 120;
      const rows = fitAddon.proposeDimensions()?.rows ?? 32;

      const connectMsg: SshConnectPayload = {
        type: "connect",
        target: profile.target,
        cols,
        rows
      };

      if (profile.target === "remote") {
        connectMsg.host = profile.host;
        connectMsg.port = profile.port || 22;
        connectMsg.username = profile.username;
        if (profile.authMethod === "password") {
          connectMsg.password = profile.password ?? "";
        } else {
          connectMsg.privateKey = profile.privateKey ?? "";
          if (profile.passphrase) {
            connectMsg.passphrase = profile.passphrase;
          }
        }
      }

      ws.send(JSON.stringify(connectMsg));
    };

    ws.onmessage = (event) => {
      let data: unknown;
      if (typeof event.data === "string") {
        try {
          data = JSON.parse(event.data);
        } catch {
          terminal.write(event.data);
          return;
        }
      } else {
        terminal.write(new Uint8Array(event.data as ArrayBuffer));
        return;
      }

      if (typeof data === "object" && data !== null) {
        const msg = data as Record<string, unknown>;
        if (msg.type === "status" && msg.data === "connected") {
          setSessionByPaneId(paneId, { status: "connected" });
          termDataDisposers.get(paneId)?.dispose();
          const disposable = terminal.onData((input) => {
            const currentWs = wsByPaneId.get(paneId);
            if (currentWs?.readyState === WebSocket.OPEN) {
              currentWs.send(input);
            }
          });
          termDataDisposers.set(paneId, disposable);
          return;
        }
        if (msg.type === "error") {
          terminal.writeln(
            `\r\n\x1b[1;31mError: ${String(msg.data ?? msg.error ?? "unknown")}\x1b[0m`
          );
          setSessionByPaneId(paneId, {
            status: "error",
            message: String(msg.data ?? msg.error ?? "unknown")
          });
          return;
        }
        if (msg.type === "closed") {
          terminal.writeln(`\r\n\x1b[2;37mConnection closed.\x1b[0m`);
          setSessionByPaneId(paneId, { status: "disconnected" });
        }
      }
    };

    ws.onerror = () => {
      terminal.writeln(`\r\n\x1b[1;31mWebSocket error — check SSH proxy address and server.\x1b[0m`);
      setSessionByPaneId(paneId, { status: "error", message: "websocket error" });
    };

    ws.onclose = () => {
      const current = getPaneSession(paneId);
      if (current.status === "connected" || current.status === "connecting") {
        terminal.writeln(`\r\n\x1b[2;37mDisconnected.\x1b[0m`);
        setSessionByPaneId(paneId, { status: "disconnected" });
      }
      wsByPaneId.delete(paneId);
    };
  }

  async function connectToProfile(profile: SshProfile) {
    const { tabId, paneId } = createTabForProfile(profile);
    setActiveTabId(tabId);
    setTabState(tabId, (tab) => ({ ...tab, activePaneId: paneId }));
    await connectPaneToProfile(paneId, profile);
  }

  async function reconnectPaneToProfile(paneId: string, profile: SshProfile) {
    setConnectionSwitcherPaneId(null);
    await connectPaneToProfile(paneId, profile);
  }

  async function disconnectProfile(profileId: string) {
    Object.values(panesById)
      .filter((pane) => pane.profileId === profileId)
      .forEach((pane) => {
        disconnectPane(pane.id);
        writeTerminalNotice(pane.id, "Session terminated.");
      });
  }

  function splitActivePane(direction: "columns" | "rows") {
    const tab = activeTab();
    const pane = activePane();
    if (!tab || !pane) return;
    const newPaneId = newId();
    setPaneState(newPaneId, pane.profileId);
    setTabState(tab.id, (current) => ({
      ...current,
      root: splitLayoutAtPane(current.root, pane.id, direction, newPaneId),
      activePaneId: newPaneId
    }));
    const profile = profileMap().get(pane.profileId);
    if (profile) {
      queueMicrotask(() => {
        void connectPaneToProfile(newPaneId, profile);
      });
    }
    setPaneMenuState(null);
  }

  async function duplicatePane(tabId: string, paneId: string) {
    const tab = tabsById[tabId];
    const pane = panesById[paneId];
    if (!tab || !pane) return;

    const profile = profileMap().get(pane.profileId);
    if (!profile) return;

    const newPaneId = newId();
    setPaneState(newPaneId, profile.id);
    setTabState(tabId, (current) => ({
      ...current,
      root: splitLayoutAtPane(current.root, paneId, "columns", newPaneId),
      activePaneId: newPaneId
    }));
    setActiveTabId(tabId);
    setPaneMenuState(null);
    queueMicrotask(() => {
      void connectPaneToProfile(newPaneId, profile);
    });
  }

  async function movePaneToNewTab(tabId: string, paneId: string) {
    const tab = tabsById[tabId];
    const pane = panesById[paneId];
    if (!tab || !pane) return;

    const profile = profileMap().get(pane.profileId);
    if (!profile) return;

    setPaneMenuState(null);

    if (collectPaneIds(tab.root).length <= 1) {
      setActiveTabId(tabId);
      return;
    }

    closePaneInTab(tabId, paneId);
    await connectToProfile(profile);
  }

  function toggleFolderExpanded(folderId: string) {
    setExpandedFolderIds((current) =>
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId]
    );
  }

  function isFolderExpanded(folderId: string) {
    return expandedFolderIds().includes(folderId);
  }

  function openCreateModal(folderId: string | null = null) {
    setEditingProfile(emptyProfile(folderId));
  }

  function openEditModal(profile: SshProfile) {
    setEditingProfile({ ...profile });
  }

  function handleSelectProfile(profile: SshProfile) {
    const tabId = findOpenTabForProfile(profile.id);
    if (!tabId) return;
    const paneId = findPaneForProfileInTab(tabId, profile.id);
    if (paneId) {
      activatePane(tabId, paneId);
    } else {
      activateTab(tabId);
    }
  }

  async function handleSaveProfile() {
    const profile = editingProfile();
    if (!profile) return;

    const nextProfile: SshProfile = {
      ...profile,
      name: profile.name.trim(),
      folderId: profile.folderId ?? null,
      target: profile.target,
      port: profile.port || 22
    };

    if (!nextProfile.name) return;

    if (nextProfile.target === "remote") {
      if (!nextProfile.host?.trim() || !nextProfile.username?.trim()) return;
      if (nextProfile.authMethod === "password" && !nextProfile.password?.trim()) return;
      if (nextProfile.authMethod === "key" && !nextProfile.privateKey?.trim()) return;
    } else {
      nextProfile.host = "";
      nextProfile.username = "";
      nextProfile.password = "";
      nextProfile.privateKey = "";
      nextProfile.passphrase = "";
      nextProfile.authMethod = "password";
      nextProfile.port = 22;
    }

    const exists = workspace().profiles.some((item) => item.id === nextProfile.id);
    const next = exists ? await updateSshProfile(nextProfile) : await addSshProfile(nextProfile);
    setWorkspace(next);
    if (nextProfile.folderId) {
      setExpandedFolderIds((current) =>
        current.includes(nextProfile.folderId!) ? current : [...current, nextProfile.folderId!]
      );
    }
    setEditingProfile(null);
  }

  async function handleDeleteProfile(id: string) {
    Object.values(panesById)
      .filter((pane) => pane.profileId === id)
      .forEach((pane) => {
        const tabId = openTabIds().find((currentTabId) => {
          const tab = tabsById[currentTabId];
          return tab ? findPaneInLayout(tab.root, pane.id) : false;
        });
        if (tabId) {
          closePaneInTab(tabId, pane.id);
        }
      });

    const next = await deleteSshProfile(id);
    setWorkspace(next);
    setProfileMenuId(null);
    setProfileMoveMenuId(null);
  }

  async function handleAddFolder() {
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    const next = await addSshFolder({ id: newId(), name: name.trim() });
    setWorkspace(next);
    const created = next.folders[next.folders.length - 1];
    if (created) {
      setExpandedFolderIds((current) => [...current, created.id]);
    }
    setHeaderMenuOpen(false);
  }

  async function handleRenameFolder(folder: SshFolder) {
    const name = window.prompt("Rename folder", folder.name);
    if (!name?.trim()) return;
    const next = await updateSshFolder({ ...folder, name: name.trim() });
    setWorkspace(next);
    setFolderMenuId(null);
  }

  async function handleDeleteFolder(folderId: string) {
    const next = await deleteSshFolder(folderId);
    setWorkspace(next);
    setExpandedFolderIds((current) => current.filter((id) => id !== folderId));
    setFolderMenuId(null);
  }

  async function moveProfileToFolder(profile: SshProfile, folderId: string | null) {
    const next = await updateSshProfile({ ...profile, folderId });
    setWorkspace(next);
    setProfileMenuId(null);
    setProfileMoveMenuId(null);
    if (folderId) {
      setExpandedFolderIds((current) => (current.includes(folderId) ? current : [...current, folderId]));
    }
  }

  async function moveFolderDirection(folderId: string, direction: "up" | "down") {
    const current = workspace();
    const nextFolderIds = reorderByDirection(current.folders.map((folder) => folder.id), folderId, direction);
    const order = new Map(nextFolderIds.map((id, index) => [id, index]));
    const next = {
      ...current,
      folders: current.folders.slice().sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    };
    await saveSshWorkspace(next);
    setWorkspace(next);
    setFolderMenuId(null);
  }

  async function moveProfileDirection(profile: SshProfile, direction: "up" | "down") {
    const current = workspace();
    const siblingFolderId = profile.folderId ?? null;
    const siblingIds = current.profiles
      .filter((item) => (item.folderId ?? null) === siblingFolderId)
      .map((item) => item.id);
    const nextSiblingIds = reorderByDirection(siblingIds, profile.id, direction);
    const siblingOrder = new Map(nextSiblingIds.map((id, index) => [id, index]));
    const originalOrder = new Map(current.profiles.map((item, index) => [item.id, index]));
    const next = {
      ...current,
      profiles: current.profiles.slice().sort((a, b) => {
        const aMatches = (a.folderId ?? null) === siblingFolderId;
        const bMatches = (b.folderId ?? null) === siblingFolderId;
        if (aMatches && bMatches) {
          return (siblingOrder.get(a.id) ?? 0) - (siblingOrder.get(b.id) ?? 0);
        }
        return (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0);
      })
    };
    await saveSshWorkspace(next);
    setWorkspace(next);
    setProfileMenuId(null);
    setProfileMoveMenuId(null);
  }

  function startResizeSplit(
    tabId: string,
    splitId: string,
    direction: "columns" | "rows",
    bounds: Pick<SplitHandleRect, "containerLeft" | "containerTop" | "containerWidth" | "containerHeight">,
    event: PointerEvent
  ) {
    event.preventDefault();
    event.stopPropagation();

    const divider = event.currentTarget as HTMLElement | null;
    const rootRect = divider?.parentElement?.getBoundingClientRect();
    if (!rootRect) return;

    const updateRatio = (clientX: number, clientY: number) => {
      const containerLeft = rootRect.left + (rootRect.width * bounds.containerLeft) / 100;
      const containerTop = rootRect.top + (rootRect.height * bounds.containerTop) / 100;
      const containerWidth = (rootRect.width * bounds.containerWidth) / 100;
      const containerHeight = (rootRect.height * bounds.containerHeight) / 100;
      const rawRatio =
        direction === "columns"
          ? (clientX - containerLeft) / Math.max(containerWidth, 1)
          : (clientY - containerTop) / Math.max(containerHeight, 1);
      const ratio = Math.max(0.18, Math.min(0.82, rawRatio));
      setTabState(tabId, (current) => ({
        ...current,
        root: updateSplitRatioInLayout(current.root, splitId, ratio)
      }));
    };

    const handleMove = (moveEvent: PointerEvent) => {
      updateRatio(moveEvent.clientX, moveEvent.clientY);
    };

    const handleUp = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      const tab = tabsById[tabId];
      if (tab) {
        collectPaneIds(tab.root).forEach((paneId) => fitPaneTerminal(paneId));
      }
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
  }

  function renderPaneLeaf(tabId: string, paneId: string) {
    return (
      <div
        class={`relative h-full min-h-0 overflow-hidden ${
          tabsById[tabId].activePaneId === paneId ? "ring-1 ring-white/12" : ""
        }`}
        onClick={() => activatePane(tabId, paneId)}
        onContextMenu={(event) => {
          event.preventDefault();
          activatePane(tabId, paneId);
          setPaneMenuState({
            tabId,
            paneId,
            x: event.clientX,
            y: event.clientY
          });
          setConnectionSwitcherPaneId(null);
          setProfileTabMenuState(null);
        }}
      >
        <Show when={openConnectionProfiles().length > 0}>
          <div class="absolute right-2 top-2 z-20" data-ssh-menu-root>
            <button
              class="theme-control inline-flex h-7 max-w-[220px] items-center gap-2 rounded-lg px-2.5 text-xs font-medium shadow-[0_8px_20px_rgba(15,23,42,0.14)]"
              onClick={() => {
                activatePane(tabId, paneId);
                setConnectionSwitcherPaneId((current) => (current === paneId ? null : paneId));
                setProfileTabMenuState(null);
                setPaneMenuState(null);
              }}
            >
              <span
                class={`inline-block h-2 w-2 shrink-0 rounded-full ${getProfileStatusDotClass(
                  getPaneSession(paneId).status
                )}`}
              />
              <span class="truncate">{getPaneConnectionLabel(paneId)}</span>
              <span class="theme-text-soft text-[10px]">▾</span>
            </button>
            <Show when={connectionSwitcherPaneId() === paneId}>
              <div
                class="theme-panel-soft theme-menu-popover absolute right-0 top-8 z-30 min-w-[220px] border p-1"
                data-ssh-menu-root
                style={{ "border-color": "var(--app-border)" }}
              >
                <For each={openConnectionProfiles()}>
                  {(profile) => (
                    <button
                      class={`theme-sidebar-item flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm ${
                        panesById[paneId]?.profileId === profile.id ? "theme-sidebar-item-active" : ""
                      }`}
                      onClick={() => void reconnectPaneToProfile(paneId, profile)}
                    >
                      <span
                        class={`inline-block h-2 w-2 shrink-0 rounded-full ${getProfileStatusDotClass(
                          getProfileAggregateStatus(profile.id)
                        )}`}
                      />
                      <span class="min-w-0 flex-1 truncate">{profile.name}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
        <div
          class="absolute inset-0 min-h-0 overflow-hidden"
          ref={(el) => {
            termViewportRefs.set(paneId, el);
          }}
        >
          <div
            class="absolute inset-0 min-h-0 overflow-hidden"
            ref={(el) => {
              termMountRefs.set(paneId, el);
            }}
          />
        </div>
      </div>
    );
  }

  function getTabLayout(tabId: string) {
    const tab = tabsById[tabId];
    const paneRects = new Map<string, PaneRect>();
    const splitRects = new Map<string, SplitHandleRect>();
    if (!tab) {
      return { paneRects, splitRects, paneIds: [] as string[], splitIds: [] as string[] };
    }
    computeLayoutRects(tab.root, 0, 0, 100, 100, paneRects, splitRects);
    return {
      paneRects,
      splitRects,
      paneIds: collectPaneIds(tab.root),
      splitIds: Array.from(splitRects.keys())
    };
  }

  return (
    <>
      <WorkspaceSidebarLayout
        sidebarOpen={props.sidebarOpen}
        sidebarWidth={props.sidebarWidth}
        sidebarResizing={props.sidebarResizing}
        onResizeStart={props.onSidebarResizeStart}
        contentClass="theme-workspace-pane min-h-0 flex flex-col border-l"
        contentStyle={{ "border-color": "var(--app-border)" }}
        sidebar={
          <>
            <div
              class="mb-4 flex items-center justify-between border-b pb-3"
              style={{ "border-color": "var(--app-border)" }}
            >
              <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.24em]">Profiles</p>
              <div class="flex items-center gap-1">
                <div class="relative" data-ssh-menu-root>
                  <button
                    class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                    title="Profile options"
                    onClick={() => {
                      setHeaderMenuOpen((current) => !current);
                      setFolderMenuId(null);
                      setProfileMenuId(null);
                      setProfileMoveMenuId(null);
                    }}
                  >
                    <ControlDot variant="menu" />
                  </button>
                  <Show when={headerMenuOpen()}>
                    <div
                      class="theme-panel-soft theme-menu-popover absolute right-0 top-6 z-20 min-w-[148px] border p-1"
                      data-ssh-menu-root
                      style={{ "border-color": "var(--app-border)" }}
                    >
                      <button
                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                        onClick={() => void handleAddFolder()}
                      >
                        Add Folder
                      </button>
                    </div>
                  </Show>
                </div>
                <button
                  class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                  title="Add profile"
                  onClick={() => openCreateModal(null)}
                >
                  <ControlDot variant="add" />
                </button>
              </div>
            </div>

            <div class="grid gap-0.5">
              <For each={rootProfiles()}>
                {(profile) => (
                  <div
                    class={`theme-sidebar-item group flex min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                      activePaneProfile()?.id === profile.id ? "theme-sidebar-item-active" : ""
                    }`}
                    onClick={() => handleSelectProfile(profile)}
                    onDblClick={() => void connectToProfile(profile)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setProfileMenuId(profile.id);
                      setProfileMoveMenuId(null);
                      setHeaderMenuOpen(false);
                      setFolderMenuId(null);
                    }}
                  >
                    <span
                      class={`inline-block h-2 w-2 shrink-0 rounded-full ${getProfileStatusDotClass(
                        getProfileAggregateStatus(profile.id)
                      )}`}
                    />
                    <button class="min-w-0 flex-1 text-left" onClick={() => handleSelectProfile(profile)}>
                      <p class="truncate text-[13px] font-medium" title={profile.name}>{profile.name}</p>
                    </button>
                    <div
                      class={`relative shrink-0 transition-opacity ${
                        profileMenuId() === profile.id
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      }`}
                      data-ssh-menu-root
                    >
                      <Show
                        when={getProfileHoverAction(profile.id) === "disconnect"}
                        fallback={
                          <button
                            class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                            title="Connect"
                            onClick={(event) => {
                              event.stopPropagation();
                              void connectToProfile(profile);
                            }}
                          >
                            <ControlDot variant="warn" />
                          </button>
                        }
                      >
                        <button
                          class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                          title="Disconnect"
                          onClick={(event) => {
                            event.stopPropagation();
                            void disconnectProfile(profile.id);
                          }}
                        >
                          <ControlDot variant="delete" />
                        </button>
                      </Show>
                      <Show when={profileMenuId() === profile.id}>
                        <div
                          class="theme-panel-soft theme-menu-popover absolute right-0 top-7 z-20 min-w-[172px] border p-1"
                          data-ssh-menu-root
                          style={{ "border-color": "var(--app-border)" }}
                        >
                          <button
                            class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                            onClick={() => {
                              void connectToProfile(profile);
                              setProfileMenuId(null);
                              setProfileMoveMenuId(null);
                            }}
                          >
                            Connect
                          </button>
                          <button
                            class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                            onClick={() => openEditModal(profile)}
                          >
                            Edit
                          </button>
                          <button
                            class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                            onClick={() => void moveProfileDirection(profile, "up")}
                          >
                            Move Up
                          </button>
                          <button
                            class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                            onClick={() => void moveProfileDirection(profile, "down")}
                          >
                            Move Down
                          </button>
                          <div class="relative" data-ssh-menu-root>
                            <button
                              class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                setProfileMoveMenuId((current) => (current === profile.id ? null : profile.id));
                              }}
                            >
                              <span>Move to</span>
                              <span class="theme-text-soft text-[10px]">›</span>
                            </button>
                            <Show when={profileMoveMenuId() === profile.id}>
                              <div
                                class="theme-panel-soft theme-menu-popover absolute left-full top-0 ml-1 min-w-[160px] border p-1"
                                data-ssh-menu-root
                                style={{ "border-color": "var(--app-border)" }}
                              >
                                <button
                                  class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                  onClick={() => void moveProfileToFolder(profile, null)}
                                >
                                  Root
                                </button>
                                <For each={workspace().folders}>
                                  {(folder) => (
                                    <button
                                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                      onClick={() => void moveProfileToFolder(profile, folder.id)}
                                    >
                                      {folder.name}
                                    </button>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                          <button
                            class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]"
                            onClick={() => void handleDeleteProfile(profile.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </Show>
                    </div>
                  </div>
                )}
              </For>

              <For each={folderEntries()}>
                {(entry) => (
                  <div class="grid gap-1">
                    <div
                      class="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5"
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setFolderMenuId(entry.folder.id);
                        setHeaderMenuOpen(false);
                        setProfileMenuId(null);
                        setProfileMoveMenuId(null);
                      }}
                    >
                      <button
                        class="-ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-md text-[11px]"
                        title={isFolderExpanded(entry.folder.id) ? "Collapse" : "Expand"}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleFolderExpanded(entry.folder.id);
                        }}
                      >
                        <svg
                          class={`h-3 w-3 transition-transform ${isFolderExpanded(entry.folder.id) ? "rotate-90" : ""}`}
                          viewBox="0 0 16 16"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden="true"
                        >
                          <path
                            d="M6 4.5L9.5 8L6 11.5"
                            stroke="currentColor"
                            stroke-width="1.6"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          />
                        </svg>
                      </button>
                      <button
                        class="min-w-0 flex-1 text-left"
                        title={entry.folder.name}
                        onClick={() => toggleFolderExpanded(entry.folder.id)}
                      >
                        <div class="inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle">
                          <p class="max-w-full truncate text-[13px] font-medium">{entry.folder.name}</p>
                          <span class="theme-chip shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
                            {entry.profiles.length}
                          </span>
                        </div>
                      </button>
                      <div
                        class={`relative shrink-0 transition-opacity ${
                          folderMenuId() === entry.folder.id
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                        }`}
                        data-ssh-menu-root
                      >
                        <button
                          class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                          title="Folder options"
                          onClick={(event) => {
                            event.stopPropagation();
                            setFolderMenuId((current) => (current === entry.folder.id ? null : entry.folder.id));
                            setHeaderMenuOpen(false);
                            setProfileMenuId(null);
                            setProfileMoveMenuId(null);
                          }}
                        >
                          <ControlDot variant="menu" />
                        </button>
                        <Show when={folderMenuId() === entry.folder.id}>
                          <div
                            class="theme-panel-soft theme-menu-popover absolute right-0 top-7 z-20 min-w-[160px] border p-1"
                            data-ssh-menu-root
                            style={{ "border-color": "var(--app-border)" }}
                          >
                            <button
                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                              onClick={() => void handleRenameFolder(entry.folder)}
                            >
                              Rename
                            </button>
                            <button
                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                              onClick={() => void moveFolderDirection(entry.folder.id, "up")}
                            >
                              Move Up
                            </button>
                            <button
                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                              onClick={() => void moveFolderDirection(entry.folder.id, "down")}
                            >
                              Move Down
                            </button>
                            <button
                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]"
                              onClick={() => void handleDeleteFolder(entry.folder.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </Show>
                      </div>
                      <div
                        class={`shrink-0 transition-opacity ${
                          folderMenuId() === entry.folder.id
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                        }`}
                      >
                        <button
                          class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                          title="Add profile"
                          onClick={() => openCreateModal(entry.folder.id)}
                        >
                          <ControlDot variant="add" />
                        </button>
                      </div>
                    </div>

                    <Show when={isFolderExpanded(entry.folder.id)}>
                      <div class="grid gap-0.5">
                        <For each={entry.profiles}>
                          {(profile) => (
                            <div
                              class={`theme-sidebar-item group flex min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                                activePaneProfile()?.id === profile.id ? "theme-sidebar-item-active" : ""
                              }`}
                              onClick={() => handleSelectProfile(profile)}
                              onDblClick={() => void connectToProfile(profile)}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                setProfileMenuId(profile.id);
                                setProfileMoveMenuId(null);
                                setHeaderMenuOpen(false);
                                setFolderMenuId(null);
                              }}
                            >
                              <span
                                class={`inline-block h-2 w-2 shrink-0 rounded-full ${getProfileStatusDotClass(
                                  getProfileAggregateStatus(profile.id)
                                )}`}
                              />
                              <button class="min-w-0 flex-1 text-left" onClick={() => handleSelectProfile(profile)}>
                                <p class="truncate text-[13px] font-medium" title={profile.name}>{profile.name}</p>
                              </button>
                              <div
                                class={`relative shrink-0 transition-opacity ${
                                  profileMenuId() === profile.id
                                    ? "opacity-100"
                                    : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                                }`}
                                data-ssh-menu-root
                              >
                                <Show
                                  when={getProfileHoverAction(profile.id) === "disconnect"}
                                  fallback={
                                    <button
                                      class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                                      title="Connect"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void connectToProfile(profile);
                                      }}
                                    >
                                      <ControlDot variant="warn" />
                                    </button>
                                  }
                                >
                                  <button
                                    class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                                    title="Disconnect"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void disconnectProfile(profile.id);
                                    }}
                                  >
                                    <ControlDot variant="delete" />
                                  </button>
                                </Show>
                                <Show when={profileMenuId() === profile.id}>
                                  <div
                                    class="theme-panel-soft theme-menu-popover absolute right-0 top-7 z-20 min-w-[172px] border p-1"
                                    data-ssh-menu-root
                                    style={{ "border-color": "var(--app-border)" }}
                                  >
                                    <button
                                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                      onClick={() => {
                                        void connectToProfile(profile);
                                        setProfileMenuId(null);
                                        setProfileMoveMenuId(null);
                                      }}
                                    >
                                      Connect
                                    </button>
                                    <button
                                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                      onClick={() => openEditModal(profile)}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                      onClick={() => void moveProfileDirection(profile, "up")}
                                    >
                                      Move Up
                                    </button>
                                    <button
                                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                      onClick={() => void moveProfileDirection(profile, "down")}
                                    >
                                      Move Down
                                    </button>
                                    <div class="relative" data-ssh-menu-root>
                                      <button
                                        class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setProfileMoveMenuId((current) => (current === profile.id ? null : profile.id));
                                        }}
                                      >
                                        <span>Move to</span>
                                        <span class="theme-text-soft text-[10px]">›</span>
                                      </button>
                                      <Show when={profileMoveMenuId() === profile.id}>
                                        <div
                                          class="theme-panel-soft theme-menu-popover absolute left-full top-0 ml-1 min-w-[160px] border p-1"
                                          data-ssh-menu-root
                                          style={{ "border-color": "var(--app-border)" }}
                                        >
                                          <button
                                            class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                            onClick={() => void moveProfileToFolder(profile, null)}
                                          >
                                            Root
                                          </button>
                                          <For each={workspace().folders}>
                                            {(folder) => (
                                              <button
                                                class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                onClick={() => void moveProfileToFolder(profile, folder.id)}
                                              >
                                                {folder.name}
                                              </button>
                                            )}
                                          </For>
                                        </div>
                                      </Show>
                                    </div>
                                    <button
                                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]"
                                      onClick={() => void handleDeleteProfile(profile.id)}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </Show>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </>
        }
      >
        <div class="flex min-h-0 flex-1 flex-col">
          <Show when={tabItems().length > 0} fallback={<div class="flex-1 min-h-0" />}>
            <div class="border-b" style={{ "border-color": "var(--app-border)" }}>
              <RequestTabsBar
                items={tabItems()}
                draggedId={draggedTabId()}
                dropTargetId={tabDropTargetId()}
                renderCloseIcon={() => <ControlDot variant="delete" />}
                renderPinIcon={() => <PinIcon />}
                onTabOpen={(tabId) => activateTab(tabId)}
                onTabClose={(tabId) => closeTab(tabId)}
                onTabContextMenu={(tabId, event) => {
                  setProfileTabMenuState({
                    id: tabId,
                    x: event.clientX,
                    y: event.clientY
                  });
                }}
                onDragStart={(tabId, event) => {
                  setDraggedTabId(tabId);
                  event.dataTransfer?.setData("text/plain", tabId);
                  if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = "move";
                  }
                }}
                onDragEnd={() => {
                  setDraggedTabId(null);
                  setTabDropTargetId(null);
                }}
                onTabDragOver={(tabId, event) => handleTabDragOver(tabId, event)}
                onTabDrop={(tabId, event) => handleTabDrop(tabId, event)}
                onStripDragOver={(event) => event.preventDefault()}
                onStripDrop={(event) => handleStripDrop(event)}
              />
            </div>

            <Show when={activeRelayError()}>
              <div
                class="border-b px-3 py-2 text-sm text-[#ff5f57]"
                style={{ "border-color": "var(--app-border)" }}
              >
                {activeRelayError()}
              </div>
            </Show>

            <div class="relative flex-1 min-h-0 overflow-hidden">
              <For each={openTabIds().filter((tabId) => Boolean(tabsById[tabId]))}>
                {(tabId) => {
                  const layout = createMemo(() => getTabLayout(tabId));
                  return (
                    <div
                      class={`absolute inset-0 ${activeTabId() === tabId ? "block" : "hidden"}`}
                      style={{ "border-color": "var(--app-border)" }}
                    >
                      <For each={layout().paneIds}>
                        {(paneId) => {
                          const rect = () => layout().paneRects.get(paneId);
                          return (
                            <div
                              class="absolute"
                              style={{
                                left: `${rect()?.left ?? 0}%`,
                                top: `${rect()?.top ?? 0}%`,
                                width: `${rect()?.width ?? 100}%`,
                                height: `${rect()?.height ?? 100}%`
                              }}
                            >
                              {renderPaneLeaf(tabId, paneId)}
                            </div>
                          );
                        }}
                      </For>
                      <For each={layout().splitIds}>
                        {(splitId) => {
                          const rect = () => layout().splitRects.get(splitId);
                          return (
                            <button
                              class={`absolute z-10 bg-transparent p-0 ${
                                rect()?.direction === "columns"
                                  ? "w-[9px] -ml-[4px] cursor-col-resize"
                                  : "h-[9px] -mt-[4px] cursor-row-resize"
                              }`}
                              style={{
                                left: `${rect()?.left ?? 0}%`,
                                top: `${rect()?.top ?? 0}%`,
                                width: rect()?.direction === "columns" ? "9px" : `${rect()?.width ?? 100}%`,
                                height: rect()?.direction === "columns" ? `${rect()?.height ?? 100}%` : "9px"
                              }}
                              title={rect()?.direction === "columns" ? "Resize columns" : "Resize rows"}
                              onPointerDown={(event) =>
                                startResizeSplit(
                                  tabId,
                                  splitId,
                                  rect()?.direction === "rows" ? "rows" : "columns",
                                  {
                                    containerLeft: rect()?.containerLeft ?? 0,
                                    containerTop: rect()?.containerTop ?? 0,
                                    containerWidth: rect()?.containerWidth ?? 100,
                                    containerHeight: rect()?.containerHeight ?? 100
                                  },
                                  event
                                )}
                            >
                              <span
                                class={`absolute rounded-full bg-[var(--app-border)] ${
                                  rect()?.direction === "columns"
                                    ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
                                    : "inset-x-0 top-1/2 h-px -translate-y-1/2"
                                }`}
                              />
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </WorkspaceSidebarLayout>

      <Show when={profileTabMenuState() && currentTabMenuTab()}>
        <div
          class="theme-panel-soft fixed z-[400] inline-grid auto-cols-max overflow-hidden rounded-[18px] border p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
          data-ssh-menu-root
          style={{
            "border-color": "var(--app-border)",
            left: `${profileTabMenuState()!.x}px`,
            top: `${profileTabMenuState()!.y}px`
          }}
        >
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => togglePinnedTab(currentTabMenuTab()!.id)}
          >
            {pinnedTabIds().includes(currentTabMenuTab()!.id) ? "UnPin" : "Pin"}
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => closeOtherTabs(currentTabMenuTab()!.id)}
          >
            Close Others
          </button>
          <button class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm" onClick={closeAllTabs}>
            Close All
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => closeTabsToDirection(currentTabMenuTab()!.id, "right")}
          >
            Close Right
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => closeTabsToDirection(currentTabMenuTab()!.id, "left")}
          >
            Close Left
          </button>
        </div>
      </Show>

      <Show when={paneMenuState() && paneContext()?.tab && paneContext()?.pane}>
        <div
          class="theme-panel-soft fixed z-[410] inline-grid auto-cols-max overflow-hidden rounded-[18px] border p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
          data-ssh-menu-root
          style={{
            "border-color": "var(--app-border)",
            left: `${paneMenuState()!.x}px`,
            top: `${paneMenuState()!.y}px`
          }}
        >
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => splitActivePane("columns")}
          >
            Split Right
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => splitActivePane("rows")}
          >
            Split Down
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => void duplicatePane(paneContext()!.tab!.id, paneContext()!.pane!.id)}
          >
            Duplicate Pane
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => void movePaneToNewTab(paneContext()!.tab!.id, paneContext()!.pane!.id)}
          >
            Move to New Tab
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => closePaneInTab(paneContext()!.tab!.id, paneContext()!.pane!.id)}
          >
            Close Pane
          </button>
        </div>
      </Show>

      <Show when={editingProfile()}>
        {(editing) => (
          <div class="fixed inset-0 z-[180]">
            <div class="absolute inset-0 bg-black/28 backdrop-blur-[6px]" onClick={() => setEditingProfile(null)} />
            <div class="absolute inset-0 flex items-center justify-center p-6">
              <form
                class="theme-panel-strong theme-menu-popover relative z-[181] w-full max-w-xl rounded-[24px] p-5"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSaveProfile();
                }}
              >
                <div class="mb-4 flex items-center justify-between">
                  <div>
                    <p class="theme-text text-base font-semibold">SSH Profile</p>
                    <p class="theme-text-soft mt-1 text-sm">
                      {editing().target === "local"
                        ? "本地 shell 会通过 SSH proxy 建立 PTY 会话。"
                        : "远程连接会通过 SSH proxy 代理到目标主机。"}
                    </p>
                  </div>
                  <button
                    class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                    title="Close"
                    type="button"
                    onClick={() => setEditingProfile(null)}
                  >
                    <ControlDot variant="delete" />
                  </button>
                </div>

                <div class="grid gap-3">
                  <label class="grid gap-1">
                    <span class="theme-text-soft text-xs">Folder</span>
                    <select
                      class="theme-input h-8 rounded-md px-2.5 text-sm"
                      value={editing().folderId ?? ""}
                      onChange={(event) =>
                        setEditingProfile((current) =>
                          current
                            ? {
                                ...current,
                                folderId: event.currentTarget.value || null
                              }
                            : current
                        )
                      }
                    >
                      <option value="">Root</option>
                      <For each={workspace().folders}>
                        {(folder) => <option value={folder.id}>{folder.name}</option>}
                      </For>
                    </select>
                  </label>

                  <label class="grid gap-1">
                    <span class="theme-text-soft text-xs">Name</span>
                    <input
                      class="theme-input h-8 rounded-md px-2.5 text-sm"
                      placeholder="My SSH"
                      value={editing().name}
                      onInput={(event) =>
                        setEditingProfile((current) =>
                          current ? { ...current, name: event.currentTarget.value } : current
                        )
                      }
                    />
                  </label>

                  <label class="grid gap-1">
                    <span class="theme-text-soft text-xs">Type</span>
                    <select
                      class="theme-input h-8 rounded-md px-2.5 text-sm"
                      value={editing().target}
                      onChange={(event) =>
                        setEditingProfile((current) =>
                          current
                            ? {
                                ...current,
                                target: event.currentTarget.value as "local" | "remote"
                              }
                            : current
                        )
                      }
                    >
                      <option value="local">Local</option>
                      <option value="remote">Remote</option>
                    </select>
                  </label>

                  <Show when={editing().target === "remote"}>
                    <div class="grid gap-3 md:grid-cols-2">
                      <label class="grid gap-1">
                        <span class="theme-text-soft text-xs">Host</span>
                        <input
                          class="theme-input h-8 rounded-md px-2.5 text-sm"
                          placeholder="127.0.0.1"
                          value={editing().host ?? ""}
                          onInput={(event) =>
                            setEditingProfile((current) =>
                              current ? { ...current, host: event.currentTarget.value } : current
                            )
                          }
                        />
                      </label>
                      <label class="grid gap-1">
                        <span class="theme-text-soft text-xs">Port</span>
                        <input
                          class="theme-input h-8 rounded-md px-2.5 text-sm"
                          type="number"
                          placeholder="22"
                          value={String(editing().port ?? 22)}
                          onInput={(event) =>
                            setEditingProfile((current) =>
                              current
                                ? {
                                    ...current,
                                    port: Number.parseInt(event.currentTarget.value, 10) || 22
                                  }
                                : current
                            )
                          }
                        />
                      </label>
                      <label class="grid gap-1">
                        <span class="theme-text-soft text-xs">User</span>
                        <input
                          class="theme-input h-8 rounded-md px-2.5 text-sm"
                          placeholder="root"
                          value={editing().username ?? ""}
                          onInput={(event) =>
                            setEditingProfile((current) =>
                              current ? { ...current, username: event.currentTarget.value } : current
                            )
                          }
                        />
                      </label>
                      <label class="grid gap-1">
                        <span class="theme-text-soft text-xs">Auth Method</span>
                        <select
                          class="theme-input h-8 rounded-md px-2.5 text-sm"
                          value={editing().authMethod ?? "password"}
                          onChange={(event) =>
                            setEditingProfile((current) =>
                              current
                                ? {
                                    ...current,
                                    authMethod: event.currentTarget.value as "password" | "key"
                                  }
                                : current
                            )
                          }
                        >
                          <option value="password">Password</option>
                          <option value="key">Private Key</option>
                        </select>
                      </label>
                    </div>

                    <Show
                      when={(editing().authMethod ?? "password") === "password"}
                      fallback={
                        <>
                          <label class="grid gap-1">
                            <span class="theme-text-soft text-xs">Private Key</span>
                            <textarea
                              class="theme-input min-h-[160px] rounded-[18px] px-3 py-2 text-sm"
                              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                              value={editing().privateKey ?? ""}
                              onInput={(event) =>
                                setEditingProfile((current) =>
                                  current ? { ...current, privateKey: event.currentTarget.value } : current
                                )
                              }
                            />
                          </label>
                          <label class="grid gap-1">
                            <span class="theme-text-soft text-xs">Passphrase</span>
                            <input
                              class="theme-input h-8 rounded-md px-2.5 text-sm"
                              type="password"
                              placeholder="Optional"
                              value={editing().passphrase ?? ""}
                              onInput={(event) =>
                                setEditingProfile((current) =>
                                  current ? { ...current, passphrase: event.currentTarget.value } : current
                                )
                              }
                            />
                          </label>
                        </>
                      }
                    >
                      <label class="grid gap-1">
                        <span class="theme-text-soft text-xs">Password</span>
                        <input
                          class="theme-input h-8 rounded-md px-2.5 text-sm"
                          type="password"
                          placeholder="••••••••"
                          value={editing().password ?? ""}
                          onInput={(event) =>
                            setEditingProfile((current) =>
                              current ? { ...current, password: event.currentTarget.value } : current
                            )
                          }
                        />
                      </label>
                    </Show>
                  </Show>
                </div>

                <div class="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    class="theme-control rounded-xl px-3 py-1.5 text-sm"
                    onClick={() => setEditingProfile(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" class="theme-control rounded-xl px-3 py-1.5 text-sm font-semibold">
                    Save Profile
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </Show>
    </>
  );
}
