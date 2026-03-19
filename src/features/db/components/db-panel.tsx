import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { createStore } from "solid-js/store";
import { TabsBar } from "../../../components/tabs-bar";
import { ControlDot, PinIcon } from "../../../components/ui-primitives";
import { WorkspaceSidebarLayout } from "../../../components/workspace-sidebar-layout";
import { arrayMove, cloneValue, reorderByDirection } from "../../../lib/utils";
import type {
  DbConnection,
  DbConnectionConfig,
  DbConnectionKind,
  DbExecutionState,
  DbFavoriteQuery,
  DbFolder,
  DbQueryHistoryItem,
  DbResultPayload,
  DbTab,
  DbWorkspaceState,
} from "../models";
import {
  buildDbConnectionUrl,
  createDbFavorite,
  createDbConnection,
  createDbFolder,
  createDbHistoryItem,
  createDbTab,
  executeDbTab,
  loadDbWorkspace,
  saveDbWorkspace,
} from "../service";

type DbPanelProps = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarResizing: boolean;
  onSidebarResizeStart: (event: MouseEvent) => void;
};

type DbTabMenuState = {
  id: string;
  x: number;
  y: number;
};

type ConnectionMenuState = {
  id: string;
  x: number;
  y: number;
};

type FolderMenuState = {
  id: string;
  x: number;
  y: number;
};

type DbSidebarView = "connections" | "favorites" | "history";
type DbConnectionModalMode = "create" | "edit";

function getConnectionBadge(connection: DbConnection) {
  switch (connection.kind) {
    case "redis":
      return {
        label: "RED",
        class: "theme-method-badge theme-method-patch",
      };
    case "postgresql":
      return {
        label: "PG",
        class: "theme-method-badge theme-method-post",
      };
    case "mysql":
      return {
        label: "SQL",
        class: "theme-method-badge theme-method-get",
      };
    case "mongodb":
      return {
        label: "MGO",
        class: "theme-method-badge theme-method-trace",
      };
    case "clickhouse":
      return {
        label: "CHK",
        class: "theme-method-badge theme-method-head",
      };
    case "gaussdb":
      return {
        label: "GDB",
        class: "theme-method-badge theme-method-patch",
      };
    case "oracle":
      return {
        label: "ORA",
        class: "theme-method-badge theme-method-delete",
      };
    case "sqlite":
      return {
        label: "LITE",
        class: "theme-method-badge theme-method-default",
      };
    case "sqlserver":
      return {
        label: "MSS",
        class: "theme-method-badge theme-method-post",
      };
    case "tidb":
      return {
        label: "TIDB",
        class: "theme-method-badge theme-method-get",
      };
    default:
      return {
        label: "DB",
        class: "theme-method-badge theme-method-default",
      };
  }
}

function getConnectionTypeLabel(kind: DbConnectionKind) {
  switch (kind) {
    case "redis":
      return "Redis";
    case "postgresql":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "mongodb":
      return "MongoDB";
    case "clickhouse":
      return "ClickHouse";
    case "gaussdb":
      return "GaussDB";
    case "oracle":
      return "Oracle";
    case "sqlite":
      return "SQLite";
    case "sqlserver":
      return "SQL Server";
    case "tidb":
      return "TiDB";
    default:
      return "Database";
  }
}

const databaseKinds: DbConnectionKind[] = [
  "redis",
  "postgresql",
  "mysql",
  "mongodb",
  "clickhouse",
  "gaussdb",
  "oracle",
  "sqlite",
  "sqlserver",
  "tidb",
];

function formatResultSize(value: unknown) {
  try {
    return new Blob([JSON.stringify(value ?? null)]).size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DbPanel(props: DbPanelProps) {
  const [workspace, setWorkspace] = createSignal<DbWorkspaceState>({
    folders: [],
    connections: [],
    openTabIds: [],
    pinnedTabIds: [],
    activeTabId: null,
    tabsById: {},
    favorites: [],
    history: [],
  });
  const [sidebarView, setSidebarView] =
    createSignal<DbSidebarView>("connections");
  const [expandedFolderIds, setExpandedFolderIds] = createSignal<string[]>([]);
  const [filter, setFilter] = createSignal("");
  const [headerMenuOpen, setHeaderMenuOpen] = createSignal(false);
  const [addConnectionMenuOpen, setAddConnectionMenuOpen] = createSignal(false);
  const [folderMenu, setFolderMenu] = createSignal<FolderMenuState | null>(
    null,
  );
  const [folderAddMenuId, setFolderAddMenuId] = createSignal<string | null>(
    null,
  );
  const [connectionMenu, setConnectionMenu] =
    createSignal<ConnectionMenuState | null>(null);
  const [connectionMoveMenuId, setConnectionMoveMenuId] = createSignal<
    string | null
  >(null);
  const [tabMenu, setTabMenu] = createSignal<DbTabMenuState | null>(null);
  const [draggedTabId, setDraggedTabId] = createSignal<string | null>(null);
  const [tabDropTargetId, setTabDropTargetId] = createSignal<string | null>(
    null,
  );
  const [resultByTabId, setResultByTabId] = createSignal<
    Record<string, DbResultPayload>
  >({});
  const [rawByTabId, setRawByTabId] = createSignal<Record<string, string>>({});
  const [executionByTabId, setExecutionByTabId] = createSignal<
    Record<string, DbExecutionState>
  >({});
  const [resultViewByTabId, setResultViewByTabId] = createSignal<
    Record<string, "table" | "raw">
  >({});
  const [connectionModalMode, setConnectionModalMode] =
    createSignal<DbConnectionModalMode | null>(null);
  const [connectionDraftState, setConnectionDraftState] = createStore<{
    value: DbConnection | null;
  }>({
    value: null,
  });

  const normalizedFilter = createMemo(() => filter().trim().toLowerCase());
  const connectionMap = createMemo(
    () =>
      new Map(
        workspace().connections.map((connection) => [
          connection.id,
          connection,
        ]),
      ),
  );
  const activeTab = createMemo(() =>
    workspace().activeTabId
      ? (workspace().tabsById[workspace().activeTabId] ?? null)
      : null,
  );
  const activeConnection = createMemo(() =>
    activeTab()
      ? (connectionMap().get(activeTab()!.connectionId) ?? null)
      : null,
  );
  const folderEntries = createMemo(() =>
    workspace().folders.map((folder) => ({
      folder,
      connections: workspace().connections.filter(
        (connection) => connection.folderId === folder.id,
      ),
    })),
  );
  const rootConnections = createMemo(() =>
    workspace().connections.filter((connection) => !connection.folderId),
  );
  const filteredConnectionsFlat = createMemo(() => {
    if (!normalizedFilter()) {
      return [];
    }
    return workspace().connections.filter((connection) =>
      connection.name.toLowerCase().includes(normalizedFilter()),
    );
  });
  const filteredFavorites = createMemo(() => {
    if (!normalizedFilter()) {
      return workspace().favorites;
    }
    return workspace().favorites.filter((item) =>
      `${item.name} ${item.query}`.toLowerCase().includes(normalizedFilter()),
    );
  });
  const filteredHistory = createMemo(() => {
    if (!normalizedFilter()) {
      return workspace().history;
    }
    return workspace().history.filter((item) =>
      `${item.connectionName} ${item.query}`
        .toLowerCase()
        .includes(normalizedFilter()),
    );
  });

  onMount(() => {
    void loadDbWorkspace().then((loaded) => {
      setWorkspace(loaded);
    });

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-db-menu-root]")) {
        return;
      }
      setHeaderMenuOpen(false);
      setAddConnectionMenuOpen(false);
      setFolderMenu(null);
      setFolderAddMenuId(null);
      setConnectionMenu(null);
      setConnectionMoveMenuId(null);
      setTabMenu(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", handlePointerDown);
    });
  });

  async function commitWorkspace(mutator: (draft: DbWorkspaceState) => void) {
    const next = cloneValue(workspace());
    mutator(next);
    setWorkspace(next);
    await saveDbWorkspace(next);
  }

  function toggleFolderExpanded(folderId: string) {
    setExpandedFolderIds((current) =>
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId],
    );
  }

  function isFolderExpanded(folderId: string) {
    return expandedFolderIds().includes(folderId);
  }

  async function addFolder() {
    const folder = createDbFolder();
    await commitWorkspace((draft) => {
      draft.folders.push(folder);
    });
    setExpandedFolderIds((current) => [...current, folder.id]);
    setHeaderMenuOpen(false);
  }

  function openCreateConnectionModal(
    kind: DbConnectionKind,
    folderId: string | null = null,
  ) {
    setConnectionDraftState("value", createDbConnection(kind, folderId));
    setConnectionModalMode("create");
    setAddConnectionMenuOpen(false);
    setHeaderMenuOpen(false);
    setFolderMenu(null);
    setFolderAddMenuId(null);
  }

  function openEditConnectionModal(connection: DbConnection) {
    setConnectionDraftState("value", cloneValue(connection));
    setConnectionModalMode("edit");
    setConnectionMenu(null);
    setConnectionMoveMenuId(null);
  }

  function closeConnectionModal() {
    setConnectionModalMode(null);
    setConnectionDraftState("value", null);
  }

  function updateConnectionDraft<K extends keyof DbConnection>(
    key: K,
    value: DbConnection[K],
  ) {
    const current = connectionDraftState.value;
    if (!current) return;
    setConnectionDraftState("value", key, value);
    if (key !== "url") {
      const next = cloneValue({ ...current, [key]: value });
      setConnectionDraftState("value", "url", buildDbConnectionUrl(next));
    }
  }

  function updateConnectionDraftConfig<K extends keyof DbConnectionConfig>(
    key: K,
    value: DbConnectionConfig[K],
  ) {
    const current = connectionDraftState.value;
    if (!current) return;
    setConnectionDraftState("value", "config", key, value);
    const next = cloneValue({
      ...current,
      config: {
        ...current.config,
        [key]: value,
      },
    });
    setConnectionDraftState("value", "url", buildDbConnectionUrl(next));
  }

  async function saveConnectionDraft() {
    const draftConnection = connectionDraftState.value
      ? cloneValue(connectionDraftState.value)
      : null;
    const mode = connectionModalMode();
    if (!draftConnection || !mode) return;
    const normalizedConnection = {
      ...draftConnection,
      name:
        draftConnection.name.trim() ||
        getConnectionTypeLabel(draftConnection.kind),
      url: buildDbConnectionUrl(draftConnection) || draftConnection.url.trim(),
    };

    if (mode === "create") {
      const tab = createDbTab(normalizedConnection);
      await commitWorkspace((draft) => {
        draft.connections.push(normalizedConnection);
        draft.tabsById[tab.id] = tab;
        draft.openTabIds.push(tab.id);
        draft.activeTabId = tab.id;
      });
      if (normalizedConnection.folderId) {
        setExpandedFolderIds((current) =>
          current.includes(normalizedConnection.folderId!)
            ? current
            : [...current, normalizedConnection.folderId!],
        );
      }
    } else {
      await commitWorkspace((draft) => {
        const target = draft.connections.find(
          (item) => item.id === normalizedConnection.id,
        );
        if (!target) return;
        Object.assign(target, normalizedConnection);
        for (const tab of Object.values(draft.tabsById)) {
          if (tab.connectionId === normalizedConnection.id) {
            tab.title = normalizedConnection.name;
          }
        }
      });
    }

    closeConnectionModal();
  }

  async function updateActiveQuery(query: string) {
    const tab = activeTab();
    if (!tab) return;
    await commitWorkspace((draft) => {
      draft.tabsById[tab.id].query = query;
    });
  }

  async function openConnectionTab(connection: DbConnection, forceNew = false) {
    const existingId = !forceNew
      ? (workspace().openTabIds.find(
          (tabId) =>
            workspace().tabsById[tabId]?.connectionId === connection.id,
        ) ?? null)
      : null;

    if (existingId) {
      await commitWorkspace((draft) => {
        draft.activeTabId = existingId;
      });
      return;
    }

    const tab = createDbTab(connection);
    await commitWorkspace((draft) => {
      draft.tabsById[tab.id] = tab;
      draft.openTabIds.push(tab.id);
      draft.activeTabId = tab.id;
    });
  }

  async function closeTab(tabId: string) {
    await commitWorkspace((draft) => {
      delete draft.tabsById[tabId];
      draft.openTabIds = draft.openTabIds.filter((id) => id !== tabId);
      draft.pinnedTabIds = draft.pinnedTabIds.filter((id) => id !== tabId);
      if (draft.activeTabId === tabId) {
        draft.activeTabId = draft.openTabIds.at(-1) ?? null;
      }
    });
  }

  async function togglePinnedTab(tabId: string) {
    await commitWorkspace((draft) => {
      draft.pinnedTabIds = draft.pinnedTabIds.includes(tabId)
        ? draft.pinnedTabIds.filter((id) => id !== tabId)
        : [tabId, ...draft.pinnedTabIds.filter((id) => id !== tabId)];
    });
    setTabMenu(null);
  }

  async function closeOtherTabs(tabId: string) {
    await commitWorkspace((draft) => {
      const keepIds = draft.openTabIds.filter(
        (id) => id === tabId || draft.pinnedTabIds.includes(id),
      );
      draft.openTabIds = keepIds;
      draft.activeTabId = keepIds.includes(draft.activeTabId ?? "")
        ? draft.activeTabId
        : tabId;
      draft.tabsById = Object.fromEntries(
        Object.entries(draft.tabsById).filter(([id]) => keepIds.includes(id)),
      );
    });
    setTabMenu(null);
  }

  async function closeAllTabs() {
    await commitWorkspace((draft) => {
      const keepIds = draft.pinnedTabIds.filter((id) =>
        draft.openTabIds.includes(id),
      );
      draft.openTabIds = keepIds;
      draft.activeTabId = keepIds.at(-1) ?? null;
      draft.tabsById = Object.fromEntries(
        Object.entries(draft.tabsById).filter(([id]) => keepIds.includes(id)),
      );
    });
    setTabMenu(null);
  }

  async function closeTabsToDirection(
    tabId: string,
    direction: "left" | "right",
  ) {
    await commitWorkspace((draft) => {
      const index = draft.openTabIds.indexOf(tabId);
      if (index < 0) return;
      const keepIds = draft.openTabIds.filter((id, currentIndex) => {
        if (draft.pinnedTabIds.includes(id) || id === tabId) {
          return true;
        }
        return direction === "left"
          ? currentIndex > index
          : currentIndex < index;
      });
      draft.openTabIds = keepIds;
      draft.activeTabId = keepIds.includes(draft.activeTabId ?? "")
        ? draft.activeTabId
        : tabId;
      draft.tabsById = Object.fromEntries(
        Object.entries(draft.tabsById).filter(([id]) => keepIds.includes(id)),
      );
    });
    setTabMenu(null);
  }

  async function reorderTabs(fromId: string, toId: string) {
    await commitWorkspace((draft) => {
      const fromIndex = draft.openTabIds.indexOf(fromId);
      const toIndex = draft.openTabIds.indexOf(toId);
      if (fromIndex < 0 || toIndex < 0) return;
      const moved = arrayMove(draft.openTabIds, fromIndex, toIndex);
      const pinned = moved.filter((id) => draft.pinnedTabIds.includes(id));
      const unpinned = moved.filter((id) => !draft.pinnedTabIds.includes(id));
      draft.openTabIds = [...pinned, ...unpinned];
    });
  }

  async function reorderTabsToEnd(fromId: string) {
    await commitWorkspace((draft) => {
      const fromIndex = draft.openTabIds.indexOf(fromId);
      if (fromIndex < 0) return;
      const moved = arrayMove(
        draft.openTabIds,
        fromIndex,
        draft.openTabIds.length - 1,
      );
      const pinned = moved.filter((id) => draft.pinnedTabIds.includes(id));
      const unpinned = moved.filter((id) => !draft.pinnedTabIds.includes(id));
      draft.openTabIds = [...pinned, ...unpinned];
    });
  }

  async function renameFolder(folder: DbFolder) {
    const name = window.prompt("Folder name", folder.name)?.trim();
    if (!name) return;
    await commitWorkspace((draft) => {
      const target = draft.folders.find((item) => item.id === folder.id);
      if (target) target.name = name;
    });
    setFolderMenu(null);
  }

  async function deleteFolder(folderId: string) {
    await commitWorkspace((draft) => {
      draft.folders = draft.folders.filter((folder) => folder.id !== folderId);
      draft.connections = draft.connections.map((connection) =>
        connection.folderId === folderId
          ? { ...connection, folderId: null }
          : connection,
      );
    });
    setExpandedFolderIds((current) => current.filter((id) => id !== folderId));
    setFolderMenu(null);
  }

  async function moveFolderDirection(
    folderId: string,
    direction: "up" | "down",
  ) {
    await commitWorkspace((draft) => {
      const orderedIds = reorderByDirection(
        draft.folders.map((folder) => folder.id),
        folderId,
        direction,
      );
      const order = new Map(orderedIds.map((id, index) => [id, index]));
      draft.folders.sort(
        (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
      );
    });
    setFolderMenu(null);
  }

  async function moveConnectionDirection(
    connection: DbConnection,
    direction: "up" | "down",
  ) {
    await commitWorkspace((draft) => {
      const siblingFolderId = connection.folderId ?? null;
      const siblingIds = draft.connections
        .filter((item) => (item.folderId ?? null) === siblingFolderId)
        .map((item) => item.id);
      const nextIds = reorderByDirection(siblingIds, connection.id, direction);
      const order = new Map(nextIds.map((id, index) => [id, index]));
      const original = new Map(
        draft.connections.map((item, index) => [item.id, index]),
      );
      draft.connections.sort((a, b) => {
        const aMatch = (a.folderId ?? null) === siblingFolderId;
        const bMatch = (b.folderId ?? null) === siblingFolderId;
        if (aMatch && bMatch) {
          return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
        }
        return (original.get(a.id) ?? 0) - (original.get(b.id) ?? 0);
      });
    });
    setConnectionMenu(null);
    setConnectionMoveMenuId(null);
  }

  async function moveConnectionToFolder(
    connection: DbConnection,
    folderId: string | null,
  ) {
    await commitWorkspace((draft) => {
      const target = draft.connections.find(
        (item) => item.id === connection.id,
      );
      if (target) {
        target.folderId = folderId;
      }
    });
    setConnectionMenu(null);
    setConnectionMoveMenuId(null);
  }

  async function deleteConnection(connectionId: string) {
    await commitWorkspace((draft) => {
      draft.connections = draft.connections.filter(
        (connection) => connection.id !== connectionId,
      );
      const removedTabIds = Object.values(draft.tabsById)
        .filter((tab) => tab.connectionId === connectionId)
        .map((tab) => tab.id);
      draft.openTabIds = draft.openTabIds.filter(
        (id) => !removedTabIds.includes(id),
      );
      draft.pinnedTabIds = draft.pinnedTabIds.filter(
        (id) => !removedTabIds.includes(id),
      );
      draft.tabsById = Object.fromEntries(
        Object.entries(draft.tabsById).filter(
          ([, tab]) => tab.connectionId !== connectionId,
        ),
      );
      if (draft.activeTabId && removedTabIds.includes(draft.activeTabId)) {
        draft.activeTabId = draft.openTabIds.at(-1) ?? null;
      }
      draft.favorites = draft.favorites.filter(
        (item) => item.connectionId !== connectionId,
      );
      draft.history = draft.history.filter(
        (item) => item.connectionId !== connectionId,
      );
    });
    setConnectionMenu(null);
    setConnectionMoveMenuId(null);
  }

  async function saveCurrentTab() {
    const tab = activeTab();
    const connection = activeConnection();
    if (!tab || !connection) return;
    await commitWorkspace((draft) => {
      const targetConnection = draft.connections.find(
        (item) => item.id === connection.id,
      );
      const targetTab = draft.tabsById[tab.id];
      if (!targetConnection || !targetTab) return;
      targetConnection.name =
        targetConnection.name.trim() ||
        getConnectionTypeLabel(targetConnection.kind);
      targetTab.title = targetConnection.name;
      targetConnection.defaultQuery = targetTab.query;
      targetConnection.url = buildDbConnectionUrl(targetConnection);
    });
  }

  async function addCurrentQueryToFavorites() {
    const connection = activeConnection();
    const tab = activeTab();
    if (!connection || !tab || !tab.query.trim()) return;
    await commitWorkspace((draft) => {
      const existing = draft.favorites.find(
        (item) =>
          item.connectionId === connection.id &&
          item.query.trim() === tab.query.trim(),
      );
      if (existing) {
        existing.createdAt = new Date().toISOString();
        existing.name = existing.name || `${connection.name} Favorite`;
        return;
      }
      draft.favorites = [
        createDbFavorite(connection, tab.query, tab.query.split("\n")[0]),
        ...draft.favorites,
      ].slice(0, 100);
    });
    setSidebarView("favorites");
  }

  async function applyFavorite(favorite: DbFavoriteQuery) {
    const connection = connectionMap().get(favorite.connectionId);
    if (!connection) return;
    let targetTabId =
      workspace().openTabIds.find(
        (tabId) => workspace().tabsById[tabId]?.connectionId === connection.id,
      ) ?? null;
    if (!targetTabId) {
      const tab = createDbTab(connection);
      targetTabId = tab.id;
      await commitWorkspace((draft) => {
        draft.tabsById[tab.id] = tab;
        draft.openTabIds.push(tab.id);
        draft.activeTabId = tab.id;
      });
    } else {
      await commitWorkspace((draft) => {
        draft.activeTabId = targetTabId;
      });
    }
    await commitWorkspace((draft) => {
      if (targetTabId && draft.tabsById[targetTabId]) {
        draft.tabsById[targetTabId].query = favorite.query;
      }
    });
  }

  async function applyHistoryItem(item: DbQueryHistoryItem) {
    const connection = connectionMap().get(item.connectionId);
    if (!connection) return;
    let targetTabId =
      workspace().openTabIds.find(
        (tabId) => workspace().tabsById[tabId]?.connectionId === connection.id,
      ) ?? null;
    if (!targetTabId) {
      const tab = createDbTab(connection);
      targetTabId = tab.id;
      await commitWorkspace((draft) => {
        draft.tabsById[tab.id] = tab;
        draft.openTabIds.push(tab.id);
        draft.activeTabId = tab.id;
      });
    } else {
      await commitWorkspace((draft) => {
        draft.activeTabId = targetTabId;
      });
    }
    await commitWorkspace((draft) => {
      if (targetTabId && draft.tabsById[targetTabId]) {
        draft.tabsById[targetTabId].query = item.query;
      }
    });
  }

  async function removeFavorite(favoriteId: string) {
    await commitWorkspace((draft) => {
      draft.favorites = draft.favorites.filter(
        (item) => item.id !== favoriteId,
      );
    });
  }

  async function runCurrentTab() {
    const tab = activeTab();
    const connection = activeConnection();
    if (!tab || !connection) return;

    setExecutionByTabId((current) => ({
      ...current,
      [tab.id]: { status: "running" },
    }));

    try {
      await saveCurrentTab();
      const result = await executeDbTab(tab, connection);
      setResultByTabId((current) => ({ ...current, [tab.id]: result }));
      setRawByTabId((current) => ({
        ...current,
        [tab.id]: JSON.stringify(result.data, null, 2),
      }));
      setExecutionByTabId((current) => ({
        ...current,
        [tab.id]: {
          status: "success",
          durationMs: (result.data as { durationMs?: number }).durationMs,
        },
      }));
      await commitWorkspace((draft) => {
        draft.history = [
          createDbHistoryItem(connection, tab.query, "success"),
          ...draft.history,
        ].slice(0, 150);
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown database error";
      setExecutionByTabId((current) => ({
        ...current,
        [tab.id]: { status: "error", message },
      }));
      setRawByTabId((current) => ({ ...current, [tab.id]: message }));
      await commitWorkspace((draft) => {
        draft.history = [
          createDbHistoryItem(connection, tab.query, "error"),
          ...draft.history,
        ].slice(0, 150);
      });
    }
  }

  const tabItems = createMemo(() =>
    workspace()
      .openTabIds.map((tabId) => {
        const tab = workspace().tabsById[tabId];
        const connection = tab ? connectionMap().get(tab.connectionId) : null;
        if (!tab || !connection) return null;
        const badge = getConnectionBadge(connection);
        return {
          id: tab.id,
          name: tab.title,
          badgeLabel: badge.label,
          badgeClass: badge.class,
          active: workspace().activeTabId === tab.id,
          pinned: workspace().pinnedTabIds.includes(tab.id),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
  );

  function renderConnectionRow(connection: DbConnection) {
    return (
      <div
        class={`theme-sidebar-item group flex min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
          activeConnection()?.id === connection.id
            ? "theme-sidebar-item-active"
            : ""
        }`}
        onClick={() => {
          const existing = workspace().openTabIds.find(
            (tabId) =>
              workspace().tabsById[tabId]?.connectionId === connection.id,
          );
          if (existing) {
            void commitWorkspace((draft) => {
              draft.activeTabId = existing;
            });
          }
        }}
        onDblClick={() => void openConnectionTab(connection, true)}
        onContextMenu={(event) => {
          event.preventDefault();
          setConnectionMenu({
            id: connection.id,
            x: event.clientX,
            y: event.clientY,
          });
          setConnectionMoveMenuId(null);
          setFolderMenu(null);
          setHeaderMenuOpen(false);
        }}
      >
        <span class={`${getConnectionBadge(connection).class} shrink-0`}>
          {getConnectionBadge(connection).label}
        </span>
        <button class="min-w-0 flex-1 text-left">
          <p class="truncate text-[13px] font-medium" title={connection.name}>
            {connection.name}
          </p>
        </button>
        <div
          class={`relative shrink-0 transition-opacity ${
            connectionMenu()?.id === connection.id
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
          data-db-menu-root
        >
          <button
            class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
            title="Connection options"
            onClick={(event) => {
              event.stopPropagation();
              setConnectionMenu((current) =>
                current?.id === connection.id
                  ? null
                  : { id: connection.id, x: 0, y: 0 },
              );
            }}
          >
            <ControlDot variant="menu" />
          </button>
        </div>
      </div>
    );
  }

  function renderConfigField(
    label: string,
    value: string,
    onInput: (value: string) => void,
    type = "text",
    placeholder?: string,
  ) {
    return (
      <label class="grid gap-1">
        <span class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
          {label}
        </span>
        <input
          class="theme-input h-8 rounded-md px-2.5 text-sm"
          type={type}
          value={value}
          placeholder={placeholder}
          onInput={(event) => onInput(event.currentTarget.value)}
        />
      </label>
    );
  }

  function renderConnectionDraftForm(connection: DbConnection) {
    const config = connection.config;

    if (connection.kind === "sqlite") {
      return (
        <div class="grid gap-3">
          {renderConfigField(
            "File Path",
            config.filePath,
            (value) => updateConnectionDraftConfig("filePath", value),
            "text",
            "./devx.db",
          )}
        </div>
      );
    }

    if (connection.kind === "redis") {
      return (
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {renderConfigField("Host", config.host, (value) =>
            updateConnectionDraftConfig("host", value),
          )}
          {renderConfigField(
            "Port",
            config.port,
            (value) => updateConnectionDraftConfig("port", value),
            "text",
            "6379",
          )}
          {renderConfigField(
            "DB",
            config.database,
            (value) => updateConnectionDraftConfig("database", value),
            "text",
            "0",
          )}
          {renderConfigField("Login", config.username, (value) =>
            updateConnectionDraftConfig("username", value),
          )}
          {renderConfigField(
            "Password",
            config.password,
            (value) => updateConnectionDraftConfig("password", value),
            "password",
          )}
          {renderConfigField(
            "Parameters",
            config.options,
            (value) => updateConnectionDraftConfig("options", value),
            "text",
            "protocol=3",
          )}
        </div>
      );
    }

    if (connection.kind === "mongodb") {
      return (
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {renderConfigField("Host", config.host, (value) =>
            updateConnectionDraftConfig("host", value),
          )}
          {renderConfigField(
            "Port",
            config.port,
            (value) => updateConnectionDraftConfig("port", value),
            "text",
            "27017",
          )}
          {renderConfigField(
            "Database",
            config.database,
            (value) => updateConnectionDraftConfig("database", value),
            "text",
            "test",
          )}
          {renderConfigField("Login", config.username, (value) =>
            updateConnectionDraftConfig("username", value),
          )}
          {renderConfigField(
            "Password",
            config.password,
            (value) => updateConnectionDraftConfig("password", value),
            "password",
          )}
          {renderConfigField(
            "Auth Source",
            config.authSource,
            (value) => updateConnectionDraftConfig("authSource", value),
            "text",
            "admin",
          )}
          <div class="md:col-span-2 xl:col-span-3">
            {renderConfigField(
              "Parameters",
              config.options,
              (value) => updateConnectionDraftConfig("options", value),
              "text",
              "replicaSet=rs0",
            )}
          </div>
        </div>
      );
    }

    if (connection.kind === "oracle") {
      return (
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {renderConfigField("Host", config.host, (value) =>
            updateConnectionDraftConfig("host", value),
          )}
          {renderConfigField(
            "Port",
            config.port,
            (value) => updateConnectionDraftConfig("port", value),
            "text",
            "1521",
          )}
          {renderConfigField(
            "Service",
            config.serviceName,
            (value) => updateConnectionDraftConfig("serviceName", value),
            "text",
            "FREEPDB1",
          )}
          {renderConfigField("Login", config.username, (value) =>
            updateConnectionDraftConfig("username", value),
          )}
          {renderConfigField(
            "Password",
            config.password,
            (value) => updateConnectionDraftConfig("password", value),
            "password",
          )}
          {renderConfigField(
            "Parameters",
            config.options,
            (value) => updateConnectionDraftConfig("options", value),
            "text",
            "standaloneConnection=0",
          )}
        </div>
      );
    }

    const portPlaceholder =
      connection.kind === "sqlserver"
        ? "1433"
        : connection.kind === "clickhouse"
          ? "8123"
          : connection.kind === "mysql" || connection.kind === "tidb"
            ? "3306"
            : "5432";

    return (
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {renderConfigField("Host", config.host, (value) =>
          updateConnectionDraftConfig("host", value),
        )}
        {renderConfigField(
          "Port",
          config.port,
          (value) => updateConnectionDraftConfig("port", value),
          "text",
          portPlaceholder,
        )}
        {renderConfigField(
          "Database",
          config.database,
          (value) => updateConnectionDraftConfig("database", value),
          "text",
          "devx",
        )}
        {renderConfigField("Login", config.username, (value) =>
          updateConnectionDraftConfig("username", value),
        )}
        {renderConfigField(
          "Password",
          config.password,
          (value) => updateConnectionDraftConfig("password", value),
          "password",
        )}
        {renderConfigField(
          "Parameters",
          config.options,
          (value) => updateConnectionDraftConfig("options", value),
          "text",
          "sslmode=disable",
        )}
      </div>
    );
  }

  function renderRedisResult(result: DbResultPayload) {
    const value = result.data.result;
    if (Array.isArray(value)) {
      return (
        <div class="grid gap-2">
          <For each={value}>
            {(item, index) => (
              <div
                class="theme-code rounded-[18px] border px-3 py-2"
                style={{ "border-color": "var(--app-border)" }}
              >
                <p class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
                  Item {index() + 1}
                </p>
                <pre class="mt-2 whitespace-pre-wrap break-all font-mono text-xs">
                  {JSON.stringify(item, null, 2)}
                </pre>
              </div>
            )}
          </For>
        </div>
      );
    }

    if (value && typeof value === "object") {
      return (
        <div
          class="theme-code overflow-auto rounded-[18px] border"
          style={{ "border-color": "var(--app-border)" }}
        >
          <table class="min-w-full border-collapse text-sm">
            <tbody>
              <For each={Object.entries(value as Record<string, unknown>)}>
                {([key, item]) => (
                  <tr>
                    <td
                      class="theme-kv-head border-b px-3 py-2 align-top font-medium"
                      style={{ "border-color": "var(--app-border)" }}
                    >
                      {key}
                    </td>
                    <td
                      class="theme-kv-cell border-b px-3 py-2 align-top"
                      style={{ "border-color": "var(--app-border)" }}
                    >
                      <pre class="m-0 whitespace-pre-wrap break-all font-mono text-xs">
                        {JSON.stringify(item, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div
        class="theme-code rounded-[18px] border p-3"
        style={{ "border-color": "var(--app-border)" }}
      >
        <pre class="m-0 whitespace-pre-wrap break-all font-mono text-xs">
          {String(value ?? "")}
        </pre>
      </div>
    );
  }

  function renderMongoResult(result: DbResultPayload) {
    const value = result.data.result;
    const documents = Array.isArray(value) ? value : [value];
    return (
      <div class="grid gap-2">
        <For each={documents}>
          {(document, index) => (
            <div
              class="theme-code rounded-[18px] border p-3"
              style={{ "border-color": "var(--app-border)" }}
            >
              <p class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
                {Array.isArray(value) ? `Document ${index() + 1}` : "Document"}
              </p>
              <pre class="mt-2 whitespace-pre-wrap break-all font-mono text-xs">
                {JSON.stringify(document, null, 2)}
              </pre>
            </div>
          )}
        </For>
      </div>
    );
  }

  function renderResultView() {
    const tab = activeTab();
    if (!tab) return null;
    const result = resultByTabId()[tab.id];
    const raw = rawByTabId()[tab.id];
    const execution = executionByTabId()[tab.id] ?? { status: "idle" };
    const resultView = resultViewByTabId()[tab.id] ?? "table";

    const resultMeta = result
      ? `${formatBytes(formatResultSize(result.data))}${"durationMs" in result.data && result.data.durationMs ? ` | ${result.data.durationMs} ms` : ""}`
      : null;

    return (
      <div class="flex min-h-0 flex-1 flex-col">
        <div
          class="flex items-center justify-between border-b px-3 py-2"
          style={{ "border-color": "var(--app-border)" }}
        >
          <div class="flex items-center gap-2">
            <button
              class={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                resultView === "table"
                  ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
                  : "theme-text-soft hover:text-[var(--app-text)]"
              }`}
              onClick={() =>
                setResultViewByTabId((current) => ({
                  ...current,
                  [tab.id]: "table",
                }))
              }
            >
              Results
            </button>
            <button
              class={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                resultView === "raw"
                  ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
                  : "theme-text-soft hover:text-[var(--app-text)]"
              }`}
              onClick={() =>
                setResultViewByTabId((current) => ({
                  ...current,
                  [tab.id]: "raw",
                }))
              }
            >
              Raw
            </button>
          </div>
          <div class="theme-text-soft text-xs">
            <Show when={execution.status === "running"}>Running...</Show>
            <Show when={execution.status === "error"}>{execution.message}</Show>
            <Show when={execution.status === "success" && resultMeta}>
              {resultMeta}
            </Show>
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-auto p-3">
          <Show
            when={result}
            fallback={
              <div class="theme-text-soft text-sm">
                Run a query to see results.
              </div>
            }
          >
            <Show
              when={resultView === "raw" || result?.kind !== "sql"}
              fallback={
                <Show
                  when={
                    result?.kind === "sql" &&
                    result.data.columns &&
                    result.data.rows
                  }
                  fallback={
                    <div class="grid gap-3 md:grid-cols-2">
                      <div
                        class="theme-code rounded-[18px] border px-4 py-3"
                        style={{ "border-color": "var(--app-border)" }}
                      >
                        <p class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
                          Affected Rows
                        </p>
                        <p class="theme-text mt-2 text-lg font-semibold">
                          {result?.kind === "sql"
                            ? (result.data.affectedRows ?? 0)
                            : 0}
                        </p>
                      </div>
                      <div
                        class="theme-code rounded-[18px] border px-4 py-3"
                        style={{ "border-color": "var(--app-border)" }}
                      >
                        <p class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
                          Last Insert ID
                        </p>
                        <p class="theme-text mt-2 text-lg font-semibold">
                          {result?.kind === "sql"
                            ? (result.data.lastInsertId ?? 0)
                            : 0}
                        </p>
                      </div>
                    </div>
                  }
                >
                  <div
                    class="theme-code overflow-auto rounded-[18px] border"
                    style={{ "border-color": "var(--app-border)" }}
                  >
                    <table class="min-w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <For each={result?.data.columns ?? []}>
                            {(column) => (
                              <th
                                class="theme-kv-head border-b px-3 py-2 text-left font-medium"
                                style={{ "border-color": "var(--app-border)" }}
                              >
                                {column}
                              </th>
                            )}
                          </For>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={result?.data.rows ?? []}>
                          {(row) => (
                            <tr>
                              <For each={result?.data.columns ?? []}>
                                {(column) => (
                                  <td
                                    class="theme-kv-cell border-b px-3 py-2 align-top"
                                    style={{
                                      "border-color": "var(--app-border)",
                                    }}
                                  >
                                    <pre class="m-0 whitespace-pre-wrap break-all font-mono text-xs">
                                      {JSON.stringify(row[column], null, 2)}
                                    </pre>
                                  </td>
                                )}
                              </For>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              }
            >
              <Show
                when={resultView === "raw"}
                fallback={
                  <Show
                    when={result?.kind === "redis"}
                    fallback={
                      <Show
                        when={result?.kind === "mongo"}
                        fallback={
                          <div
                            class="theme-code h-full overflow-auto rounded-[18px] border p-3"
                            style={{ "border-color": "var(--app-border)" }}
                          >
                            <pre class="m-0 whitespace-pre-wrap break-words font-mono text-xs">
                              {raw}
                            </pre>
                          </div>
                        }
                      >
                        {renderMongoResult(result!)}
                      </Show>
                    }
                  >
                    {renderRedisResult(result!)}
                  </Show>
                }
              >
                <div
                  class="theme-code h-full overflow-auto rounded-[18px] border p-3"
                  style={{ "border-color": "var(--app-border)" }}
                >
                  <pre class="m-0 whitespace-pre-wrap break-words font-mono text-xs">
                    {raw}
                  </pre>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
      </div>
    );
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
              <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.24em]">
                Connections
              </p>
              <Show when={sidebarView() === "connections"}>
                <div class="flex items-center gap-1">
                  <div class="relative" data-db-menu-root>
                    <button
                      class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                      title="Connection options"
                      onClick={() => {
                        setHeaderMenuOpen((current) => !current);
                        setAddConnectionMenuOpen(false);
                      }}
                    >
                      <ControlDot variant="menu" />
                    </button>
                    <Show when={headerMenuOpen()}>
                      <div
                        class="theme-panel-soft theme-menu-popover absolute right-0 top-6 z-20 min-w-[148px] border p-1"
                        data-db-menu-root
                        style={{ "border-color": "var(--app-border)" }}
                      >
                        <button
                          class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                          onClick={() => void addFolder()}
                        >
                          Add Folder
                        </button>
                      </div>
                    </Show>
                  </div>
                  <div class="relative" data-db-menu-root>
                    <button
                      class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                      title="Add connection"
                      onClick={() => {
                        setAddConnectionMenuOpen((current) => !current);
                        setHeaderMenuOpen(false);
                      }}
                    >
                      <ControlDot variant="add" />
                    </button>
                    <Show when={addConnectionMenuOpen()}>
                      <div
                        class="theme-panel-soft theme-menu-popover absolute right-0 top-6 z-20 min-w-[172px] border p-1"
                        data-db-menu-root
                        style={{ "border-color": "var(--app-border)" }}
                      >
                        <For each={databaseKinds}>
                          {(kind) => (
                            <button
                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                              onClick={() => openCreateConnectionModal(kind)}
                            >
                              {getConnectionTypeLabel(kind)}
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>

            <div
              class="mb-3 grid grid-cols-3 gap-0 overflow-hidden rounded-lg border"
              style={{ "border-color": "var(--app-border)" }}
            >
              <button
                class={`px-2 py-1.5 text-xs font-medium ${sidebarView() === "connections" ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]" : "theme-text-soft"}`}
                onClick={() => setSidebarView("connections")}
              >
                Connections
              </button>
              <button
                class={`px-2 py-1.5 text-xs font-medium ${sidebarView() === "favorites" ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]" : "theme-text-soft"}`}
                onClick={() => setSidebarView("favorites")}
              >
                Favorites
              </button>
              <button
                class={`px-2 py-1.5 text-xs font-medium ${sidebarView() === "history" ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]" : "theme-text-soft"}`}
                onClick={() => setSidebarView("history")}
              >
                History
              </button>
            </div>

            <div class="mb-3">
              <input
                class="theme-input h-8 w-full rounded-md px-2.5 text-sm"
                placeholder={
                  sidebarView() === "connections"
                    ? "Filter"
                    : sidebarView() === "favorites"
                      ? "Filter favorites"
                      : "Filter history"
                }
                value={filter()}
                onInput={(event) => setFilter(event.currentTarget.value)}
              />
            </div>

            <Show when={sidebarView() === "connections"}>
              <div class="grid gap-0.5">
                <Show when={normalizedFilter()}>
                  <For each={filteredConnectionsFlat()}>
                    {(connection) => renderConnectionRow(connection)}
                  </For>
                </Show>

                <Show when={!normalizedFilter()}>
                  <For each={rootConnections()}>
                    {(connection) => renderConnectionRow(connection)}
                  </For>

                  <For each={folderEntries()}>
                    {(entry) => (
                      <div class="grid gap-1">
                        <div
                          class="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5"
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setFolderMenu({
                              id: entry.folder.id,
                              x: event.clientX,
                              y: event.clientY,
                            });
                            setHeaderMenuOpen(false);
                            setAddConnectionMenuOpen(false);
                            setFolderAddMenuId(null);
                            setConnectionMenu(null);
                            setConnectionMoveMenuId(null);
                          }}
                        >
                          <button
                            class="-ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-md text-[11px]"
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
                            onClick={() =>
                              toggleFolderExpanded(entry.folder.id)
                            }
                          >
                            <div class="inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle">
                              <p class="max-w-full truncate text-[13px] font-medium">
                                {entry.folder.name}
                              </p>
                              <span class="theme-chip shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
                                {entry.connections.length}
                              </span>
                            </div>
                          </button>
                          <div
                            class={`relative shrink-0 transition-opacity ${folderMenu()?.id === entry.folder.id ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}
                            data-db-menu-root
                          >
                            <button
                              class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                              title="Folder options"
                              onClick={(event) => {
                                event.stopPropagation();
                                setFolderMenu((current) =>
                                  current?.id === entry.folder.id
                                    ? null
                                    : { id: entry.folder.id, x: 0, y: 0 },
                                );
                              }}
                            >
                              <ControlDot variant="menu" />
                            </button>
                          </div>
                          <div
                            class={`relative shrink-0 transition-opacity ${folderMenu()?.id === entry.folder.id || folderAddMenuId() === entry.folder.id ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}
                            data-db-menu-root
                          >
                            <button
                              class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                              title="Add connection"
                              onClick={(event) => {
                                event.stopPropagation();
                                setFolderAddMenuId((current) =>
                                  current === entry.folder.id
                                    ? null
                                    : entry.folder.id,
                                );
                                setFolderMenu(null);
                              }}
                            >
                              <ControlDot variant="add" />
                            </button>
                            <Show when={folderAddMenuId() === entry.folder.id}>
                              <div
                                class="theme-panel-soft theme-menu-popover absolute right-0 top-6 z-20 min-w-[172px] border p-1"
                                data-db-menu-root
                                style={{ "border-color": "var(--app-border)" }}
                              >
                                <For each={databaseKinds}>
                                  {(kind) => (
                                    <button
                                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                      onClick={() =>
                                        openCreateConnectionModal(
                                          kind,
                                          entry.folder.id,
                                        )
                                      }
                                    >
                                      {getConnectionTypeLabel(kind)}
                                    </button>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                        </div>
                        <Show when={isFolderExpanded(entry.folder.id)}>
                          <div class="grid gap-0.5">
                            <For each={entry.connections}>
                              {(connection) => renderConnectionRow(connection)}
                            </For>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>

                <Show
                  when={
                    normalizedFilter()
                      ? filteredConnectionsFlat().length === 0
                      : rootConnections().length === 0 &&
                        folderEntries().length === 0
                  }
                >
                  <div class="theme-text-soft px-2 py-2 text-xs">
                    No matches
                  </div>
                </Show>
              </div>
            </Show>

            <Show when={sidebarView() === "favorites"}>
              <div class="grid gap-1">
                <For each={filteredFavorites()}>
                  {(favorite) => {
                    const connection = connectionMap().get(
                      favorite.connectionId,
                    );
                    return (
                      <div class="theme-sidebar-item group flex items-start gap-2 rounded-lg px-2 py-2">
                        <span
                          class={`${connection ? getConnectionBadge(connection).class : "theme-method-badge theme-method-default"} mt-0.5 shrink-0`}
                        >
                          {connection
                            ? getConnectionBadge(connection).label
                            : "DB"}
                        </span>
                        <button
                          class="min-w-0 flex-1 text-left"
                          onClick={() => void applyFavorite(favorite)}
                        >
                          <p class="truncate text-[13px] font-medium">
                            {favorite.name}
                          </p>
                          <p class="theme-text-soft mt-0.5 line-clamp-2 break-all text-[11px]">
                            {favorite.query}
                          </p>
                        </button>
                        <button
                          class="traffic-dot-button inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full p-0 opacity-0 transition-opacity group-hover:opacity-100"
                          title="Delete favorite"
                          onClick={() => void removeFavorite(favorite.id)}
                        >
                          <ControlDot variant="delete" />
                        </button>
                      </div>
                    );
                  }}
                </For>
                <Show when={filteredFavorites().length === 0}>
                  <div class="theme-text-soft px-2 py-2 text-xs">
                    No favorites yet
                  </div>
                </Show>
              </div>
            </Show>

            <Show when={sidebarView() === "history"}>
              <div class="grid gap-1">
                <For each={filteredHistory()}>
                  {(item) => (
                    <button
                      class="theme-sidebar-item flex items-start gap-2 rounded-lg px-2 py-2 text-left"
                      onClick={() => void applyHistoryItem(item)}
                    >
                      <span
                        class={`mt-0.5 inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${item.status === "error" ? "bg-[#ff5f57]" : "bg-[#26c73f]"}`}
                      />
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-[13px] font-medium">
                          {item.connectionName}
                        </p>
                        <p class="theme-text-soft mt-0.5 line-clamp-2 break-all text-[11px]">
                          {item.query}
                        </p>
                        <p class="theme-text-soft mt-1 text-[10px] uppercase tracking-[0.14em]">
                          {new Date(item.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </button>
                  )}
                </For>
                <Show when={filteredHistory().length === 0}>
                  <div class="theme-text-soft px-2 py-2 text-xs">
                    No history yet
                  </div>
                </Show>
              </div>
            </Show>
          </>
        }
      >
        <div class="flex min-h-0 flex-1 flex-col">
          <Show when={tabItems().length > 0}>
            <div
              class="border-b"
              style={{ "border-color": "var(--app-border)" }}
            >
              <TabsBar
                items={tabItems()}
                draggedId={draggedTabId()}
                dropTargetId={tabDropTargetId()}
                renderCloseIcon={() => <ControlDot variant="delete" />}
                renderPinIcon={() => <PinIcon />}
                onTabOpen={(tabId) =>
                  void commitWorkspace((draft) => {
                    draft.activeTabId = tabId;
                  })
                }
                onTabClose={(tabId) => void closeTab(tabId)}
                onTabContextMenu={(tabId, event) =>
                  setTabMenu({ id: tabId, x: event.clientX, y: event.clientY })
                }
                onDragStart={(tabId, event) => {
                  setDraggedTabId(tabId);
                  event.dataTransfer?.setData("text/plain", tabId);
                }}
                onDragEnd={() => {
                  setDraggedTabId(null);
                  setTabDropTargetId(null);
                }}
                onTabDragOver={(tabId, event) => {
                  event.preventDefault();
                  setTabDropTargetId(tabId);
                }}
                onTabDrop={(tabId, event) => {
                  event.preventDefault();
                  const draggedId = draggedTabId();
                  if (draggedId && draggedId !== tabId) {
                    void reorderTabs(draggedId, tabId);
                  }
                  setDraggedTabId(null);
                  setTabDropTargetId(null);
                }}
                onStripDragOver={(event) => event.preventDefault()}
                onStripDrop={(event) => {
                  event.preventDefault();
                  const draggedId = draggedTabId();
                  if (draggedId) {
                    void reorderTabsToEnd(draggedId);
                  }
                  setDraggedTabId(null);
                  setTabDropTargetId(null);
                }}
              />
            </div>
          </Show>

          <Show
            when={activeTab() && activeConnection()}
            fallback={<div class="flex-1 min-h-0" />}
          >
            <div
              class="border-b px-3 py-2"
              style={{ "border-color": "var(--app-border)" }}
            >
              <div class="grid gap-2 xl:grid-cols-[auto_minmax(180px,0.9fr)_auto_auto_auto_auto]">
                <div class="flex items-center">
                  <span class={getConnectionBadge(activeConnection()!).class}>
                    {getConnectionBadge(activeConnection()!).label}
                  </span>
                </div>
                <div class="theme-control inline-flex h-8 items-center rounded-md px-3 text-sm font-medium">
                  {activeConnection()!.name}
                </div>
                <div class="theme-control inline-flex h-8 items-center rounded-md px-3 text-sm font-medium">
                  {getConnectionTypeLabel(activeConnection()!.kind)}
                </div>
                <button
                  class="theme-control h-8 rounded-md px-3 text-sm font-medium"
                  onClick={() => openEditConnectionModal(activeConnection()!)}
                >
                  Edit
                </button>
                <button
                  class="theme-control h-8 rounded-md px-3 text-sm font-medium"
                  onClick={() => void addCurrentQueryToFavorites()}
                >
                  Favorite
                </button>
                <button
                  class="theme-control h-8 rounded-md px-3 text-sm font-medium"
                  onClick={() => void saveCurrentTab()}
                >
                  Save
                </button>
                <button
                  class="theme-success h-8 rounded-md px-3 text-sm font-semibold"
                  onClick={() => void runCurrentTab()}
                >
                  Run
                </button>
              </div>
            </div>

            <div class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_1px_minmax(0,1fr)]">
              <div class="min-h-0 overflow-hidden p-3">
                <div class="mb-2 flex items-center justify-between">
                  <p class="theme-text text-sm font-semibold">Query</p>
                  <p class="theme-text-soft text-xs">
                    {getConnectionTypeLabel(activeConnection()!.kind)}
                  </p>
                </div>
                <textarea
                  class="theme-input h-full min-h-[220px] w-full resize-none rounded-[18px] px-3 py-2 font-mono text-sm leading-6"
                  value={activeTab()!.query}
                  onInput={(event) =>
                    void updateActiveQuery(event.currentTarget.value)
                  }
                />
              </div>
              <div style={{ background: "var(--app-border)" }} />
              <div class="min-h-0 overflow-hidden">{renderResultView()}</div>
            </div>
          </Show>
        </div>
      </WorkspaceSidebarLayout>

      <Show when={Boolean(connectionModalMode() && connectionDraftState.value)}>
        <div
          class="fixed inset-0 z-[320] flex items-center justify-center bg-[rgba(15,23,42,0.3)] px-4 py-6"
          data-db-menu-root
        >
          <div
            class="theme-panel-soft w-full max-w-4xl rounded-[22px] border p-5 shadow-[0_24px_60px_rgba(15,23,42,0.24)]"
            style={{ "border-color": "var(--app-border)" }}
          >
            <div
              class="flex items-start justify-between gap-4 border-b pb-4"
              style={{ "border-color": "var(--app-border)" }}
            >
              <div>
                <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">
                  {connectionModalMode() === "create"
                    ? "New Connection"
                    : "Edit Connection"}
                </p>
                <h3 class="theme-text mt-2 text-lg font-semibold">
                  {getConnectionTypeLabel(connectionDraftState.value!.kind)}
                </h3>
              </div>
              <button
                class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                onClick={() => closeConnectionModal()}
              >
                <ControlDot variant="delete" />
              </button>
            </div>

            <div class="mt-4 grid gap-3">
              {renderConfigField(
                "Alias",
                connectionDraftState.value!.name,
                (value) => updateConnectionDraft("name", value),
              )}
              {renderConnectionDraftForm(connectionDraftState.value!)}
              <label class="grid gap-1">
                <span class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
                  Connection String
                </span>
                <input
                  class="theme-input h-8 rounded-md px-2.5 text-sm"
                  value={connectionDraftState.value!.url}
                  onInput={(event) =>
                    updateConnectionDraft("url", event.currentTarget.value)
                  }
                />
              </label>
            </div>

            <div class="mt-5 flex items-center justify-end gap-2">
              <button
                class="theme-control h-8 rounded-md px-3 text-sm font-medium"
                onClick={() => closeConnectionModal()}
              >
                Cancel
              </button>
              <button
                class="theme-success h-8 rounded-md px-3 text-sm font-semibold"
                onClick={() => void saveConnectionDraft()}
              >
                Save Connection
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={folderMenu()}>
        <div
          class="theme-panel-soft fixed z-[300] inline-grid auto-cols-max overflow-hidden rounded-[18px] border p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
          data-db-menu-root
          style={{
            "border-color": "var(--app-border)",
            left: `${folderMenu()!.x}px`,
            top: `${folderMenu()!.y}px`,
          }}
        >
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() =>
              void renameFolder(
                workspace().folders.find(
                  (folder) => folder.id === folderMenu()!.id,
                )!,
              )
            }
          >
            Rename
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => void moveFolderDirection(folderMenu()!.id, "up")}
          >
            Move Up
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => void moveFolderDirection(folderMenu()!.id, "down")}
          >
            Move Down
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]"
            onClick={() => void deleteFolder(folderMenu()!.id)}
          >
            Delete
          </button>
        </div>
      </Show>

      <Show when={connectionMenu()}>
        {() => {
          const connection = workspace().connections.find(
            (item) => item.id === connectionMenu()!.id,
          )!;
          return (
            <div
              class="theme-panel-soft fixed z-[300] inline-grid auto-cols-max overflow-hidden rounded-[18px] border p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
              data-db-menu-root
              style={{
                "border-color": "var(--app-border)",
                left: `${connectionMenu()!.x}px`,
                top: `${connectionMenu()!.y}px`,
              }}
            >
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void openConnectionTab(connection, true)}
              >
                Open
              </button>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => openEditConnectionModal(connection)}
              >
                Edit
              </button>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void moveConnectionDirection(connection, "up")}
              >
                Move Up
              </button>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void moveConnectionDirection(connection, "down")}
              >
                Move Down
              </button>
              <div class="relative" data-db-menu-root>
                <button
                  class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    setConnectionMoveMenuId((current) =>
                      current === connection.id ? null : connection.id,
                    );
                  }}
                >
                  <span>Move to</span>
                  <span class="theme-text-soft text-[10px]">›</span>
                </button>
                <Show when={connectionMoveMenuId() === connection.id}>
                  <div
                    class="theme-panel-soft theme-menu-popover absolute left-full top-0 ml-1 min-w-[160px] border p-1"
                    data-db-menu-root
                    style={{ "border-color": "var(--app-border)" }}
                  >
                    <button
                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                      onClick={() =>
                        void moveConnectionToFolder(connection, null)
                      }
                    >
                      Root
                    </button>
                    <For each={workspace().folders}>
                      {(folder) => (
                        <button
                          class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                          onClick={() =>
                            void moveConnectionToFolder(connection, folder.id)
                          }
                        >
                          {folder.name}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]"
                onClick={() => void deleteConnection(connection.id)}
              >
                Delete
              </button>
            </div>
          );
        }}
      </Show>

      <Show when={tabMenu()}>
        <div
          class="theme-panel-soft fixed z-[300] inline-grid auto-cols-max overflow-hidden rounded-[18px] border p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
          data-db-menu-root
          style={{
            "border-color": "var(--app-border)",
            left: `${tabMenu()!.x}px`,
            top: `${tabMenu()!.y}px`,
          }}
        >
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => void togglePinnedTab(tabMenu()!.id)}
          >
            {workspace().pinnedTabIds.includes(tabMenu()!.id) ? "UnPin" : "Pin"}
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => void closeOtherTabs(tabMenu()!.id)}
          >
            Close Others
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => void closeAllTabs()}
          >
            Close All
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => void closeTabsToDirection(tabMenu()!.id, "right")}
          >
            Close Right
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => void closeTabsToDirection(tabMenu()!.id, "left")}
          >
            Close Left
          </button>
        </div>
      </Show>
    </>
  );
}
