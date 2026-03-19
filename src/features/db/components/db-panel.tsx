import type { JSX } from "solid-js";
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
import { arrayMove, cloneValue } from "../../../lib/utils";
import type {
  DbConnection,
  DbConnectionConfig,
  DbConnectionKind,
  DbExecutionState,
  DbExplorerNode,
  DbFavoriteQuery,
  DbQueryHistoryItem,
  DbResultPayload,
  DbWorkspaceState,
} from "../models";
import {
  buildDbConnectionUrl,
  createDbConnection,
  createDbFavorite,
  createDbHistoryItem,
  createDbTab,
  executeDbTab,
  loadDbWorkspace,
  loadDbExplorer,
  loadDbExplorerDatabaseChildren,
  saveDbWorkspace,
  testDbConnection,
} from "../service";

type DbPanelProps = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarResizing: boolean;
  onSidebarResizeStart: (event: MouseEvent) => void;
};

type ConnectionMenuState = {
  id: string;
  x: number;
  y: number;
};

type DbTabMenuState = {
  id: string;
  x: number;
  y: number;
};

type ExplorerNodeMenuState = {
  connectionId: string;
  nodeId: string;
  x: number;
  y: number;
};

type DbConnectionModalMode = "create" | "edit";

type SidebarSection = "connections" | "favorites" | "history";

type FavoriteMenuState = {
  id: string;
  x: number;
  y: number;
};

type ExplorerLoadState = {
  status: "idle" | "loading" | "ready" | "error";
  nodes: DbExplorerNode[];
  error?: string;
};

type ExplorerLeafNode = Exclude<DbExplorerNode, { kind: "group" }>;

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

function getInitialWorkspace(): DbWorkspaceState {
  return {
    savedConnections: [],
    connectedConnectionIds: [],
    activeConnectionId: null,
    openTabIds: [],
    pinnedTabIds: [],
    activeTabId: null,
    tabsById: {},
    favorites: [],
    history: [],
  };
}

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

function DatabaseFolderIcon(props: { active?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      class={`h-4 w-4 shrink-0 ${
        props.active
          ? "text-[var(--app-accent)]"
          : "text-[var(--app-text-soft)]"
      }`}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2.5 6.25a1.75 1.75 0 0 1 1.75-1.75h4.09c.48 0 .94.2 1.27.55l.58.62c.33.35.79.55 1.27.55h4.29A1.75 1.75 0 0 1 17.5 8v6.25A1.75 1.75 0 0 1 15.75 16H4.25A1.75 1.75 0 0 1 2.5 14.25V6.25Z"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
      <path
        d="M2.75 8.25h14.5"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
  );
}

function TreeChevronIcon(props: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      class={`h-3 w-3 transition-transform ${
        props.expanded ? "rotate-90" : ""
      }`}
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
  );
}

function ExplorerLeafIcon(props: {
  kind: "table" | "view" | "collection" | "key";
}) {
  return (
    <span
      class={`inline-flex h-5 min-w-[30px] items-center justify-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${
        props.kind === "view"
          ? "theme-method-badge theme-method-head"
          : props.kind === "collection"
            ? "theme-method-badge theme-method-trace"
            : props.kind === "key"
              ? "theme-method-badge theme-method-patch"
              : "theme-method-badge theme-method-get"
      }`}
    >
      {props.kind === "view"
        ? "VIEW"
        : props.kind === "collection"
          ? "COL"
          : props.kind === "key"
            ? "KEY"
            : "TAB"}
    </span>
  );
}

function describeConnection(connection: DbConnection) {
  if (connection.kind === "sqlite") {
    return connection.config.filePath.trim() || "Local file";
  }

  if (connection.kind === "oracle") {
    const serviceName =
      connection.config.serviceName.trim() ||
      connection.config.database.trim() ||
      "FREEPDB1";
    return `${connection.config.host.trim() || "localhost"}:${connection.config.port.trim() || "1521"} / ${serviceName}`;
  }

  const host = connection.config.host.trim() || "localhost";
  const port = connection.config.port.trim();
  const database = connection.config.database.trim();
  const hostLabel = `${host}${port ? `:${port}` : ""}`;

  if (database) {
    return `${hostLabel} / ${database}`;
  }

  return hostLabel;
}

function getConnectionSearchText(connection: DbConnection) {
  return [
    connection.name,
    getConnectionTypeLabel(connection.kind),
    connection.config.host,
    connection.config.port,
    connection.config.database,
    connection.config.filePath,
    connection.config.serviceName,
  ]
    .join(" ")
    .toLowerCase();
}

export function DbPanel(props: DbPanelProps) {
  const [workspace, setWorkspace] = createSignal<DbWorkspaceState>(
    getInitialWorkspace(),
  );
  const [filter, setFilter] = createSignal("");
  const [expandedConnectionIds, setExpandedConnectionIds] = createSignal<
    string[]
  >([]);
  const [expandedExplorerNodeIds, setExpandedExplorerNodeIds] = createSignal<
    string[]
  >([]);
  const [explorerByConnectionId, setExplorerByConnectionId] = createSignal<
    Record<string, ExplorerLoadState>
  >({});
  const [savedConnectionsModalOpen, setSavedConnectionsModalOpen] =
    createSignal(false);
  const [savedConnectionsFilter, setSavedConnectionsFilter] = createSignal("");
  const [savedConnectionsError, setSavedConnectionsError] = createSignal<
    string | null
  >(null);
  const [pendingConnectionId, setPendingConnectionId] = createSignal<
    string | null
  >(null);
  const [returnToSavedConnectionsModal, setReturnToSavedConnectionsModal] =
    createSignal(false);
  const [connectionMenu, setConnectionMenu] =
    createSignal<ConnectionMenuState | null>(null);
  const [explorerNodeMenu, setExplorerNodeMenu] =
    createSignal<ExplorerNodeMenuState | null>(null);
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
  const [loadingExplorerNodeIds, setLoadingExplorerNodeIds] = createSignal<
    string[]
  >([]);
  const [sidebarSection, setSidebarSection] =
    createSignal<SidebarSection>("connections");
  const [favoriteMenu, setFavoriteMenu] =
    createSignal<FavoriteMenuState | null>(null);
  const [favoriteNameDraft, setFavoriteNameDraft] = createSignal<string | null>(
    null,
  );
  const [connectionDraftState, setConnectionDraftState] = createStore<{
    value: DbConnection | null;
  }>({
    value: null,
  });

  const normalizedFilter = createMemo(() => filter().trim().toLowerCase());
  const normalizedSavedConnectionsFilter = createMemo(() =>
    savedConnectionsFilter().trim().toLowerCase(),
  );
  const connectionMap = createMemo(
    () =>
      new Map(
        workspace().savedConnections.map((connection) => [
          connection.id,
          connection,
        ]),
      ),
  );
  const connectedConnections = createMemo(() =>
    workspace()
      .connectedConnectionIds.map((connectionId) =>
        connectionMap().get(connectionId),
      )
      .filter((connection): connection is DbConnection => Boolean(connection)),
  );
  const filteredConnectedConnections = createMemo(() => {
    if (!normalizedFilter()) {
      return connectedConnections();
    }

    return connectedConnections().filter((connection) =>
      getConnectionSearchText(connection).includes(normalizedFilter()),
    );
  });
  const filteredSavedConnections = createMemo(() => {
    if (!normalizedSavedConnectionsFilter()) {
      return workspace().savedConnections;
    }

    return workspace().savedConnections.filter((connection) =>
      getConnectionSearchText(connection).includes(
        normalizedSavedConnectionsFilter(),
      ),
    );
  });
  const activeTab = createMemo(() => {
    const tabId = workspace().activeTabId;
    return tabId ? (workspace().tabsById[tabId] ?? null) : null;
  });
  const activeConnection = createMemo(() => {
    const tab = activeTab();
    if (tab) {
      return connectionMap().get(tab.connectionId) ?? null;
    }

    const connectionId = workspace().activeConnectionId;
    if (connectionId) {
      return connectionMap().get(connectionId) ?? null;
    }

    return null;
  });
  const activeConnectionId = createMemo(
    () => activeConnection()?.id ?? workspace().activeConnectionId,
  );
  const filteredFavorites = createMemo(() => {
    const favorites = workspace().favorites ?? [];
    const connId = activeConnectionId();
    const search = normalizedFilter();
    return favorites.filter((fav) => {
      if (connId && fav.connectionId !== connId) return false;
      if (
        search &&
        !fav.name.toLowerCase().includes(search) &&
        !fav.query.toLowerCase().includes(search)
      )
        return false;
      return true;
    });
  });
  const recentHistory = createMemo(() => {
    const history = workspace().history ?? [];
    const search = normalizedFilter();
    if (!search) return history.slice(0, 50);
    return history
      .filter(
        (item) =>
          item.query.toLowerCase().includes(search) ||
          item.connectionName.toLowerCase().includes(search),
      )
      .slice(0, 50);
  });
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

  onMount(() => {
    void loadDbWorkspace().then((loaded) => {
      setWorkspace(loaded);
    });

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-db-menu-root]")) {
        return;
      }

      setConnectionMenu(null);
      setExplorerNodeMenu(null);
      setTabMenu(null);
      setFavoriteMenu(null);
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

  function isConnectionExpanded(connectionId: string) {
    return expandedConnectionIds().includes(connectionId);
  }

  function isExplorerNodeExpanded(nodeId: string) {
    return expandedExplorerNodeIds().includes(nodeId);
  }

  function toggleExplorerNodeExpanded(nodeId: string) {
    setExpandedExplorerNodeIds((current) =>
      current.includes(nodeId)
        ? current.filter((id) => id !== nodeId)
        : [...current, nodeId],
    );
  }

  function updateExplorerNodeChildren(
    nodes: DbExplorerNode[],
    targetId: string,
    newChildren: DbExplorerNode[],
  ): DbExplorerNode[] {
    return nodes.map((node) => {
      if (node.kind !== "group") return node;
      if (node.id === targetId) {
        return { ...node, children: newChildren, lazy: false };
      }
      return {
        ...node,
        children: updateExplorerNodeChildren(
          node.children,
          targetId,
          newChildren,
        ),
      };
    });
  }

  function expandExplorerGroupNode(
    connectionId: string,
    node: DbExplorerNode & { kind: "group" },
  ) {
    const wasExpanded = isExplorerNodeExpanded(node.id);
    toggleExplorerNodeExpanded(node.id);

    if (!wasExpanded && node.lazy && node.children.length === 0) {
      void loadLazyExplorerNode(connectionId, node);
    }
  }

  async function loadLazyExplorerNode(
    connectionId: string,
    node: DbExplorerNode & { kind: "group" },
  ) {
    const connection = connectionMap().get(connectionId);
    if (!connection) return;

    setLoadingExplorerNodeIds((prev) => [...prev, node.id]);

    try {
      const children = await loadDbExplorerDatabaseChildren(
        connection,
        node.label,
      );
      setExplorerByConnectionId((current) => {
        const entry = current[connectionId];
        if (!entry) return current;
        return {
          ...current,
          [connectionId]: {
            ...entry,
            nodes: updateExplorerNodeChildren(entry.nodes, node.id, children),
          },
        };
      });
    } catch {
      // Silently fail - user can retry by collapsing and re-expanding
    } finally {
      setLoadingExplorerNodeIds((prev) =>
        prev.filter((id) => id !== node.id),
      );
    }
  }

  async function loadConnectionExplorer(connection: DbConnection) {
    setExplorerByConnectionId((current) => ({
      ...current,
      [connection.id]: {
        status: "loading",
        nodes: current[connection.id]?.nodes ?? [],
      },
    }));

    try {
      const nodes = await loadDbExplorer(connection);
      setExplorerByConnectionId((current) => ({
        ...current,
        [connection.id]: {
          status: "ready",
          nodes,
        },
      }));
    } catch (error) {
      setExplorerByConnectionId((current) => ({
        ...current,
        [connection.id]: {
          status: "error",
          nodes: current[connection.id]?.nodes ?? [],
          error:
            error instanceof Error
              ? error.message
              : "Failed to load database objects.",
        },
      }));
    }
  }

  function toggleConnectionExpanded(connection: DbConnection) {
    const willExpand = !isConnectionExpanded(connection.id);
    setExpandedConnectionIds((current) =>
      current.includes(connection.id)
        ? current.filter((id) => id !== connection.id)
        : [...current, connection.id],
    );

    if (!willExpand) {
      return;
    }

    const explorer = explorerByConnectionId()[connection.id];
    if (
      !explorer ||
      explorer.status === "idle" ||
      explorer.status === "error"
    ) {
      void loadConnectionExplorer(connection);
    }
  }

  function findExplorerLeafNode(
    nodes: DbExplorerNode[],
    nodeId: string,
  ): ExplorerLeafNode | null {
    for (const node of nodes) {
      if (node.kind === "group") {
        const nested = findExplorerLeafNode(node.children, nodeId);
        if (nested) {
          return nested;
        }
        continue;
      }

      if (node.id === nodeId) {
        return node;
      }
    }

    return null;
  }

  function getExplorerPreviewMenuLabel(node: ExplorerLeafNode) {
    switch (node.kind) {
      case "collection":
        return "Find Documents";
      case "key":
        return "Inspect Key";
      case "table":
      case "view":
      default:
        return "SELECT TOP/LIMIT";
    }
  }

  async function openExplorerQuery(
    connection: DbConnection,
    node: ExplorerLeafNode,
    query: string,
    options?: {
      forceNew?: boolean;
      titleSuffix?: string;
    },
  ) {
    const forceNew = options?.forceNew ?? false;
    const activeTabId = workspace().activeTabId;
    const existingId = !forceNew
      ? activeTabId &&
        workspace().tabsById[activeTabId]?.connectionId === connection.id
        ? activeTabId
        : (workspace().openTabIds.find(
            (tabId) =>
              workspace().tabsById[tabId]?.connectionId === connection.id,
          ) ?? null)
      : null;
    const title = `${connection.name} · ${node.label}${
      options?.titleSuffix ? ` · ${options.titleSuffix}` : ""
    }`;

    await commitWorkspace((draft) => {
      if (!draft.connectedConnectionIds.includes(connection.id)) {
        draft.connectedConnectionIds = [
          connection.id,
          ...draft.connectedConnectionIds,
        ];
      }

      draft.activeConnectionId = connection.id;

      if (existingId && draft.tabsById[existingId]) {
        draft.tabsById[existingId].title = title;
        draft.tabsById[existingId].query = query;
        draft.activeTabId = existingId;
        return;
      }

      const tab = createDbTab(connection);
      tab.title = title;
      tab.query = query;
      draft.tabsById[tab.id] = tab;
      draft.openTabIds.push(tab.id);
      draft.activeTabId = tab.id;
    });

    closeFloatingMenus();
  }

  async function openExplorerLeaf(
    connection: DbConnection,
    node: DbExplorerNode,
  ) {
    if (node.kind === "group") {
      toggleExplorerNodeExpanded(node.id);
      return;
    }

    await openExplorerQuery(connection, node, node.query, { forceNew: true });
  }

  function resetConnectionExplorer(connectionId: string) {
    setExpandedConnectionIds((current) =>
      current.filter((id) => id !== connectionId),
    );
    setExplorerByConnectionId((current) => {
      const next = { ...current };
      delete next[connectionId];
      return next;
    });
  }

  async function refreshConnectionExplorer(connection: DbConnection) {
    closeFloatingMenus();
    await loadConnectionExplorer(connection);
  }

  async function refreshAllExplorers() {
    closeFloatingMenus();
    await Promise.all(
      connectedConnections().map((connection) =>
        loadConnectionExplorer(connection),
      ),
    );
  }

  async function resetConnectionExplorerCache(connection: DbConnection) {
    setExpandedExplorerNodeIds([]);
    setExplorerByConnectionId((current) => {
      const next = { ...current };
      delete next[connection.id];
      return next;
    });
    closeFloatingMenus();
    if (isConnectionExpanded(connection.id)) {
      await loadConnectionExplorer(connection);
    }
  }

  async function resetAllExplorerCaches() {
    const expandedIds = new Set(expandedConnectionIds());
    const expandedConnections = connectedConnections().filter((connection) =>
      expandedIds.has(connection.id),
    );

    setExpandedExplorerNodeIds([]);
    setExplorerByConnectionId({});
    closeFloatingMenus();

    await Promise.all(
      expandedConnections.map((connection) =>
        loadConnectionExplorer(connection),
      ),
    );
  }

  function clearTabArtifacts(tabIds: string[]) {
    if (tabIds.length === 0) {
      return;
    }

    setResultByTabId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tabId]) => !tabIds.includes(tabId)),
      ),
    );
    setRawByTabId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tabId]) => !tabIds.includes(tabId)),
      ),
    );
    setExecutionByTabId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tabId]) => !tabIds.includes(tabId)),
      ),
    );
    setResultViewByTabId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tabId]) => !tabIds.includes(tabId)),
      ),
    );
  }

  function closeFloatingMenus() {
    setConnectionMenu(null);
    setExplorerNodeMenu(null);
    setTabMenu(null);
    setFavoriteMenu(null);
  }

  function openSavedConnectionsModal() {
    setSavedConnectionsError(null);
    setPendingConnectionId(null);
    setSavedConnectionsModalOpen(true);
    closeFloatingMenus();
  }

  function closeSavedConnectionsModal() {
    setSavedConnectionsModalOpen(false);
    setSavedConnectionsError(null);
    setPendingConnectionId(null);
  }

  function openCreateConnectionModal(
    kind: DbConnectionKind = "postgresql",
    reopenSavedConnections = false,
  ) {
    setConnectionDraftState("value", createDbConnection(kind));
    setConnectionModalMode("create");
    setReturnToSavedConnectionsModal(reopenSavedConnections);
    if (reopenSavedConnections) {
      closeSavedConnectionsModal();
    }
    closeFloatingMenus();
  }

  function openEditConnectionModal(
    connection: DbConnection,
    reopenSavedConnections = false,
  ) {
    setConnectionDraftState("value", cloneValue(connection));
    setConnectionModalMode("edit");
    setReturnToSavedConnectionsModal(reopenSavedConnections);
    if (reopenSavedConnections) {
      closeSavedConnectionsModal();
    }
    closeFloatingMenus();
  }

  function closeConnectionModal() {
    const shouldReopenSavedConnections = returnToSavedConnectionsModal();
    setConnectionModalMode(null);
    setConnectionDraftState("value", null);
    setReturnToSavedConnectionsModal(false);

    if (shouldReopenSavedConnections) {
      setSavedConnectionsModalOpen(true);
    }
  }

  function changeConnectionDraftKind(kind: DbConnectionKind) {
    const current = connectionDraftState.value;
    if (!current) return;

    const template = createDbConnection(kind);
    const next: DbConnection = {
      ...current,
      kind,
      config: template.config,
      defaultQuery: template.defaultQuery,
      url: buildDbConnectionUrl({
        kind,
        config: template.config,
        url: current.url,
      }),
    };

    setConnectionDraftState("value", next);
  }

  function updateConnectionDraft<K extends keyof DbConnection>(
    key: K,
    value: DbConnection[K],
  ) {
    const current = connectionDraftState.value;
    if (!current) return;

    setConnectionDraftState("value", key, value);

    if (key === "url" || key === "kind") {
      return;
    }

    const next = cloneValue({ ...current, [key]: value });
    setConnectionDraftState("value", "url", buildDbConnectionUrl(next));
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

    const normalizedConnection: DbConnection = {
      ...draftConnection,
      name:
        draftConnection.name.trim() ||
        getConnectionTypeLabel(draftConnection.kind),
      url: buildDbConnectionUrl(draftConnection) || draftConnection.url.trim(),
      defaultQuery:
        draftConnection.defaultQuery.trim() ||
        createDbConnection(draftConnection.kind).defaultQuery,
    };

    if (mode === "create") {
      await commitWorkspace((draft) => {
        draft.savedConnections = [
          normalizedConnection,
          ...draft.savedConnections,
        ];
      });
      setExplorerByConnectionId((current) => ({
        ...current,
        [normalizedConnection.id]: {
          status: "idle",
          nodes: [],
        },
      }));
    } else {
      await commitWorkspace((draft) => {
        const target = draft.savedConnections.find(
          (item) => item.id === normalizedConnection.id,
        );
        if (!target) return;
        Object.assign(target, normalizedConnection);
        for (const tab of Object.values(draft.tabsById)) {
          if (tab.connectionId === normalizedConnection.id) {
            tab.title = normalizedConnection.name;
          }
        }
        if (
          draft.activeConnectionId &&
          draft.activeConnectionId === normalizedConnection.id
        ) {
          draft.activeConnectionId = normalizedConnection.id;
        }
      });
      resetConnectionExplorer(normalizedConnection.id);
      if (isConnectionExpanded(normalizedConnection.id)) {
        setExpandedConnectionIds((current) => [
          ...current,
          normalizedConnection.id,
        ]);
        void loadConnectionExplorer(normalizedConnection);
      }
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

    await commitWorkspace((draft) => {
      if (!draft.connectedConnectionIds.includes(connection.id)) {
        draft.connectedConnectionIds = [
          connection.id,
          ...draft.connectedConnectionIds,
        ];
      }

      draft.activeConnectionId = connection.id;

      if (existingId && draft.tabsById[existingId]) {
        draft.activeTabId = existingId;
        return;
      }

      const tab = createDbTab(connection);
      draft.tabsById[tab.id] = tab;
      draft.openTabIds.push(tab.id);
      draft.activeTabId = tab.id;
    });
  }

  async function connectSavedConnection(connection: DbConnection) {
    if (workspace().connectedConnectionIds.includes(connection.id)) {
      closeSavedConnectionsModal();
      await commitWorkspace((draft) => {
        draft.activeConnectionId = connection.id;
      });
      expandConnection(connection);
      return;
    }

    setSavedConnectionsError(null);
    setPendingConnectionId(connection.id);

    try {
      await testDbConnection(connection);
      await commitWorkspace((draft) => {
        draft.connectedConnectionIds = [
          connection.id,
          ...draft.connectedConnectionIds,
        ];
        draft.activeConnectionId = connection.id;
      });
      setExpandedConnectionIds((current) =>
        current.includes(connection.id) ? current : [...current, connection.id],
      );
      void loadConnectionExplorer(connection);
      closeSavedConnectionsModal();
    } catch (error) {
      setSavedConnectionsError(
        error instanceof Error ? error.message : "Connection failed.",
      );
    } finally {
      setPendingConnectionId(null);
    }
  }

  function expandConnection(connection: DbConnection) {
    if (isConnectionExpanded(connection.id)) {
      return;
    }

    setExpandedConnectionIds((current) => [...current, connection.id]);

    const explorer = explorerByConnectionId()[connection.id];
    if (
      !explorer ||
      explorer.status === "idle" ||
      explorer.status === "error"
    ) {
      void loadConnectionExplorer(connection);
    }
  }

  async function focusConnectedConnection(connection: DbConnection) {
    await commitWorkspace((draft) => {
      draft.activeConnectionId = connection.id;
    });
    expandConnection(connection);
  }

  async function closeTab(tabId: string) {
    clearTabArtifacts([tabId]);

    await commitWorkspace((draft) => {
      delete draft.tabsById[tabId];
      draft.openTabIds = draft.openTabIds.filter((id) => id !== tabId);
      draft.pinnedTabIds = draft.pinnedTabIds.filter((id) => id !== tabId);

      if (draft.activeTabId === tabId) {
        draft.activeTabId = draft.openTabIds.at(-1) ?? null;
      }

      draft.activeConnectionId = draft.activeTabId
        ? (draft.tabsById[draft.activeTabId]?.connectionId ??
          draft.activeConnectionId)
        : (draft.connectedConnectionIds[0] ?? null);
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
    const keepIds = workspace().openTabIds.filter(
      (id) => id === tabId || workspace().pinnedTabIds.includes(id),
    );
    clearTabArtifacts(
      workspace().openTabIds.filter((id) => !keepIds.includes(id)),
    );

    await commitWorkspace((draft) => {
      draft.openTabIds = keepIds;
      draft.activeTabId = keepIds.includes(draft.activeTabId ?? "")
        ? draft.activeTabId
        : tabId;
      draft.tabsById = Object.fromEntries(
        Object.entries(draft.tabsById).filter(([id]) => keepIds.includes(id)),
      );
      draft.activeConnectionId = draft.activeTabId
        ? (draft.tabsById[draft.activeTabId]?.connectionId ??
          draft.activeConnectionId)
        : (draft.connectedConnectionIds[0] ?? null);
    });
    setTabMenu(null);
  }

  async function closeAllTabs() {
    const keepIds = workspace().pinnedTabIds.filter((id) =>
      workspace().openTabIds.includes(id),
    );
    clearTabArtifacts(
      workspace().openTabIds.filter((id) => !keepIds.includes(id)),
    );

    await commitWorkspace((draft) => {
      draft.openTabIds = keepIds;
      draft.activeTabId = keepIds.at(-1) ?? null;
      draft.tabsById = Object.fromEntries(
        Object.entries(draft.tabsById).filter(([id]) => keepIds.includes(id)),
      );
      draft.activeConnectionId = draft.activeTabId
        ? (draft.tabsById[draft.activeTabId]?.connectionId ??
          draft.activeConnectionId)
        : (draft.connectedConnectionIds[0] ?? null);
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

  async function saveCurrentTab() {
    const tab = activeTab();
    const connection = activeConnection();
    if (!tab || !connection) return;

    await commitWorkspace((draft) => {
      const targetConnection = draft.savedConnections.find(
        (item) => item.id === connection.id,
      );
      const targetTab = draft.tabsById[tab.id];
      if (!targetConnection || !targetTab) return;

      targetConnection.name =
        targetConnection.name.trim() ||
        getConnectionTypeLabel(targetConnection.kind);
      targetConnection.defaultQuery = targetTab.query;
      targetConnection.url = buildDbConnectionUrl(targetConnection);
      targetTab.title = targetConnection.name;
    });
  }

  async function disconnectConnection(connectionId: string) {
    const removedTabIds = Object.values(workspace().tabsById)
      .filter((tab) => tab.connectionId === connectionId)
      .map((tab) => tab.id);
    clearTabArtifacts(removedTabIds);

    await commitWorkspace((draft) => {
      draft.connectedConnectionIds = draft.connectedConnectionIds.filter(
        (id) => id !== connectionId,
      );
      draft.openTabIds = draft.openTabIds.filter(
        (tabId) => !removedTabIds.includes(tabId),
      );
      draft.pinnedTabIds = draft.pinnedTabIds.filter(
        (tabId) => !removedTabIds.includes(tabId),
      );
      draft.tabsById = Object.fromEntries(
        Object.entries(draft.tabsById).filter(
          ([, tab]) => tab.connectionId !== connectionId,
        ),
      );

      if (draft.activeTabId && removedTabIds.includes(draft.activeTabId)) {
        draft.activeTabId = draft.openTabIds.at(-1) ?? null;
      }

      draft.activeConnectionId = draft.activeTabId
        ? (draft.tabsById[draft.activeTabId]?.connectionId ?? null)
        : (draft.connectedConnectionIds[0] ?? null);
    });

    resetConnectionExplorer(connectionId);
    closeFloatingMenus();
  }

  async function removeSavedConnection(connectionId: string) {
    const removedTabIds = Object.values(workspace().tabsById)
      .filter((tab) => tab.connectionId === connectionId)
      .map((tab) => tab.id);
    clearTabArtifacts(removedTabIds);

    await commitWorkspace((draft) => {
      draft.savedConnections = draft.savedConnections.filter(
        (connection) => connection.id !== connectionId,
      );
      draft.connectedConnectionIds = draft.connectedConnectionIds.filter(
        (id) => id !== connectionId,
      );
      draft.openTabIds = draft.openTabIds.filter(
        (tabId) => !removedTabIds.includes(tabId),
      );
      draft.pinnedTabIds = draft.pinnedTabIds.filter(
        (tabId) => !removedTabIds.includes(tabId),
      );
      draft.tabsById = Object.fromEntries(
        Object.entries(draft.tabsById).filter(
          ([, tab]) => tab.connectionId !== connectionId,
        ),
      );

      if (draft.activeTabId && removedTabIds.includes(draft.activeTabId)) {
        draft.activeTabId = draft.openTabIds.at(-1) ?? null;
      }

      draft.activeConnectionId = draft.activeTabId
        ? (draft.tabsById[draft.activeTabId]?.connectionId ?? null)
        : (draft.connectedConnectionIds[0] ?? null);
    });

    resetConnectionExplorer(connectionId);
    closeFloatingMenus();
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
        const item = createDbHistoryItem(connection, tab.query, "success");
        draft.history = [item, ...(draft.history ?? [])].slice(0, 100);
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown database error";
      setRawByTabId((current) => ({ ...current, [tab.id]: message }));
      setExecutionByTabId((current) => ({
        ...current,
        [tab.id]: { status: "error", message },
      }));
      await commitWorkspace((draft) => {
        const item = createDbHistoryItem(connection, tab.query, "error");
        draft.history = [item, ...(draft.history ?? [])].slice(0, 100);
      });
    }
  }

  async function saveQueryAsFavorite() {
    const tab = activeTab();
    const connection = activeConnection();
    if (!tab || !connection) return;

    const name = favoriteNameDraft()?.trim() || tab.title;
    const favorite = createDbFavorite(connection.id, name, tab.query);
    await commitWorkspace((draft) => {
      draft.favorites = [favorite, ...(draft.favorites ?? [])];
    });
    setFavoriteNameDraft(null);
  }

  async function removeFavorite(favoriteId: string) {
    await commitWorkspace((draft) => {
      draft.favorites = (draft.favorites ?? []).filter(
        (f) => f.id !== favoriteId,
      );
    });
    closeFloatingMenus();
  }

  async function loadFavoriteIntoTab(favorite: DbFavoriteQuery) {
    const connection = connectionMap().get(favorite.connectionId);
    if (!connection) return;

    const existingId =
      workspace().openTabIds.find(
        (tabId) => workspace().tabsById[tabId]?.connectionId === connection.id,
      ) ?? null;

    await commitWorkspace((draft) => {
      if (!draft.connectedConnectionIds.includes(connection.id)) {
        draft.connectedConnectionIds = [
          connection.id,
          ...draft.connectedConnectionIds,
        ];
      }
      draft.activeConnectionId = connection.id;

      if (existingId && draft.tabsById[existingId]) {
        draft.tabsById[existingId].title = favorite.name;
        draft.tabsById[existingId].query = favorite.query;
        draft.activeTabId = existingId;
        return;
      }

      const tab = createDbTab(connection);
      tab.title = favorite.name;
      tab.query = favorite.query;
      draft.tabsById[tab.id] = tab;
      draft.openTabIds.push(tab.id);
      draft.activeTabId = tab.id;
    });
  }

  async function loadHistoryIntoTab(item: DbQueryHistoryItem) {
    const connection = connectionMap().get(item.connectionId);
    if (!connection) return;

    const existingId =
      workspace().openTabIds.find(
        (tabId) => workspace().tabsById[tabId]?.connectionId === connection.id,
      ) ?? null;

    await commitWorkspace((draft) => {
      if (!draft.connectedConnectionIds.includes(connection.id)) {
        draft.connectedConnectionIds = [
          connection.id,
          ...draft.connectedConnectionIds,
        ];
      }
      draft.activeConnectionId = connection.id;

      if (existingId && draft.tabsById[existingId]) {
        draft.tabsById[existingId].query = item.query;
        draft.activeTabId = existingId;
        return;
      }

      const tab = createDbTab(connection);
      tab.query = item.query;
      draft.tabsById[tab.id] = tab;
      draft.openTabIds.push(tab.id);
      draft.activeTabId = tab.id;
    });
  }

  async function clearHistory() {
    await commitWorkspace((draft) => {
      draft.history = [];
    });
  }

  function renderConfigField(
    label: string,
    getValue: string | (() => string),
    onInput: (value: string) => void,
    type = "text",
    placeholder?: string,
  ) {
    const value = typeof getValue === "function" ? getValue : () => getValue;
    return (
      <label class="grid gap-1">
        <span class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
          {label}
        </span>
        <input
          class="theme-input h-8 rounded-md px-2.5 text-sm"
          type={type}
          value={value()}
          placeholder={placeholder}
          onInput={(event) => onInput(event.currentTarget.value)}
        />
      </label>
    );
  }

  function renderConnectionDraftForm(connection: DbConnection) {
    const cfg = () => connectionDraftState.value!.config;

    if (connection.kind === "sqlite") {
      return (
        <div class="grid gap-3">
          {renderConfigField(
            "File Path",
            () => cfg().filePath,
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
          {renderConfigField(
            "Host",
            () => cfg().host,
            (value) => updateConnectionDraftConfig("host", value),
          )}
          {renderConfigField(
            "Port",
            () => cfg().port,
            (value) => updateConnectionDraftConfig("port", value),
            "text",
            "6379",
          )}
          {renderConfigField(
            "DB",
            () => cfg().database,
            (value) => updateConnectionDraftConfig("database", value),
            "text",
            "0",
          )}
          {renderConfigField(
            "Login",
            () => cfg().username,
            (value) => updateConnectionDraftConfig("username", value),
          )}
          {renderConfigField(
            "Password",
            () => cfg().password,
            (value) => updateConnectionDraftConfig("password", value),
            "password",
          )}
          {renderConfigField(
            "Parameters",
            () => cfg().options,
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
          {renderConfigField(
            "Host",
            () => cfg().host,
            (value) => updateConnectionDraftConfig("host", value),
          )}
          {renderConfigField(
            "Port",
            () => cfg().port,
            (value) => updateConnectionDraftConfig("port", value),
            "text",
            "27017",
          )}
          {renderConfigField(
            "Database",
            () => cfg().database,
            (value) => updateConnectionDraftConfig("database", value),
            "text",
            "test",
          )}
          {renderConfigField(
            "Login",
            () => cfg().username,
            (value) => updateConnectionDraftConfig("username", value),
          )}
          {renderConfigField(
            "Password",
            () => cfg().password,
            (value) => updateConnectionDraftConfig("password", value),
            "password",
          )}
          {renderConfigField(
            "Auth Source",
            () => cfg().authSource,
            (value) => updateConnectionDraftConfig("authSource", value),
            "text",
            "admin",
          )}
          <div class="md:col-span-2 xl:col-span-3">
            {renderConfigField(
              "Parameters",
              () => cfg().options,
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
          {renderConfigField(
            "Host",
            () => cfg().host,
            (value) => updateConnectionDraftConfig("host", value),
          )}
          {renderConfigField(
            "Port",
            () => cfg().port,
            (value) => updateConnectionDraftConfig("port", value),
            "text",
            "1521",
          )}
          {renderConfigField(
            "Service",
            () => cfg().serviceName,
            (value) => updateConnectionDraftConfig("serviceName", value),
            "text",
            "FREEPDB1",
          )}
          {renderConfigField(
            "Login",
            () => cfg().username,
            (value) => updateConnectionDraftConfig("username", value),
          )}
          {renderConfigField(
            "Password",
            () => cfg().password,
            (value) => updateConnectionDraftConfig("password", value),
            "password",
          )}
          {renderConfigField(
            "Parameters",
            () => cfg().options,
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
        {renderConfigField(
          "Host",
          () => cfg().host,
          (value) => updateConnectionDraftConfig("host", value),
        )}
        {renderConfigField(
          "Port",
          () => cfg().port,
          (value) => updateConnectionDraftConfig("port", value),
          "text",
          portPlaceholder,
        )}
        {renderConfigField(
          "Database",
          () => cfg().database,
          (value) => updateConnectionDraftConfig("database", value),
          "text",
          "",
        )}
        {renderConfigField(
          "Login",
          () => cfg().username,
          (value) => updateConnectionDraftConfig("username", value),
        )}
        {renderConfigField(
          "Password",
          () => cfg().password,
          (value) => updateConnectionDraftConfig("password", value),
          "password",
        )}
        {renderConfigField(
          "Parameters",
          () => cfg().options,
          (value) => updateConnectionDraftConfig("options", value),
          "text",
          "sslmode=disable",
        )}
      </div>
    );
  }

  function renderRedisResult(
    result: Extract<DbResultPayload, { kind: "redis" }>,
  ) {
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

  function renderMongoResult(
    result: Extract<DbResultPayload, { kind: "mongo" }>,
  ) {
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
    const sqlResult = result?.kind === "sql" ? result : null;
    const redisResult = result?.kind === "redis" ? result : null;
    const mongoResult = result?.kind === "mongo" ? result : null;

    const resultMeta = result
      ? `${formatBytes(formatResultSize(result.data))}${
          "durationMs" in result.data && result.data.durationMs
            ? ` | ${result.data.durationMs} ms`
            : ""
        }`
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
            <Show when={execution.status === "error"}>
              {execution.status === "error" ? execution.message : ""}
            </Show>
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
                    sqlResult && sqlResult.data.columns && sqlResult.data.rows
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
                          {sqlResult?.data.affectedRows ?? 0}
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
                          {sqlResult?.data.lastInsertId ?? 0}
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
                          <For each={sqlResult?.data.columns ?? []}>
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
                        <For each={sqlResult?.data.rows ?? []}>
                          {(row) => (
                            <tr>
                              <For each={sqlResult?.data.columns ?? []}>
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
                    when={redisResult}
                    fallback={
                      <Show
                        when={mongoResult}
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
                        {renderMongoResult(mongoResult!)}
                      </Show>
                    }
                  >
                    {renderRedisResult(redisResult!)}
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

  function renderExplorerNode(
    connection: DbConnection,
    node: DbExplorerNode,
    depth: number,
  ): JSX.Element {
    const paddingLeft = `${depth * 14 + 12}px`;

    if (node.kind === "group") {
      const expanded = isExplorerNodeExpanded(node.id);
      const isLazy = Boolean(node.lazy);
      const isNodeLoading = () => loadingExplorerNodeIds().includes(node.id);
      const handleClick = () => {
        if (isLazy) {
          expandExplorerGroupNode(connection.id, node);
        } else {
          toggleExplorerNodeExpanded(node.id);
        }
      };
      return (
        <div class="grid gap-1">
          <div
            class="theme-sidebar-item flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5"
            style={{ "padding-left": paddingLeft }}
          >
            <button
              class="-ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-md text-[11px]"
              onClick={(event) => {
                event.stopPropagation();
                handleClick();
              }}
            >
              <TreeChevronIcon expanded={expanded} />
            </button>
            <DatabaseFolderIcon />
            <button
              class="min-w-0 flex-1 text-left"
              onClick={handleClick}
            >
              <div class="flex min-w-0 items-center gap-2">
                <p class="truncate text-[12px] font-medium">{node.label}</p>
                <Show when={node.description}>
                  <span class="theme-text-soft text-[10px]">
                    {node.description}
                  </span>
                </Show>
              </div>
            </button>
          </div>
          <Show when={expanded}>
            <div class="grid gap-0.5">
              <Show when={isNodeLoading()}>
                <div
                  class="theme-text-soft px-2 py-1 text-[11px]"
                  style={{ "padding-left": `${(depth + 1) * 14 + 12}px` }}
                >
                  Loading...
                </div>
              </Show>
              <For each={node.children}>
                {(child) => renderExplorerNode(connection, child, depth + 1)}
              </For>
            </div>
          </Show>
        </div>
      );
    }

    return (
      <button
        class="theme-sidebar-item flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left"
        style={{ "padding-left": paddingLeft }}
        onClick={() => void openExplorerLeaf(connection, node)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setExplorerNodeMenu({
            connectionId: connection.id,
            nodeId: node.id,
            x: event.clientX,
            y: event.clientY,
          });
          setConnectionMenu(null);
          setTabMenu(null);
        }}
      >
        <ExplorerLeafIcon kind={node.kind} />
        <div class="min-w-0 flex-1">
          <p class="truncate text-[12px] font-medium">{node.label}</p>
          <Show when={node.description}>
            <p class="theme-text-soft truncate text-[10px]">
              {node.description}
            </p>
          </Show>
        </div>
      </button>
    );
  }

  function renderConnectedConnectionRow(connection: DbConnection) {
    const isActive = activeConnectionId() === connection.id;
    const expanded = isConnectionExpanded(connection.id);
    const badge = getConnectionBadge(connection);
    const explorer = explorerByConnectionId()[connection.id] ?? {
      status: "idle",
      nodes: [],
    };

    return (
      <div class="grid gap-1">
        <div
          class={`theme-sidebar-item group flex min-w-0 items-center gap-2 rounded-xl px-2 py-2 ${
            isActive ? "theme-sidebar-item-active" : ""
          }`}
          onClick={() => void focusConnectedConnection(connection)}
          onContextMenu={(event) => {
            event.preventDefault();
            setConnectionMenu({
              id: connection.id,
              x: event.clientX,
              y: event.clientY,
            });
            setExplorerNodeMenu(null);
            setTabMenu(null);
          }}
        >
          <button
            class="-ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-md text-[11px]"
            onClick={(event) => {
              event.stopPropagation();
              toggleConnectionExpanded(connection);
            }}
          >
            <TreeChevronIcon expanded={expanded} />
          </button>
          <DatabaseFolderIcon active={isActive} />
          <button class="min-w-0 flex-1 text-left">
            <p class="truncate text-[13px] font-medium" title={connection.name}>
              {connection.name}
            </p>
            <p class="theme-text-soft truncate text-[11px]">
              {describeConnection(connection)}
            </p>
          </button>
          <span class={`${badge.class} shrink-0`}>{badge.label}</span>
          <span
            class="h-2.5 w-2.5 shrink-0 rounded-full bg-[#28c840]"
            title="Connected"
          />
          <div class="relative shrink-0" data-db-menu-root>
            <button
              class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              title="Connection options"
              onClick={(event) => {
                event.stopPropagation();
                setConnectionMenu((current) =>
                  current?.id === connection.id
                    ? null
                    : {
                        id: connection.id,
                        x: event.clientX,
                        y: event.clientY,
                      },
                );
                setExplorerNodeMenu(null);
                setTabMenu(null);
              }}
            >
              <ControlDot variant="menu" />
            </button>
          </div>
        </div>

        <Show when={expanded}>
          <div class="grid gap-1">
            <Show when={explorer.status === "loading"}>
              <div class="theme-text-soft px-2 py-1 text-[11px]">
                Loading objects...
              </div>
            </Show>
            <Show when={explorer.status === "error"}>
              <button
                class="theme-control rounded-lg px-3 py-2 text-left text-[11px]"
                onClick={() => void loadConnectionExplorer(connection)}
              >
                {explorer.error || "Failed to load database objects."}
              </button>
            </Show>
            <Show
              when={explorer.status === "ready" && explorer.nodes.length === 0}
            >
              <div class="theme-text-soft px-2 py-1 text-[11px]">
                No objects found.
              </div>
            </Show>
            <For each={explorer.nodes}>
              {(node) => renderExplorerNode(connection, node, 1)}
            </For>
          </div>
        </Show>
      </div>
    );
  }

  function renderEmptyState() {
    return (
      <div class="flex min-h-0 flex-1 items-center justify-center p-6">
        <div class="theme-control max-w-md rounded-[28px] px-6 py-7 text-center">
          <p class="theme-text text-lg font-semibold">No database connected</p>
          <p class="theme-text-soft mt-2 text-sm leading-6">
            Click the yellow dot in the Connections header, choose a saved
            database, and connect it first.
          </p>
          <button
            class="theme-button-primary mt-5 rounded-xl px-4 py-2 text-sm font-semibold"
            onClick={() => openSavedConnectionsModal()}
          >
            Open Saved Connections
          </button>
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
              class="mb-3 flex items-center gap-1 border-b pb-2"
              style={{ "border-color": "var(--app-border)" }}
            >
              <For
                each={
                  [
                    {
                      key: "connections" as SidebarSection,
                      label: "Connections",
                    },
                    { key: "favorites" as SidebarSection, label: "Favorites" },
                    { key: "history" as SidebarSection, label: "History" },
                  ] as const
                }
              >
                {(section) => (
                  <button
                    class={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                      sidebarSection() === section.key
                        ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
                        : "theme-text-soft hover:text-[var(--app-text)]"
                    }`}
                    onClick={() => setSidebarSection(section.key)}
                  >
                    {section.label}
                  </button>
                )}
              </For>
              <div class="flex-1" />
              <button
                class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                title="Saved connections"
                onClick={() => openSavedConnectionsModal()}
              >
                <ControlDot variant="warn" />
              </button>
            </div>

            <div class="mb-3">
              <input
                class="theme-input h-8 w-full rounded-md px-2.5 text-sm"
                placeholder={
                  sidebarSection() === "connections"
                    ? "Filter connected databases"
                    : sidebarSection() === "favorites"
                      ? "Filter favorites"
                      : "Filter history"
                }
                value={filter()}
                onInput={(event) => setFilter(event.currentTarget.value)}
              />
            </div>

            <Show when={sidebarSection() === "connections"}>
              <div class="mb-2 flex items-center justify-between">
                <p class="theme-text-soft text-[11px] font-medium uppercase tracking-[0.16em]">
                  Connected
                </p>
                <div class="flex items-center gap-1">
                  <Show when={connectedConnections().length > 0}>
                    <button
                      class="theme-text-soft rounded-md px-1.5 py-0.5 text-[10px] hover:text-[var(--app-text)]"
                      title="Refresh all object trees"
                      onClick={() => void refreshAllExplorers()}
                    >
                      Refresh
                    </button>
                  </Show>
                  <Show when={Object.keys(explorerByConnectionId()).length > 0}>
                    <button
                      class="theme-text-soft rounded-md px-1.5 py-0.5 text-[10px] hover:text-[var(--app-text)]"
                      title="Reset cached object trees"
                      onClick={() => void resetAllExplorerCaches()}
                    >
                      Reset
                    </button>
                  </Show>
                </div>
              </div>
              <div class="grid gap-1">
                <For each={filteredConnectedConnections()}>
                  {(connection) => renderConnectedConnectionRow(connection)}
                </For>

                <Show when={filteredConnectedConnections().length === 0}>
                  <div class="theme-text-soft rounded-xl px-2 py-2 text-xs">
                    {connectedConnections().length === 0
                      ? "No connected databases. Click the yellow dot to connect."
                      : "No matches"}
                  </div>
                </Show>
              </div>
            </Show>

            <Show when={sidebarSection() === "favorites"}>
              <div class="grid gap-1">
                <For each={filteredFavorites()}>
                  {(fav) => {
                    const connection = connectionMap().get(fav.connectionId);
                    const badge = connection
                      ? getConnectionBadge(connection)
                      : null;
                    return (
                      <button
                        class="theme-sidebar-item flex min-w-0 items-center gap-2 rounded-xl px-2 py-2 text-left"
                        onClick={() => void loadFavoriteIntoTab(fav)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setFavoriteMenu({
                            id: fav.id,
                            x: event.clientX,
                            y: event.clientY,
                          });
                          setConnectionMenu(null);
                          setExplorerNodeMenu(null);
                          setTabMenu(null);
                        }}
                      >
                        <Show when={badge}>
                          <span class={`${badge!.class} shrink-0`}>
                            {badge!.label}
                          </span>
                        </Show>
                        <div class="min-w-0 flex-1">
                          <p class="truncate text-[12px] font-medium">
                            {fav.name}
                          </p>
                          <p class="theme-text-soft mt-0.5 truncate text-[10px] font-mono">
                            {fav.query.slice(0, 80)}
                          </p>
                        </div>
                      </button>
                    );
                  }}
                </For>
                <Show when={filteredFavorites().length === 0}>
                  <div class="theme-text-soft rounded-xl px-2 py-3 text-center text-xs">
                    {(workspace().favorites ?? []).length === 0
                      ? "No favorites yet. Save a query from the toolbar."
                      : "No matches"}
                  </div>
                </Show>
              </div>
            </Show>

            <Show when={sidebarSection() === "history"}>
              <Show when={(workspace().history ?? []).length > 0}>
                <div class="mb-2 flex items-center justify-end">
                  <button
                    class="theme-text-soft rounded-md px-1.5 py-0.5 text-[10px] hover:text-[var(--app-text)]"
                    onClick={() => void clearHistory()}
                  >
                    Clear
                  </button>
                </div>
              </Show>
              <div class="grid gap-1">
                <For each={recentHistory()}>
                  {(item) => {
                    const badge = getConnectionBadge({
                      kind: item.kind,
                    } as DbConnection);
                    return (
                      <button
                        class="theme-sidebar-item flex min-w-0 items-center gap-2 rounded-xl px-2 py-2 text-left"
                        onClick={() => void loadHistoryIntoTab(item)}
                      >
                        <span class={`${badge.class} shrink-0`}>
                          {badge.label}
                        </span>
                        <div class="min-w-0 flex-1">
                          <p class="truncate text-[12px] font-mono">
                            {item.query.slice(0, 80)}
                          </p>
                          <div class="mt-0.5 flex items-center gap-2">
                            <span class="theme-text-soft text-[10px]">
                              {item.connectionName}
                            </span>
                            <span
                              class={`text-[10px] ${
                                item.status === "error"
                                  ? "text-[#ff6f61]"
                                  : "text-[#28c840]"
                              }`}
                            >
                              {item.status}
                            </span>
                            <span class="theme-text-soft text-[10px]">
                              {new Date(item.executedAt).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  }}
                </For>
                <Show when={recentHistory().length === 0}>
                  <div class="theme-text-soft rounded-xl px-2 py-3 text-center text-xs">
                    {(workspace().history ?? []).length === 0
                      ? "No history yet. Run a query to start tracking."
                      : "No matches"}
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
                    draft.activeConnectionId =
                      draft.tabsById[tabId]?.connectionId ??
                      draft.activeConnectionId;
                  })
                }
                onTabClose={(tabId) => void closeTab(tabId)}
                onTabContextMenu={(tabId, event) => {
                  setConnectionMenu(null);
                  setExplorerNodeMenu(null);
                  setTabMenu({ id: tabId, x: event.clientX, y: event.clientY });
                }}
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
            fallback={renderEmptyState()}
          >
            <div
              class="border-b px-3 py-2"
              style={{ "border-color": "var(--app-border)" }}
            >
              <div class="grid gap-2 xl:grid-cols-[auto_minmax(180px,1fr)_auto_auto_auto_auto]">
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
                  onClick={() => void saveCurrentTab()}
                >
                  Save Query
                </button>
                <button
                  class="theme-control h-8 rounded-md px-3 text-sm font-medium"
                  onClick={() => {
                    setFavoriteNameDraft(activeTab()?.title ?? "");
                    setSidebarSection("favorites");
                  }}
                  title="Save current query as favorite"
                >
                  ★ Fav
                </button>
                <button
                  class="theme-control h-8 rounded-md px-3 text-sm font-medium"
                  onClick={() =>
                    void disconnectConnection(activeConnection()!.id)
                  }
                >
                  Disconnect
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
                <Show when={favoriteNameDraft() !== null}>
                  <div
                    class="mb-2 flex items-center gap-2 rounded-xl border px-3 py-2"
                    style={{
                      "border-color": "var(--app-accent)",
                      background: "var(--app-accent-soft)",
                    }}
                  >
                    <span class="text-[11px] font-medium">
                      Save as Favorite:
                    </span>
                    <input
                      class="theme-input h-7 flex-1 rounded-md px-2 text-sm"
                      placeholder="Favorite name"
                      value={favoriteNameDraft() ?? ""}
                      onInput={(event) =>
                        setFavoriteNameDraft(event.currentTarget.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void saveQueryAsFavorite();
                        } else if (event.key === "Escape") {
                          setFavoriteNameDraft(null);
                        }
                      }}
                      autofocus
                    />
                    <button
                      class="theme-success h-7 rounded-md px-3 text-[11px] font-semibold"
                      onClick={() => void saveQueryAsFavorite()}
                    >
                      Save
                    </button>
                    <button
                      class="theme-control h-7 rounded-md px-2 text-[11px]"
                      onClick={() => setFavoriteNameDraft(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </Show>
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

      <Show when={savedConnectionsModalOpen()}>
        <div
          class="fixed inset-0 z-[320] flex items-center justify-center bg-[rgba(15,23,42,0.3)] px-4 py-6"
          data-db-menu-root
        >
          <div
            class="theme-panel-soft w-full max-w-3xl rounded-[22px] border p-5 shadow-[0_24px_60px_rgba(15,23,42,0.24)]"
            style={{ "border-color": "var(--app-border)" }}
          >
            <div
              class="flex items-start justify-between gap-4 border-b pb-4"
              style={{ "border-color": "var(--app-border)" }}
            >
              <div>
                <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">
                  Saved Connections
                </p>
                <h3 class="theme-text mt-2 text-lg font-semibold">
                  Connect a database
                </h3>
                <p class="theme-text-soft mt-1 text-sm">
                  Double-click a saved connection, or use the button on the
                  right to test and connect it.
                </p>
              </div>
              <button
                class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                onClick={() => closeSavedConnectionsModal()}
              >
                <ControlDot variant="delete" />
              </button>
            </div>

            <div class="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
              <input
                class="theme-input h-9 flex-1 rounded-xl px-3 text-sm"
                placeholder="Search saved databases"
                value={savedConnectionsFilter()}
                onInput={(event) =>
                  setSavedConnectionsFilter(event.currentTarget.value)
                }
              />
              <button
                class="theme-button-primary h-9 rounded-xl px-4 text-sm font-semibold"
                onClick={() => openCreateConnectionModal("postgresql", true)}
              >
                New Connection
              </button>
            </div>

            <Show when={savedConnectionsError()}>
              <div
                class="mt-4 rounded-xl border px-3 py-2 text-sm text-[#ff8b8b]"
                style={{ "border-color": "rgba(255, 95, 87, 0.35)" }}
              >
                {savedConnectionsError()}
              </div>
            </Show>

            <div class="mt-4 max-h-[55vh] overflow-auto">
              <div class="grid gap-2">
                <For each={filteredSavedConnections()}>
                  {(connection) => {
                    const badge = getConnectionBadge(connection);
                    const isConnected =
                      workspace().connectedConnectionIds.includes(
                        connection.id,
                      );
                    const isPending = pendingConnectionId() === connection.id;

                    return (
                      <div
                        class="theme-control grid gap-3 rounded-[18px] px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
                        onDblClick={() =>
                          void connectSavedConnection(connection)
                        }
                      >
                        <div class="min-w-0">
                          <div class="flex min-w-0 items-center gap-2">
                            <span class={badge.class}>{badge.label}</span>
                            <p
                              class="truncate text-sm font-semibold"
                              title={connection.name}
                            >
                              {connection.name}
                            </p>
                            <Show when={isConnected}>
                              <span class="theme-chip rounded-full px-2 py-0.5 text-[10px] font-medium">
                                Connected
                              </span>
                            </Show>
                          </div>
                          <p class="theme-text-soft mt-2 truncate text-xs">
                            {getConnectionTypeLabel(connection.kind)} ·{" "}
                            {describeConnection(connection)}
                          </p>
                        </div>
                        <div class="flex items-center justify-end gap-2">
                          <button
                            class="theme-control rounded-xl px-3 py-1.5 text-sm font-medium"
                            disabled={isPending}
                            onClick={() =>
                              openEditConnectionModal(connection, true)
                            }
                          >
                            Edit
                          </button>
                          <button
                            class="theme-control rounded-xl px-3 py-1.5 text-sm font-medium text-[#ff6f61]"
                            disabled={isPending}
                            onClick={() =>
                              void removeSavedConnection(connection.id)
                            }
                          >
                            Delete
                          </button>
                          <button
                            class="theme-button-primary rounded-xl px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={Boolean(pendingConnectionId())}
                            onClick={() =>
                              void connectSavedConnection(connection)
                            }
                          >
                            {isPending
                              ? "Connecting..."
                              : isConnected
                                ? "Open"
                                : "Connect"}
                          </button>
                        </div>
                      </div>
                    );
                  }}
                </For>

                <Show when={filteredSavedConnections().length === 0}>
                  <div class="theme-control rounded-[18px] px-4 py-5 text-center">
                    <p class="theme-text text-sm font-semibold">
                      No saved connections
                    </p>
                    <p class="theme-text-soft mt-1 text-sm">
                      Create one first, then connect it from here.
                    </p>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <Show when={Boolean(connectionModalMode() && connectionDraftState.value)}>
        <div
          class="fixed inset-0 z-[330] flex items-center justify-center bg-[rgba(15,23,42,0.3)] px-4 py-6"
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

            <div class="mt-4 grid gap-4">
              <div class="grid gap-3 md:grid-cols-2">
                {renderConfigField(
                  "Alias",
                  () => connectionDraftState.value!.name,
                  (value) => updateConnectionDraft("name", value),
                )}
                <label class="grid gap-1">
                  <span class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
                    Database Type
                  </span>
                  <select
                    class="theme-input h-8 rounded-md px-2.5 text-sm"
                    value={connectionDraftState.value!.kind}
                    onInput={(event) =>
                      changeConnectionDraftKind(
                        event.currentTarget.value as DbConnectionKind,
                      )
                    }
                  >
                    <For each={databaseKinds}>
                      {(kind) => (
                        <option value={kind}>
                          {getConnectionTypeLabel(kind)}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
              </div>

              {renderConnectionDraftForm(connectionDraftState.value!)}

              <label class="grid gap-1">
                <span class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
                  Default Query
                </span>
                <textarea
                  class="theme-input min-h-[120px] rounded-[18px] px-3 py-2 font-mono text-sm leading-6"
                  value={connectionDraftState.value!.defaultQuery}
                  onInput={(event) =>
                    updateConnectionDraft(
                      "defaultQuery",
                      event.currentTarget.value,
                    )
                  }
                />
              </label>

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

      <Show when={connectionMenu()} keyed>
        {(menu) => {
          const connection = connectionMap().get(menu.id);
          if (!connection) return null;

          return (
            <div
              class="theme-panel-soft fixed z-[300] inline-grid auto-cols-max overflow-hidden rounded-[18px] border p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
              data-db-menu-root
              style={{
                "border-color": "var(--app-border)",
                left: `${menu.x}px`,
                top: `${menu.y}px`,
              }}
            >
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void openConnectionTab(connection)}
              >
                Open
              </button>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void openConnectionTab(connection, true)}
              >
                New Query Tab
              </button>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void refreshConnectionExplorer(connection)}
              >
                Refresh Objects
              </button>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void resetConnectionExplorerCache(connection)}
              >
                Reset Object Cache
              </button>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => openEditConnectionModal(connection)}
              >
                Edit Saved Connection
              </button>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void disconnectConnection(connection.id)}
              >
                Disconnect
              </button>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]"
                onClick={() => void removeSavedConnection(connection.id)}
              >
                Delete Saved Connection
              </button>
            </div>
          );
        }}
      </Show>

      <Show when={explorerNodeMenu()} keyed>
        {(menu) => {
          const connection = connectionMap().get(menu.connectionId);
          const node = connection
            ? findExplorerLeafNode(
                explorerByConnectionId()[menu.connectionId]?.nodes ?? [],
                menu.nodeId,
              )
            : null;
          if (!connection || !node) return null;

          return (
            <div
              class="theme-panel-soft fixed z-[305] inline-grid auto-cols-max overflow-hidden rounded-[18px] border p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
              data-db-menu-root
              style={{
                "border-color": "var(--app-border)",
                left: `${menu.x}px`,
                top: `${menu.y}px`,
              }}
            >
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() =>
                  void openExplorerQuery(connection, node, node.query)
                }
              >
                {getExplorerPreviewMenuLabel(node)}
              </button>
              <Show when={node.countQuery}>
                <button
                  class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                  onClick={() =>
                    void openExplorerQuery(connection, node, node.countQuery!, {
                      titleSuffix: "Count",
                    })
                  }
                >
                  COUNT(*)
                </button>
              </Show>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() =>
                  void openExplorerQuery(connection, node, node.query, {
                    forceNew: true,
                  })
                }
              >
                Open In New Tab
              </button>
            </div>
          );
        }}
      </Show>

      <Show when={tabMenu()} keyed>
        {(menu) => {
          const isPinned = workspace().pinnedTabIds.includes(menu.id);
          return (
            <div
              class="theme-panel-soft fixed z-[310] inline-grid auto-cols-max overflow-hidden rounded-[18px] border p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
              data-db-menu-root
              style={{
                "border-color": "var(--app-border)",
                left: `${menu.x}px`,
                top: `${menu.y}px`,
              }}
            >
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void togglePinnedTab(menu.id)}
              >
                {isPinned ? "Unpin Tab" : "Pin Tab"}
              </button>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void closeOtherTabs(menu.id)}
              >
                Close Others
              </button>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void closeAllTabs()}
              >
                Close All
              </button>
            </div>
          );
        }}
      </Show>

      <Show when={favoriteMenu()} keyed>
        {(menu) => {
          const fav = (workspace().favorites ?? []).find(
            (f) => f.id === menu.id,
          );
          if (!fav) return null;

          return (
            <div
              class="theme-panel-soft fixed z-[310] inline-grid auto-cols-max overflow-hidden rounded-[18px] border p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
              data-db-menu-root
              style={{
                "border-color": "var(--app-border)",
                left: `${menu.x}px`,
                top: `${menu.y}px`,
              }}
            >
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void loadFavoriteIntoTab(fav)}
              >
                Load Query
              </button>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]"
                onClick={() => void removeFavorite(fav.id)}
              >
                Delete Favorite
              </button>
            </div>
          );
        }}
      </Show>
    </>
  );
}
