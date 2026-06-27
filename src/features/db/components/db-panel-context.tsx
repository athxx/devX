import type { JSX } from "solid-js";
import type { SQLNamespace } from "@codemirror/lang-sql";
import type { EditorView } from "@codemirror/view";
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";
import { createStore } from "solid-js/store";
import { arrayMove, cloneValue } from "../../../lib/utils";
import { matchShortcut, type ShortcutOverrides } from "../../../lib/shortcuts";
import { loadSettings } from "../../../lib/storage";
import { loadDbUiStateFromDb, saveDbUiStateToDb } from "../local-db";
import { compactQuery, formatQuery, supportsFormat } from "../format";
import type {
  DbConnection,
  DbConnectionConfig,
  DbConnectionKind,
  DbExecutionState,
  DbExplorerNode,
  DbObjectDetail,
  DbResultPayload,
  DbTab,
  DbTabType,
  DbWorkspaceState,
} from "../models";
import {
  buildPagedSqlObjectQuery,
  buildDbConnectionUrl,
  cancelDbExecution,
  canCancelDbExecution,
  createDbConnection,
  createDbTab,
  disconnectDbConnection,
  executeDbAdHocQuery,
  loadDbObjectDetail,
  loadDbWorkspace,
  loadDbExplorer,
  loadDbExplorerDatabaseChildren,
  loadSchemaCompletionData,
  saveDbWorkspace,
  startDbExecution,
  testDbConnection,
} from "../service";
import { getDbAdapter } from "../adapters";

export type DbPanelProps = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarResizing: boolean;
  onSidebarResizeStart: (event: MouseEvent) => void;
};

type DbConnectionDatabaseTarget = {
  key: string;
  connectionId: string;
  databaseName: string | null;
  label: string;
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

type DatabaseExportModalState = {
  connectionId: string;
  databaseName: string;
};

type DbConnectionModalMode = "create" | "edit";

type ExplorerLoadState = {
  status: "idle" | "loading" | "ready" | "error";
  nodes: DbExplorerNode[];
  error?: string;
};

type ExplorerGroupNode = Extract<DbExplorerNode, { kind: "group" }>;
type ExplorerLeafNode = Exclude<DbExplorerNode, { kind: "group" }>;

export const databaseKinds: DbConnectionKind[] = [
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
  "mariadb",
  "oceanbase",
  "doris",
  "starrocks",
  "cockroachdb",
  "kingbase",
  "opengauss",
  "dameng",
  "elasticsearch",
  "bigtable",
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

export function getConnectionBadge(connection: DbConnection) {
  return getDbAdapter(connection.kind).badge();
}

export function getConnectionTypeLabel(kind: DbConnectionKind) {
  return getDbAdapter(kind).displayName();
}

export function formatResultSize(value: unknown) {
  try {
    return new Blob([JSON.stringify(value ?? null)]).size;
  } catch {
    return 0;
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDefaultTabTypeForConnection(connection: DbConnection): DbTabType {
  return "query";
}

function getDbTabTypeLabel(type: DbTabType) {
  switch (type) {
    case "data":
      return "Data";
    case "structure":
      return "Structure";
    case "redis":
      return "Redis";
    case "mongo":
      return "Mongo";
    case "raw":
      return "Action";
    case "query":
    default:
      return "Query";
  }
}


export function describeConnection(connection: DbConnection) {
  return getDbAdapter(connection.kind).describeConnection(connection);
}

function getEnvironmentBadgeClass(environment: DbConnection["environment"]) {
  switch (environment) {
    case "prod":
      return "bg-[#ffebe9] text-[#b42318]";
    case "staging":
      return "bg-[#fff4e5] text-[#b54708]";
    case "dev":
      return "bg-[#ecfdf3] text-[#067647]";
    default:
      return "bg-[var(--app-accent-soft)] text-[var(--app-accent)]";
  }
}

function formatEnvironmentLabel(environment: DbConnection["environment"]) {
  return environment === "prod"
    ? "PROD"
    : environment === "staging"
      ? "STG"
      : environment === "dev"
        ? "DEV"
        : "LOCAL";
}

function getConnectionSearchText(connection: DbConnection) {
  return [
    connection.name,
    getConnectionTypeLabel(connection.kind),
    connection.environment,
    connection.config.host,
    connection.config.port,
    connection.config.database,
    connection.config.filePath,
    connection.config.serviceName,
  ]
    .join(" ")
    .toLowerCase();
}


export function createDbPanelState(props: DbPanelProps) {
  const [workspace, setWorkspace] = createSignal<DbWorkspaceState>(
    getInitialWorkspace(),
  );
  const [filter, setFilter] = createSignal("");
  const [editorPaneSplit, setEditorPaneSplit] = createSignal(48);
  const [expandedConnectionIds, setExpandedConnectionIds] = createSignal<
    string[]
  >([]);
  const [expandedExplorerNodeIds, setExpandedExplorerNodeIds] = createSignal<
    string[]
  >([]);
  const [explorerByConnectionId, setExplorerByConnectionId] = createSignal<
    Record<string, ExplorerLoadState>
  >({});
  const [schemaCompletionCache, setSchemaCompletionCache] = createSignal<
    Record<string, SQLNamespace>
  >({});
  const [shortcutOverrides, setShortcutOverrides] = createSignal<ShortcutOverrides>({});

  function schemaCompletionKey(
    connectionId: string,
    databaseName?: string | null,
  ) {
    return databaseName ? `${connectionId}::${databaseName}` : connectionId;
  }

  function loadAndCacheSchema(
    connection: DbConnection,
    databaseName?: string | null,
  ) {
    const key = schemaCompletionKey(connection.id, databaseName);
    if (schemaCompletionCache()[key]) return;
    void loadSchemaCompletionData(connection, databaseName).then((schema) => {
      setSchemaCompletionCache((current) => ({ ...current, [key]: schema }));
    });
  }
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
  const [redisKeyNameDraftByTabId, setRedisKeyNameDraftByTabId] = createSignal<
    Record<string, string>
  >({});
  const [redisKeyTtlDraftByTabId, setRedisKeyTtlDraftByTabId] = createSignal<
    Record<string, string>
  >({});
  const [resultViewByTabId, setResultViewByTabId] = createSignal<
    Record<string, "table" | "raw">
  >({});
  const [resultPageByTabId, setResultPageByTabId] = createSignal<
    Record<string, number>
  >({});
  const [resultPageSizeByTabId, setResultPageSizeByTabId] = createSignal<
    Record<string, number>
  >({});
  const [connectionModalMode, setConnectionModalMode] =
    createSignal<DbConnectionModalMode | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = createSignal(false);
  const [databaseExportModal, setDatabaseExportModal] =
    createSignal<DatabaseExportModalState | null>(null);
  const [databaseExportIncludeDrop, setDatabaseExportIncludeDrop] =
    createSignal(true);
  const [databaseExportIncludeCreate, setDatabaseExportIncludeCreate] =
    createSignal(true);
  const [databaseExportBulkInsert, setDatabaseExportBulkInsert] =
    createSignal(true);
  const [databaseExportFormat, setDatabaseExportFormat] = createSignal<
    "sql" | "csv" | "json"
  >("sql");
  const [databaseExportZip, setDatabaseExportZip] = createSignal(false);
  const [loadingExplorerNodeIds, setLoadingExplorerNodeIds] = createSignal<
    string[]
  >([]);
  const [
    selectedExplorerLeafByConnectionId,
    setSelectedExplorerLeafByConnectionId,
  ] = createSignal<Record<string, string>>({});
  const [objectDetailByNodeId, setObjectDetailByNodeId] = createSignal<
    Record<
      string,
      {
        status: "loading" | "ready" | "error";
        detail?: DbObjectDetail;
        error?: string;
      }
    >
  >({});
  const [editedRowsByTabId, setEditedRowsByTabId] = createSignal<
    Record<string, Record<string, Record<string, string>>>
  >({});
  const [rowSavePendingKeys, setRowSavePendingKeys] = createSignal<string[]>(
    [],
  );
  const [executionWarning, setExecutionWarning] = createSignal<string | null>(
    null,
  );
  const [connectionDraftState, setConnectionDraftState] = createStore<{
    value: DbConnection | null;
  }>({
    value: null,
  });
  const [liveQueryByTabId, setLiveQueryByTabId] = createSignal<
    Record<string, string>
  >({});
  let queryPersistTimer: ReturnType<typeof setTimeout> | null = null;
  let activeEditorView: EditorView | null = null;

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

    return connectedConnections().filter((connection) => {
      if (getConnectionSearchText(connection).includes(normalizedFilter())) {
        return true;
      }

      const explorer = explorerByConnectionId()[connection.id];
      return (explorer?.nodes ?? []).some((node) =>
        nodeMatchesFilter(node, normalizedFilter()),
      );
    });
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
  const tabItems = createMemo(() =>
    workspace()
      .openTabIds.map((tabId) => {
        const tab = workspace().tabsById[tabId];
        const connection = tab ? connectionMap().get(tab.connectionId) : null;
        if (!tab || !connection) return null;
        const badge = getConnectionBadge(connection);
        return {
          id: tab.id,
          name: `${tab.title} · ${getDbTabTypeLabel(tab.type)}`,
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

      // Pre-load schema completion data for all connected connections
      // so autocomplete works immediately without expanding the explorer
      const connectionById = new Map(
        loaded.savedConnections.map((c) => [c.id, c]),
      );
      // Collect distinct (connectionId, databaseName) pairs from open tabs
      const seen = new Set<string>();
      for (const tabId of loaded.openTabIds) {
        const tab = loaded.tabsById[tabId];
        if (!tab) continue;
        const conn = connectionById.get(tab.connectionId);
        if (!conn || !loaded.connectedConnectionIds.includes(conn.id)) continue;
        const key = schemaCompletionKey(conn.id, tab.databaseName);
        if (seen.has(key)) continue;
        seen.add(key);
        void loadSchemaCompletionData(conn, tab.databaseName).then((schema) => {
          setSchemaCompletionCache((current) => ({
            ...current,
            [key]: schema,
          }));
        });
      }
      // Also load for connections with no open tabs (base database)
      for (const connId of loaded.connectedConnectionIds) {
        const conn = connectionById.get(connId);
        if (!conn) continue;
        const key = schemaCompletionKey(conn.id, null);
        if (seen.has(key)) continue;
        seen.add(key);
        void loadSchemaCompletionData(conn).then((schema) => {
          setSchemaCompletionCache((current) => ({
            ...current,
            [key]: schema,
          }));
        });
      }
    });

    void loadDbUiStateFromDb().then((uiState) => {
      const editorSplitParsed = Number(uiState?.editorPaneSplit);
      if (
        Number.isFinite(editorSplitParsed) &&
        editorSplitParsed >= 20 &&
        editorSplitParsed <= 80
      ) {
        setEditorPaneSplit(editorSplitParsed);
      }
    });

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-db-menu-root]")) {
        return;
      }

      setConnectionMenu(null);
      setExplorerNodeMenu(null);
      setTabMenu(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);

    void loadSettings().then((s) => setShortcutOverrides(s.shortcutOverrides));

    const handleKeyDown = (event: KeyboardEvent) => {
      const overrides = shortcutOverrides();
      if (matchShortcut(event, "closeTab", overrides)) {
        event.preventDefault();
        const tabId = workspace().activeTabId;
        if (tabId) void closeTab(tabId);
        return;
      }
      if (matchShortcut(event, "runQuery", overrides)) {
        event.preventDefault();
        void runCurrentTab();
        return;
      }
      const connection = activeConnection();
      if (connection && supportsFormat(connection.kind)) {
        if (matchShortcut(event, "compactQuery", overrides)) {
          event.preventDefault();
          const text = getEffectiveQuery();
          applyTextResult(compactQuery(connection.kind, text));
          return;
        }
        if (matchShortcut(event, "formatQuery", overrides)) {
          event.preventDefault();
          const text = getEffectiveQuery();
          void formatQuery(connection.kind, text).then(applyTextResult);
          return;
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    onCleanup(() => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      if (queryPersistTimer !== null) {
        clearTimeout(queryPersistTimer);
      }
    });
  });

  createEffect(() => {
    void saveDbUiStateToDb({
      editorPaneSplit: editorPaneSplit(),
    });
  });

  createEffect(() => {
    const tabId = activeTab()?.id;
    setExecutionWarning(null);

    // Flush pending edits from the previous tab
    if (queryPersistTimer !== null) {
      clearTimeout(queryPersistTimer);
      queryPersistTimer = null;
    }
    for (const id of Object.keys(liveQueryByTabId())) {
      if (id !== tabId) {
        flushLiveQuery(id);
      }
    }
  });

  // Ensure schema completion data is loaded for the active tab's database
  createEffect(() => {
    const tab = activeTab();
    const conn = activeConnection();
    if (!tab || !conn) return;
    loadAndCacheSchema(conn, tab.databaseName);
  });

  createEffect(() => {
    const tab = activeTab();
    if (!tab || tab.type !== "redis" || tab.source?.nodeKind !== "key") {
      return;
    }

    const detail = getTabObjectDetail(tab) ?? getActiveObjectDetail();
    const ttl = getDetailSummaryValue(detail, "TTL") || "-1";

    setRedisKeyNameDraftByTabId((current) => ({
      ...current,
      [tab.id]: current[tab.id] ?? tab.source?.label ?? "",
    }));
    setRedisKeyTtlDraftByTabId((current) => ({
      ...current,
      [tab.id]: current[tab.id] ?? ttl,
    }));
  });

  async function commitWorkspace(mutator: (draft: DbWorkspaceState) => void) {
    const next = cloneValue(workspace());
    const live = liveQueryByTabId();
    for (const [tabId, query] of Object.entries(live)) {
      if (next.tabsById[tabId]) {
        next.tabsById[tabId].query = query;
      }
    }
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

      // Load schema completion for this specific database
      loadAndCacheSchema(connection, node.label);

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
      setLoadingExplorerNodeIds((prev) => prev.filter((id) => id !== node.id));
    }
  }

  async function loadConnectionExplorer(
    connection: DbConnection,
    options?: {
      preferredRoot?: {
        label: string;
        groupKind: ExplorerGroupNode["groupKind"];
      } | null;
      preferredLeaf?: {
        kind: ExplorerLeafNode["kind"];
        label: string;
        qualifiedName?: string;
      } | null;
    },
  ) {
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

      // Load schema completion data in background (non-blocking)
      loadAndCacheSchema(connection);

      if (options?.preferredLeaf) {
        const matchingLeaf = findMatchingExplorerLeaf(
          nodes,
          options.preferredLeaf,
        );
        if (matchingLeaf) {
          setSelectedExplorerLeafByConnectionId((current) => ({
            ...current,
            [connection.id]: matchingLeaf.id,
          }));
        }
      }
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
      willExpand
        ? [...current, connection.id]
        : current.filter((id) => id !== connection.id),
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

  async function selectConnectedConnection(connection: DbConnection) {
    await commitWorkspace((draft) => {
      draft.activeConnectionId = connection.id;
    });
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

  function findExplorerNode(
    nodes: DbExplorerNode[],
    nodeId: string,
  ): DbExplorerNode | null {
    for (const node of nodes) {
      if (node.id === nodeId) {
        return node;
      }

      if (node.kind === "group") {
        const nested = findExplorerNode(node.children, nodeId);
        if (nested) {
          return nested;
        }
      }
    }

    return null;
  }

  function findMatchingExplorerLeaf(
    nodes: DbExplorerNode[],
    preferredLeaf: {
      kind: ExplorerLeafNode["kind"];
      label: string;
      qualifiedName?: string;
    },
  ): ExplorerLeafNode | null {
    for (const node of nodes) {
      if (node.kind === "group") {
        const nested = findMatchingExplorerLeaf(node.children, preferredLeaf);
        if (nested) {
          return nested;
        }
        continue;
      }

      if (
        node.kind === preferredLeaf.kind &&
        node.label === preferredLeaf.label &&
        (preferredLeaf.qualifiedName
          ? node.qualifiedName === preferredLeaf.qualifiedName
          : true)
      ) {
        return node;
      }
    }

    return null;
  }

  function getExplorerPreviewMenuLabel(node: ExplorerLeafNode) {
    switch (node.kind) {
      case "function":
        return "Open Function Snippet";
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

  function getFirstDatabaseNode(connection: DbConnection | null): ExplorerGroupNode | null {
    if (!connection) return null;
    const explorer = explorerByConnectionId()[connection.id];
    const nodes = explorer?.nodes ?? [];
    return (nodes.find((node) => node.kind === "group") as ExplorerGroupNode | undefined) ?? null;
  }

  function getSelectedExplorerLeaf(connection: DbConnection | null) {
    if (!connection) return null;
    const selectedId = selectedExplorerLeafByConnectionId()[connection.id];
    if (!selectedId) return null;
    return findExplorerLeafNode(
      explorerByConnectionId()[connection.id]?.nodes ?? [],
      selectedId,
    );
  }

  function buildSourceFromNode(
    node: ExplorerLeafNode,
  ): DbTab["source"] | undefined {
    return {
      nodeId: node.id,
      nodeKind: node.kind,
      label: node.label,
      schemaName: node.schemaName,
      qualifiedName: node.qualifiedName,
      page: 1,
      pageSize: node.kind === "table" || node.kind === "view" ? 50 : 1,
    };
  }

  function getNodeOpenQuery(connection: DbConnection, node: ExplorerLeafNode) {
    const source = buildSourceFromNode(node);
    if (source) {
      return buildPagedSqlObjectQuery(
        connection,
        source.schemaName ?? "public",
        source.label,
        source.page,
        source.pageSize,
      );
    }

    return node.query;
  }

  function getDefaultSchemaName(connection: DbConnection): string | undefined {
    return getDbAdapter(connection.kind).defaultCompletionSchema(connection) ?? undefined;
  }

  function buildExplorerStructureQuery(
    connection: DbConnection,
    node: ExplorerLeafNode,
  ) {
    return getDbAdapter(connection.kind).buildStructureQuery(node);
  }

  function buildExplorerShowSqlQuery(
    connection: DbConnection,
    node: ExplorerLeafNode,
  ) {
    return getDbAdapter(connection.kind).buildShowSqlQuery(node);
  }

  function buildExplorerRenameQuery(
    connection: DbConnection,
    node: ExplorerLeafNode,
  ) {
    return getDbAdapter(connection.kind).buildRenameQuery(node);
  }

  function buildExplorerTruncateQuery(
    connection: DbConnection,
    node: ExplorerLeafNode,
  ) {
    return getDbAdapter(connection.kind).buildTruncateQuery(node);
  }

  async function copyExplorerNodeName(node: ExplorerLeafNode) {
    const value = node.qualifiedName ?? node.label;
    if (!navigator?.clipboard?.writeText) {
      return;
    }
    await navigator.clipboard.writeText(value);
    closeFloatingMenus();
  }

  async function copyTextValue(value: string) {
    if (!navigator?.clipboard?.writeText) {
      return;
    }
    await navigator.clipboard.writeText(value);
    closeFloatingMenus();
  }

  function resolveConnectionActionTabType(
    connection: DbConnection,
    options?: {
      tabType?: DbTabType;
    },
  ): DbTabType {
    if (options?.tabType) {
      return options.tabType;
    }

    return "raw";
  }

  function resolveExplorerTabType(
    connection: DbConnection,
    node: ExplorerLeafNode,
    options?: {
      titleSuffix?: string;
      source?: DbTab["source"];
      tabType?: DbTabType;
    },
  ): DbTabType {
    if (options?.tabType) {
      return options.tabType;
    }

    if (options?.source) {
      if (node.kind === "table" || node.kind === "view") {
        return "data";
      }

      if (node.kind === "key") {
        return "redis";
      }

      if (node.kind === "collection") {
        return "mongo";
      }
    }

    if (
      options?.titleSuffix === "Structure" ||
      options?.titleSuffix === "SQL"
    ) {
      return "structure";
    }

    if (node.kind === "function") {
      return "structure";
    }

    return "query";
  }

  function resolveExplorerDatabaseName(
    connection: DbConnection,
    node: ExplorerLeafNode,
    options?: {
      databaseName?: string | null;
      source?: DbTab["source"];
    },
  ) {
    if (options?.databaseName !== undefined) {
      return options.databaseName;
    }

    if (getDbAdapter(connection.kind).treatsSchemaAsDatabase()) {
      return (
        options?.source?.schemaName ??
        node.schemaName ??
        getDefaultDatabaseForConnection(connection)
      );
    }

    return (
      getDefaultDatabaseForConnection(connection) ??
      (connection.config.database.trim() || null)
    );
  }

  async function openConnectionActionQuery(
    connection: DbConnection,
    label: string,
    query: string,
    options?: {
      forceNew?: boolean;
      resultView?: "table" | "raw";
      tabType?: DbTabType;
      databaseName?: string | null;
    },
  ) {
    const forceNew = options?.forceNew ?? true;
    const tabType = resolveConnectionActionTabType(connection, options);
    const databaseName =
      options?.databaseName ?? getDefaultDatabaseForConnection(connection);
    const activeTabId = workspace().activeTabId;
    const existingId = !forceNew
      ? activeTabId &&
        workspace().tabsById[activeTabId]?.connectionId === connection.id &&
        workspace().tabsById[activeTabId]?.type === tabType &&
        (workspace().tabsById[activeTabId]?.databaseName ?? null) ===
          databaseName
        ? activeTabId
        : (workspace().openTabIds.find(
            (tabId) =>
              workspace().tabsById[tabId]?.connectionId === connection.id &&
              workspace().tabsById[tabId]?.type === tabType &&
              (workspace().tabsById[tabId]?.databaseName ?? null) ===
                databaseName,
          ) ?? null)
      : null;
    const title = `${connection.name} · ${label}`;
    let nextActiveTabId: string | null = existingId;

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
        draft.tabsById[existingId].type = tabType;
        draft.tabsById[existingId].databaseName = databaseName;
        draft.activeTabId = existingId;
        return;
      }

      const tab = createDbTab(connection, tabType);
      tab.title = title;
      tab.query = query;
      tab.databaseName = databaseName;
      draft.tabsById[tab.id] = tab;
      draft.openTabIds.push(tab.id);
      draft.activeTabId = tab.id;
      nextActiveTabId = tab.id;
    });

    if (options?.resultView && nextActiveTabId) {
      setResultViewByTabId((current) => ({
        ...current,
        [nextActiveTabId!]: options.resultView!,
      }));
    }

    closeFloatingMenus();
  }

  function canCreateDatabase(connection: DbConnection) {
    return getDbAdapter(connection.kind).canCreateDatabase();
  }

  function canShowConnectionSummary(connection: DbConnection) {
    return getDbAdapter(connection.kind).canShowConnectionSummary();
  }

  function buildCreateDatabaseTemplate(connection: DbConnection) {
    return getDbAdapter(connection.kind).buildCreateDatabaseTemplate();
  }

  function buildCreateTableTemplate(
    connection: DbConnection,
    databaseName: string,
  ) {
    return getDbAdapter(connection.kind).buildCreateTableTemplate(databaseName);
  }

  function buildImportTemplate(
    connection: DbConnection,
    databaseName: string,
    source: "sql" | "json" | "csv",
  ) {
    return getDbAdapter(connection.kind).buildImportTemplate(
      databaseName,
      source,
    );
  }

  function buildDropDatabaseTemplate(
    connection: DbConnection,
    databaseName: string,
  ) {
    return getDbAdapter(connection.kind).buildDropDatabaseTemplate(databaseName);
  }

  function openDatabaseExportModal(connectionId: string, databaseName: string) {
    setDatabaseExportIncludeDrop(true);
    setDatabaseExportIncludeCreate(true);
    setDatabaseExportBulkInsert(true);
    setDatabaseExportFormat("sql");
    setDatabaseExportZip(false);
    setDatabaseExportModal({ connectionId, databaseName });
    closeFloatingMenus();
  }

  function closeDatabaseExportModal() {
    setDatabaseExportModal(null);
  }

  function downloadDatabaseExport() {
    const modal = databaseExportModal();
    if (!modal) {
      return;
    }

    const connection = connectionMap().get(modal.connectionId);
    if (!connection) {
      return;
    }

    const format = databaseExportFormat();
    const extension = databaseExportZip() ? `${format}.zip` : format;
    const content = [
      `-- Export plan for ${modal.databaseName}`,
      `-- Format: ${format}`,
      `-- Include DROP: ${databaseExportIncludeDrop() ? "yes" : "no"}`,
      `-- Include CREATE: ${databaseExportIncludeCreate() ? "yes" : "no"}`,
      `-- Bulk insert: ${databaseExportBulkInsert() ? "yes" : "no"}`,
      "",
      format === "sql"
        ? `${databaseExportIncludeDrop() ? `${buildDropDatabaseTemplate(connection, modal.databaseName)}\n` : ""}${databaseExportIncludeCreate() ? buildCreateTableTemplate(connection, modal.databaseName) : ""}`
        : format === "json"
          ? JSON.stringify(
              {
                database: modal.databaseName,
                includeDrop: databaseExportIncludeDrop(),
                includeCreate: databaseExportIncludeCreate(),
                bulkInsert: databaseExportBulkInsert(),
              },
              null,
              2,
            )
          : `database,includeDrop,includeCreate,bulkInsert\n${modal.databaseName},${databaseExportIncludeDrop()},${databaseExportIncludeCreate()},${databaseExportBulkInsert()}`,
    ].join("\n");

    const blob = new Blob([content], {
      type:
        format === "json"
          ? "application/json;charset=utf-8"
          : "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${modal.databaseName}-export.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
    closeDatabaseExportModal();
  }

  function buildConnectionSummaryQuery(connection: DbConnection) {
    return getDbAdapter(connection.kind).buildConnectionSummaryQuery();
  }

  async function openExplorerQuery(
    connection: DbConnection,
    node: ExplorerLeafNode,
    query: string,
    options?: {
      forceNew?: boolean;
      titleSuffix?: string;
      resultView?: "table" | "raw";
      source?: DbTab["source"];
      tabType?: DbTabType;
      databaseName?: string | null;
    },
  ) {
    const forceNew = options?.forceNew ?? false;
    const tabType = resolveExplorerTabType(connection, node, options);
    const databaseName = resolveExplorerDatabaseName(connection, node, options);
    const activeTabId = workspace().activeTabId;
    const existingId = !forceNew
      ? activeTabId &&
        workspace().tabsById[activeTabId]?.connectionId === connection.id &&
        workspace().tabsById[activeTabId]?.type === tabType &&
        (workspace().tabsById[activeTabId]?.databaseName ?? null) ===
          databaseName
        ? activeTabId
        : (workspace().openTabIds.find(
            (tabId) =>
              workspace().tabsById[tabId]?.connectionId === connection.id &&
              workspace().tabsById[tabId]?.type === tabType &&
              (workspace().tabsById[tabId]?.databaseName ?? null) ===
                databaseName,
          ) ?? null)
      : null;
    const title = `${connection.name} · ${node.label}${
      options?.titleSuffix ? ` · ${options.titleSuffix}` : ""
    }`;
    let nextActiveTabId: string | null = existingId;

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
        draft.tabsById[existingId].type = tabType;
        draft.tabsById[existingId].databaseName = databaseName;
        draft.tabsById[existingId].source = options?.source;
        draft.activeTabId = existingId;
        return;
      }

      const tab = createDbTab(connection, tabType);
      tab.title = title;
      tab.query = query;
      tab.type = tabType;
      tab.databaseName = databaseName;
      tab.source = options?.source;
      draft.tabsById[tab.id] = tab;
      draft.openTabIds.push(tab.id);
      draft.activeTabId = tab.id;
      nextActiveTabId = tab.id;
    });

    if (options?.resultView && nextActiveTabId) {
      setResultViewByTabId((current) => ({
        ...current,
        [nextActiveTabId!]: options.resultView!,
      }));
    }

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

    setSelectedExplorerLeafByConnectionId((current) => ({
      ...current,
      [connection.id]: node.id,
    }));
    void inspectExplorerLeaf(connection, node);
    await openExplorerQuery(
      connection,
      node,
      getNodeOpenQuery(connection, node),
      {
        forceNew: true,
        source: buildSourceFromNode(node),
      },
    );
  }

  async function inspectExplorerLeaf(
    connection: DbConnection,
    node: ExplorerLeafNode,
  ) {
    setSelectedExplorerLeafByConnectionId((current) => ({
      ...current,
      [connection.id]: node.id,
    }));
    setObjectDetailByNodeId((current) => ({
      ...current,
      [node.id]: {
        status: current[node.id]?.status === "ready" ? "ready" : "loading",
        detail: current[node.id]?.detail,
      },
    }));

    try {
      const detail = await loadDbObjectDetail(connection, node);
      setObjectDetailByNodeId((current) => ({
        ...current,
        [node.id]: { status: "ready", detail },
      }));
      await commitWorkspace((draft) => {
        draft.activeConnectionId = connection.id;
      });
    } catch (error) {
      setObjectDetailByNodeId((current) => ({
        ...current,
        [node.id]: {
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to load object details.",
        },
      }));
    } finally {
      closeFloatingMenus();
    }
  }

  async function cancelCurrentExecution() {
    const tab = activeTab();
    if (!tab) return;
    const execution = executionByTabId()[tab.id];
    if (!canCancelDbExecution(execution)) return;
    const requestId =
      execution.status === "running" ? execution.requestId : null;
    if (!requestId) return;

    try {
      await cancelDbExecution(requestId);
      setExecutionByTabId((current) => ({
        ...current,
        [tab.id]: { status: "error", message: "Query cancelled." },
      }));
    } catch (error) {
      setExecutionWarning(
        error instanceof Error ? error.message : "Failed to cancel query.",
      );
    }
  }

  function getActiveResultRows() {
    const tab = activeTab();
    if (!tab) return [] as Array<Record<string, unknown>>;
    const result = resultByTabId()[tab.id];
    return result?.kind === "sql" ? (result.data.rows ?? []) : [];
  }

  function getResultPageSize(tabId: string) {
    return resultPageSizeByTabId()[tabId] ?? 50;
  }

  function getResultPage(tabId: string) {
    return resultPageByTabId()[tabId] ?? 1;
  }

  async function copyCurrentResult() {
    const tab = activeTab();
    if (!tab || !navigator?.clipboard?.writeText) return;
    const result = resultByTabId()[tab.id];
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result.data, null, 2));
  }

  function exportCurrentResult(format: "json" | "csv") {
    const tab = activeTab();
    if (!tab) return;
    const result = resultByTabId()[tab.id];
    if (!result) return;

    let content = "";
    let type = "application/json;charset=utf-8";
    let extension = format;

    if (format === "csv" && result.kind === "sql") {
      const columns = result.data.columns ?? [];
      const rows = result.data.rows ?? [];
      content = [
        columns.join(","),
        ...rows.map((row) =>
          columns
            .map((column) =>
              JSON.stringify(row[column] ?? "").replace(/^"|"$/g, ""),
            )
            .join(","),
        ),
      ].join("\n");
      type = "text/csv;charset=utf-8";
    } else {
      content = JSON.stringify(result.data, null, 2);
    }

    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${tab.title.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "result"}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function getActiveObjectDetail() {
    const connection = activeConnection();
    const leaf = getSelectedExplorerLeaf(connection);
    return leaf ? objectDetailByNodeId()[leaf.id]?.detail : undefined;
  }

  function getTabObjectDetail(tab: DbTab | null) {
    if (!tab?.source?.nodeId) return undefined;
    return objectDetailByNodeId()[tab.source.nodeId]?.detail;
  }

  function getDetailSummaryValue(
    detail: DbObjectDetail | undefined,
    label: string,
  ) {
    return detail?.summary.find((item) => item.label === label)?.value ?? "";
  }

  function getSameKindConnections(connection: DbConnection | null) {
    if (!connection) {
      return [] as DbConnection[];
    }

    return connectedConnections().filter(
      (item) => item.kind === connection.kind,
    );
  }

  function formatConnectionDatabaseLabel(
    connection: DbConnection,
    databaseName: string | null,
  ) {
    const instanceLabel =
      connection.name ||
      connection.config.host ||
      getConnectionTypeLabel(connection.kind);
    return databaseName?.trim()
      ? `${instanceLabel} - ${databaseName.trim()}`
      : instanceLabel;
  }

  function getDefaultDatabaseForConnection(connection: DbConnection) {
    const firstDb = getFirstDatabaseNode(connection);
    if (firstDb?.groupKind === "database") {
      return firstDb.label;
    }

    return connection.config.database.trim() || null;
  }

  function buildDatabaseTargetKey(
    connectionId: string,
    databaseName: string | null,
  ) {
    return JSON.stringify({ connectionId, databaseName: databaseName ?? null });
  }

  function getSameKindDatabaseTargets(
    connection: DbConnection | null,
    currentTarget?: {
      connectionId: string;
      databaseName: string | null;
    } | null,
  ): DbConnectionDatabaseTarget[] {
    if (!connection) {
      return [];
    }

    const targets = getSameKindConnections(connection).flatMap((item) => {
      const explorerNodes = explorerByConnectionId()[item.id]?.nodes ?? [];
      const databaseRoots = explorerNodes.filter(
        (node): node is ExplorerGroupNode =>
          node.kind === "group" && node.groupKind === "database",
      );

      if (databaseRoots.length > 0) {
        return databaseRoots.map((node) => ({
          key: buildDatabaseTargetKey(item.id, node.label),
          connectionId: item.id,
          databaseName: node.label,
          label: formatConnectionDatabaseLabel(item, node.label),
        }));
      }

      const databaseName = item.config.database.trim() || null;
      return [
        {
          key: buildDatabaseTargetKey(item.id, databaseName),
          connectionId: item.id,
          databaseName,
          label: formatConnectionDatabaseLabel(item, databaseName),
        },
      ];
    });

    if (currentTarget) {
      const exists = targets.some(
        (item) =>
          item.connectionId === currentTarget.connectionId &&
          item.databaseName === currentTarget.databaseName,
      );

      if (!exists) {
        const currentConnection = connectionMap().get(
          currentTarget.connectionId,
        );
        if (currentConnection) {
          targets.unshift({
            key: buildDatabaseTargetKey(
              currentTarget.connectionId,
              currentTarget.databaseName,
            ),
            connectionId: currentTarget.connectionId,
            databaseName: currentTarget.databaseName,
            label: formatConnectionDatabaseLabel(
              currentConnection,
              currentTarget.databaseName,
            ),
          });
        }
      }
    }

    return targets;
  }

  async function switchActiveTabConnectionTarget(targetKey: string) {
    const tab = activeTab();
    const currentConnection = activeConnection();
    const parsed = JSON.parse(targetKey) as {
      connectionId?: string;
      databaseName?: string | null;
    };
    const nextConnectionId = parsed.connectionId ?? "";
    const nextDatabaseName = parsed.databaseName?.trim() || null;
    const nextConnection = connectionMap().get(nextConnectionId);
    if (!tab || !nextConnection) {
      return;
    }

    if (
      tab.connectionId === nextConnectionId &&
      (tab.databaseName?.trim() || null) === nextDatabaseName
    ) {
      return;
    }

    await commitWorkspace((draft) => {
      const targetTab = draft.tabsById[tab.id];
      if (!targetTab) {
        return;
      }
      targetTab.connectionId = nextConnectionId;
      targetTab.databaseName = nextDatabaseName;
      if (currentConnection) {
        const currentPrefix = `${currentConnection.name} · `;
        if (targetTab.title.startsWith(currentPrefix)) {
          targetTab.title = `${nextConnection.name} · ${targetTab.title.slice(currentPrefix.length)}`;
        } else if (targetTab.title === currentConnection.name) {
          targetTab.title = nextConnection.name;
        }
      }
      draft.activeConnectionId = nextConnectionId;
    });
  }

  function getCurrentConnectionHistory(connectionId: string | null) {
    if (!connectionId) {
      return [] as DbWorkspaceState["history"];
    }

    return workspace().history.filter(
      (item) => item.connectionId === connectionId,
    );
  }

  async function appendHistoryQueryToCurrentTab(query: string) {
    const tab = activeTab();
    if (!tab) return;

    await commitWorkspace((draft) => {
      const currentQuery = draft.tabsById[tab.id]?.query ?? "";
      draft.tabsById[tab.id].query = currentQuery.trim()
        ? `${currentQuery.trimEnd()}\n\n${query}`
        : query;
    });

    setHistoryModalOpen(false);
  }

  function getRedisKeyTypeClass(type: string) {
    switch (type.toLowerCase()) {
      case "string":
        return "bg-[rgba(59,130,246,0.12)] text-[#1d4ed8]";
      case "hash":
        return "bg-[rgba(34,197,94,0.12)] text-[#15803d]";
      case "zset":
        return "bg-[rgba(168,85,247,0.12)] text-[#7e22ce]";
      case "set":
        return "bg-[rgba(249,115,22,0.12)] text-[#c2410c]";
      case "list":
        return "bg-[rgba(236,72,153,0.12)] text-[#be185d]";
      case "stream":
        return "bg-[rgba(14,165,233,0.12)] text-[#0369a1]";
      default:
        return "bg-[rgba(148,163,184,0.18)] text-[#475569]";
    }
  }

  async function refreshRedisKeyTab() {
    const tab = activeTab();
    const connection = activeConnection();
    if (!tab || !connection || tab.type !== "redis") {
      return;
    }

    if (tab.source?.nodeId) {
      const node = findMatchingExplorerLeaf(
        explorerByConnectionId()[connection.id]?.nodes ?? [],
        {
          kind: "key",
          label: tab.source.label,
          qualifiedName: tab.source.qualifiedName,
        },
      );
      if (node) {
        await inspectExplorerLeaf(connection, node);
      }
    }

    await runCurrentTab();
  }

  async function saveRedisKey() {
    const tab = activeTab();
    const connection = activeConnection();
    if (
      !tab ||
      !connection ||
      tab.type !== "redis" ||
      tab.source?.nodeKind !== "key"
    ) {
      return;
    }

    const nextName = (redisKeyNameDraftByTabId()[tab.id] ?? "").trim();
    const nextTtl = Number(redisKeyTtlDraftByTabId()[tab.id] ?? "-1");
    const currentName = tab.source.label;
    if (!nextName || Number.isNaN(nextTtl) || nextTtl < -1) {
      return;
    }

    if (nextName !== currentName) {
      await executeDbAdHocQuery(
        connection,
        `RENAME ${JSON.stringify(currentName)} ${JSON.stringify(nextName)}`,
        "redis",
      );
    }

    const targetKey = nextName || currentName;
    if (nextTtl === -1) {
      await executeDbAdHocQuery(
        connection,
        `PERSIST ${JSON.stringify(targetKey)}`,
        "redis",
      );
    } else {
      await executeDbAdHocQuery(
        connection,
        `EXPIRE ${JSON.stringify(targetKey)} ${nextTtl}`,
        "redis",
      );
    }

    await commitWorkspace((draft) => {
      const target = draft.tabsById[tab.id];
      if (!target) return;
      target.title = `${connection.name} · ${nextName}`;
      target.query = `TYPE ${JSON.stringify(nextName)}`;
      if (target.source) {
        target.source.label = nextName;
      }
    });

    await refreshConnectionExplorer(connection);
    await runCurrentTab();
  }

  async function deleteRedisKey() {
    const tab = activeTab();
    const connection = activeConnection();
    if (
      !tab ||
      !connection ||
      tab.type !== "redis" ||
      tab.source?.nodeKind !== "key"
    ) {
      return;
    }

    const keyName = tab.source.label;
    if (!window.confirm(`Delete redis key \"${keyName}\"?`)) {
      return;
    }

    await executeDbAdHocQuery(
      connection,
      `DEL ${JSON.stringify(keyName)}`,
      "redis",
    );
    await refreshConnectionExplorer(connection);
    await closeTab(tab.id);
  }

  function getEditedRows(tabId: string) {
    return editedRowsByTabId()[tabId] ?? {};
  }

  function getRowKey(row: Record<string, unknown>, _index: number) {
    return JSON.stringify(row);
  }

  function getVisibleRowValue(
    tabId: string,
    row: Record<string, unknown>,
    index: number,
    column: string,
  ) {
    const rowKey = getRowKey(row, index);
    const edited = getEditedRows(tabId)[rowKey]?.[column];
    if (edited != null) return edited;
    const value = row[column];
    if (value == null) return "NULL";
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  }

  function updateEditedCell(
    tabId: string,
    row: Record<string, unknown>,
    index: number,
    column: string,
    value: string,
  ) {
    const rowKey = getRowKey(row, index);
    setEditedRowsByTabId((current) => ({
      ...current,
      [tabId]: {
        ...(current[tabId] ?? {}),
        [rowKey]: {
          ...((current[tabId] ?? {})[rowKey] ?? {}),
          [column]: value,
        },
      },
    }));
  }

  function resetEditedRow(tabId: string, rowKey: string) {
    setEditedRowsByTabId((current) => ({
      ...current,
      [tabId]: Object.fromEntries(
        Object.entries(current[tabId] ?? {}).filter(([key]) => key !== rowKey),
      ),
    }));
  }

  function sqlLiteral(value: unknown) {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (typeof value === "object") {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }
    const raw = String(value);
    if (raw === "null") return "NULL";
    if (/^-?\d+(\.\d+)?$/u.test(raw)) return raw;
    return `'${raw.replace(/'/g, "''")}'`;
  }

  async function rerunPagedSourceTab(tabId: string, page: number) {
    const tab = workspace().tabsById[tabId];
    const connection = tab ? connectionMap().get(tab.connectionId) : null;
    if (!tab?.source || !connection) return;
    if (tab.source.nodeKind !== "table" && tab.source.nodeKind !== "view")
      return;

    const query = buildPagedSqlObjectQuery(
      connection,
      tab.source.schemaName ?? "public",
      tab.source.label,
      page,
      tab.source.pageSize,
    );

    await commitWorkspace((draft) => {
      const target = draft.tabsById[tabId];
      if (!target?.source) return;
      target.query = query;
      target.source.page = page;
    });

    if (workspace().activeTabId === tabId) {
      await runCurrentTab();
    }
  }

  async function saveEditedRow(rowKey: string) {
    const tab = activeTab();
    const connection = activeConnection();
    const detail = getActiveObjectDetail();
    const rows = getActiveResultRows();
    if (!tab || !connection || !detail?.primaryKeys?.length || !tab.source)
      return;
    const rowIndex = rows.findIndex(
      (row, index) => getRowKey(row, index) === rowKey,
    );
    if (rowIndex < 0) return;

    const original = rows[rowIndex];
    const edited = getEditedRows(tab.id)[rowKey] ?? {};
    const changedEntries = Object.entries(edited).filter(
      ([column, value]) =>
        value !== JSON.stringify(original[column] ?? null, null, 2),
    );
    if (changedEntries.length === 0) return;

    const setClause = changedEntries
      .map(([column, value]) => `${column} = ${sqlLiteral(value)}`)
      .join(", ");
    const whereClause = detail.primaryKeys
      .map((column) => `${column} = ${sqlLiteral(original[column])}`)
      .join(" AND ");

    setRowSavePendingKeys((current) => [...current, rowKey]);
    try {
      await commitWorkspace((draft) => {
        draft.tabsById[tab.id].query =
          `UPDATE ${tab.source?.qualifiedName ?? tab.source?.label}
SET ${setClause}
WHERE ${whereClause};`;
      });
      await runCurrentTab();
      await rerunPagedSourceTab(tab.id, tab.source.page);
      resetEditedRow(tab.id, rowKey);
    } finally {
      setRowSavePendingKeys((current) =>
        current.filter((key) => key !== rowKey),
      );
    }
  }

  function resetConnectionExplorer(connectionId: string) {
    setExpandedConnectionIds((current) =>
      current.filter((id) => id !== connectionId),
    );
    setSelectedExplorerLeafByConnectionId((current) => {
      const next = { ...current };
      delete next[connectionId];
      return next;
    });
    setExplorerByConnectionId((current) => {
      const next = { ...current };
      delete next[connectionId];
      return next;
    });
  }

  async function refreshConnectionExplorer(connection: DbConnection) {
    const selectedLeaf = getSelectedExplorerLeaf(connection);
    const firstDb = getFirstDatabaseNode(connection);

    setExpandedExplorerNodeIds([]);
    closeFloatingMenus();

    await loadConnectionExplorer(connection, {
      preferredRoot: firstDb
        ? { label: firstDb.label, groupKind: firstDb.groupKind }
        : null,
      preferredLeaf: selectedLeaf
        ? {
            kind: selectedLeaf.kind,
            label: selectedLeaf.label,
            qualifiedName: selectedLeaf.qualifiedName,
          }
        : null,
    });
  }

  async function resetConnectionExplorerCache(connection: DbConnection) {
    setExpandedExplorerNodeIds([]);
    setSelectedExplorerLeafByConnectionId((current) => {
      const next = { ...current };
      delete next[connection.id];
      return next;
    });
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
    setResultPageByTabId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tabId]) => !tabIds.includes(tabId)),
      ),
    );
    setResultPageSizeByTabId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tabId]) => !tabIds.includes(tabId)),
      ),
    );
  }

  function closeFloatingMenus() {
    setConnectionMenu(null);
    setExplorerNodeMenu(null);
    setTabMenu(null);
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
      url: buildDbConnectionUrl(draftConnection),
      defaultQuery: createDbConnection(draftConnection.kind).defaultQuery,
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

  function getTabQuery(tab: DbTab): string {
    return liveQueryByTabId()[tab.id] ?? tab.query;
  }

  function flushLiveQuery(tabId: string) {
    const live = liveQueryByTabId()[tabId];
    if (live === undefined) return;
    const current = workspace();
    if (current.tabsById[tabId] && current.tabsById[tabId].query !== live) {
      const next = cloneValue(current);
      next.tabsById[tabId].query = live;
      void saveDbWorkspace(next);
    }
  }

  function updateActiveQuery(query: string) {
    const tab = activeTab();
    if (!tab) return;

    setLiveQueryByTabId((current) => ({ ...current, [tab.id]: query }));

    if (queryPersistTimer !== null) {
      clearTimeout(queryPersistTimer);
    }
    queryPersistTimer = setTimeout(() => {
      queryPersistTimer = null;
      flushLiveQuery(tab.id);
    }, 600);
  }

  /** Returns the current editor selection range, or null if nothing is selected. */
  function getEditorSelection(): { from: number; to: number } | null {
    const ev = activeEditorView;
    if (!ev) return null;
    const { from, to } = ev.state.selection.main;
    return from === to ? null : { from, to };
  }

  /** Returns selected text if there is a selection, otherwise the full live query. */
  function getEffectiveQuery(): string {
    const ev = activeEditorView;
    const sel = getEditorSelection();
    if (ev && sel) return ev.state.sliceDoc(sel.from, sel.to);
    const tab = activeTab();
    return tab ? getTabQuery(tab) : "";
  }

  /**
   * Apply a text result back to the editor.
   * If there was a selection, replaces just the selection.
   * Otherwise replaces the full document via updateActiveQuery.
   */
  function applyTextResult(newText: string) {
    const ev = activeEditorView;
    const sel = getEditorSelection();
    if (ev && sel) {
      ev.dispatch({ changes: { from: sel.from, to: sel.to, insert: newText } });
    } else {
      updateActiveQuery(newText);
    }
  }

  async function openConnectionTab(
    connection: DbConnection,
    forceNew = false,
    databaseName = getDefaultDatabaseForConnection(connection),
  ) {
    const tabType = getDefaultTabTypeForConnection(connection);
    const existingId = !forceNew
      ? (workspace().openTabIds.find(
          (tabId) =>
            workspace().tabsById[tabId]?.connectionId === connection.id &&
            workspace().tabsById[tabId]?.type === tabType &&
            (workspace().tabsById[tabId]?.databaseName ?? null) ===
              databaseName,
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

      const tab = createDbTab(connection, tabType);
      tab.databaseName = databaseName;
      draft.tabsById[tab.id] = tab;
      draft.openTabIds.push(tab.id);
      draft.activeTabId = tab.id;
    });
  }

  async function connectSavedConnection(connection: DbConnection) {
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
      targetConnection.url = buildDbConnectionUrl(targetConnection);
      targetTab.title = targetConnection.name;
    });
  }

  async function disconnectConnection(connectionId: string) {
    const connection = connectionMap().get(connectionId);
    const removedTabIds = Object.values(workspace().tabsById)
      .filter((tab) => tab.connectionId === connectionId)
      .map((tab) => tab.id);
    clearTabArtifacts(removedTabIds);

    if (connection) {
      try {
        await disconnectDbConnection(connection);
      } catch {
        // Keep local disconnect responsive even if server-side cleanup fails.
      }
    }

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
    const connection = connectionMap().get(connectionId);
    const removedTabIds = Object.values(workspace().tabsById)
      .filter((tab) => tab.connectionId === connectionId)
      .map((tab) => tab.id);
    clearTabArtifacts(removedTabIds);

    if (
      connection &&
      workspace().connectedConnectionIds.includes(connectionId)
    ) {
      try {
        await disconnectDbConnection(connection);
      } catch {
        // Removing saved state should still succeed if pooled cleanup fails.
      }
    }

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

    const freshTab = { ...tab, query: getEffectiveQuery() };

    const execution = startDbExecution(freshTab, connection);

    setExecutionByTabId((current) => ({
      ...current,
      [tab.id]: {
        status: "running",
        requestId: execution.requestId,
        startedAt: new Date().toISOString(),
      },
    }));

    try {
      await saveCurrentTab();
      const result = await execution.promise;
      setResultByTabId((current) => ({ ...current, [tab.id]: result }));
      setRawByTabId((current) => ({
        ...current,
        [tab.id]: JSON.stringify(result.data, null, 2),
      }));
      if (!tab.source) {
        setResultPageByTabId((current) => ({ ...current, [tab.id]: 1 }));
      }
      setExecutionByTabId((current) => ({
        ...current,
        [tab.id]: {
          status: "success",
          durationMs: (result.data as { durationMs?: number }).durationMs,
        },
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown database error";
      setRawByTabId((current) => ({ ...current, [tab.id]: message }));
      setExecutionByTabId((current) => ({
        ...current,
        [tab.id]: { status: "error", message },
      }));
    }
  }


  function nodeMatchesFilter(node: DbExplorerNode, filter: string): boolean {
    if (!filter) return true;
    if (node.label.toLowerCase().includes(filter)) return true;
    if ((node.description ?? "").toLowerCase().includes(filter)) return true;
    if (node.kind === "group") {
      // Group nodes pass if any descendant matches
      return node.children.some((child) => nodeMatchesFilter(child, filter));
    }
    return false;
  }

  /** Like nodeMatchesFilter but group nodes always pass (they are containers). */
  function groupOrLeafMatchesFilter(
    node: DbExplorerNode,
    filter: string,
  ): boolean {
    if (!filter) return true;
    if (node.kind === "group") return true;
    return (
      node.label.toLowerCase().includes(filter) ||
      (node.description ?? "").toLowerCase().includes(filter)
    );
  }


  function getActiveEditorView() {
    return activeEditorView;
  }

  function setActiveEditorView(view: EditorView | null) {
    activeEditorView = view;
  }

  return {
    props,
    activeConnection,
    activeConnectionId,
    activeTab,
    connectedConnections,
    connectionDraftState,
    connectionMap,
    connectionMenu,
    connectionModalMode,
    databaseExportBulkInsert,
    databaseExportFormat,
    databaseExportIncludeCreate,
    databaseExportIncludeDrop,
    databaseExportModal,
    databaseExportZip,
    draggedTabId,
    editedRowsByTabId,
    editorPaneSplit,
    executionByTabId,
    executionWarning,
    expandedConnectionIds,
    expandedExplorerNodeIds,
    explorerByConnectionId,
    explorerNodeMenu,
    filter,
    filteredConnectedConnections,
    filteredSavedConnections,
    historyModalOpen,
    liveQueryByTabId,
    loadingExplorerNodeIds,
    normalizedFilter,
    normalizedSavedConnectionsFilter,
    objectDetailByNodeId,
    pendingConnectionId,
    rawByTabId,
    redisKeyNameDraftByTabId,
    redisKeyTtlDraftByTabId,
    resultByTabId,
    resultPageByTabId,
    resultPageSizeByTabId,
    resultViewByTabId,
    returnToSavedConnectionsModal,
    rowSavePendingKeys,
    savedConnectionsError,
    savedConnectionsFilter,
    savedConnectionsModalOpen,
    schemaCompletionCache,
    setConnectionDraftState,
    setConnectionMenu,
    setConnectionModalMode,
    setDatabaseExportBulkInsert,
    setDatabaseExportFormat,
    setDatabaseExportIncludeCreate,
    setDatabaseExportIncludeDrop,
    setDatabaseExportModal,
    setDatabaseExportZip,
    setDraggedTabId,
    setEditedRowsByTabId,
    setEditorPaneSplit,
    setExecutionByTabId,
    setExecutionWarning,
    setExpandedConnectionIds,
    setExpandedExplorerNodeIds,
    setExplorerByConnectionId,
    setExplorerNodeMenu,
    setFilter,
    setHistoryModalOpen,
    setLiveQueryByTabId,
    setLoadingExplorerNodeIds,
    setObjectDetailByNodeId,
    setPendingConnectionId,
    setRawByTabId,
    setRedisKeyNameDraftByTabId,
    setRedisKeyTtlDraftByTabId,
    setResultByTabId,
    setResultPageByTabId,
    setResultPageSizeByTabId,
    setResultViewByTabId,
    setReturnToSavedConnectionsModal,
    setRowSavePendingKeys,
    setSavedConnectionsError,
    setSavedConnectionsFilter,
    setSavedConnectionsModalOpen,
    setSchemaCompletionCache,
    setShortcutOverrides,
    setTabDropTargetId,
    setTabMenu,
    setWorkspace,
    shortcutOverrides,
    tabDropTargetId,
    tabItems,
    tabMenu,
    workspace,
    schemaCompletionKey,
    loadAndCacheSchema,
    commitWorkspace,
    isConnectionExpanded,
    isExplorerNodeExpanded,
    toggleExplorerNodeExpanded,
    updateExplorerNodeChildren,
    expandExplorerGroupNode,
    loadLazyExplorerNode,
    loadConnectionExplorer,
    toggleConnectionExpanded,
    selectConnectedConnection,
    findExplorerLeafNode,
    findExplorerNode,
    findMatchingExplorerLeaf,
    getExplorerPreviewMenuLabel,
    getFirstDatabaseNode,
    getSelectedExplorerLeaf,
    buildSourceFromNode,
    getNodeOpenQuery,
    getDefaultSchemaName,
    buildExplorerStructureQuery,
    buildExplorerShowSqlQuery,
    buildExplorerRenameQuery,
    buildExplorerTruncateQuery,
    copyExplorerNodeName,
    copyTextValue,
    resolveConnectionActionTabType,
    resolveExplorerTabType,
    resolveExplorerDatabaseName,
    openConnectionActionQuery,
    canCreateDatabase,
    canShowConnectionSummary,
    buildCreateDatabaseTemplate,
    buildCreateTableTemplate,
    buildImportTemplate,
    buildDropDatabaseTemplate,
    openDatabaseExportModal,
    closeDatabaseExportModal,
    downloadDatabaseExport,
    buildConnectionSummaryQuery,
    openExplorerQuery,
    openExplorerLeaf,
    inspectExplorerLeaf,
    cancelCurrentExecution,
    getActiveResultRows,
    getResultPageSize,
    getResultPage,
    copyCurrentResult,
    exportCurrentResult,
    getActiveObjectDetail,
    getTabObjectDetail,
    getDetailSummaryValue,
    getSameKindConnections,
    formatConnectionDatabaseLabel,
    getDefaultDatabaseForConnection,
    buildDatabaseTargetKey,
    getSameKindDatabaseTargets,
    switchActiveTabConnectionTarget,
    getCurrentConnectionHistory,
    appendHistoryQueryToCurrentTab,
    getRedisKeyTypeClass,
    refreshRedisKeyTab,
    saveRedisKey,
    deleteRedisKey,
    getEditedRows,
    getRowKey,
    getVisibleRowValue,
    updateEditedCell,
    resetEditedRow,
    sqlLiteral,
    rerunPagedSourceTab,
    saveEditedRow,
    resetConnectionExplorer,
    refreshConnectionExplorer,
    resetConnectionExplorerCache,
    clearTabArtifacts,
    closeFloatingMenus,
    openSavedConnectionsModal,
    closeSavedConnectionsModal,
    openCreateConnectionModal,
    openEditConnectionModal,
    closeConnectionModal,
    changeConnectionDraftKind,
    updateConnectionDraftConfig,
    saveConnectionDraft,
    getTabQuery,
    flushLiveQuery,
    updateActiveQuery,
    getEditorSelection,
    getEffectiveQuery,
    applyTextResult,
    openConnectionTab,
    connectSavedConnection,
    expandConnection,
    focusConnectedConnection,
    closeTab,
    togglePinnedTab,
    closeOtherTabs,
    closeAllTabs,
    reorderTabs,
    reorderTabsToEnd,
    saveCurrentTab,
    disconnectConnection,
    removeSavedConnection,
    runCurrentTab,
    nodeMatchesFilter,
    groupOrLeafMatchesFilter,
    getActiveEditorView,
    setActiveEditorView,
  };
}

const DbPanelContext = createContext<ReturnType<typeof createDbPanelState>>();

export function DbPanelProvider(props: DbPanelProps & { children: JSX.Element }) {
  const state = createDbPanelState(props);
  return (
    <DbPanelContext.Provider value={state}>
      {props.children}
    </DbPanelContext.Provider>
  );
}

export function useDbPanel() {
  const ctx = useContext(DbPanelContext);
  if (!ctx) {
    throw new Error("useDbPanel must be used within DbPanelProvider");
  }
  return ctx;
}
