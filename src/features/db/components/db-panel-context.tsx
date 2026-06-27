import type { JSX } from "solid-js";
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
import { arrayMove, cloneValue } from "../../../lib/utils";
import {
  isModifierHeld,
  matchShortcut,
  type ShortcutOverrides,
} from "../../../lib/shortcuts";
import { loadSettings } from "../../../lib/storage";
import { loadDbUiStateFromDb, saveDbUiStateToDb } from "../local-db";
import { compactQuery, formatQuery, supportsFormat } from "../format";
import type {
  DbConnection,
  DbConnectionKind,
  DbExplorerNode,
  DbObjectDetail,
  DbSortOrder,
  DbTab,
  DbTabType,
  DbWorkspaceState,
} from "../models";
import {
  buildPagedSqlObjectQuery,
  buildDbConnectionUrl,
  createDbConnection,
  createDbTab,
  disconnectDbConnection,
  executeDbAdHocQuery,
  loadDbObjectDetail,
  loadDbWorkspace,
  loadSchemaCompletionData,
  saveDbWorkspace,
  startDbExecution,
  testDbConnection,
} from "../service";
import { getDbAdapter } from "../adapters";
import {
  getRowKey,
  groupOrLeafMatchesFilter,
  nodeMatchesFilter,
  schemaCompletionKey,
  sqlLiteral,
} from "./db-state-helpers";
import { createUiStore } from "./db-ui-store";
import {
  createExplorerStore,
  type ExplorerGroupNode,
  type ExplorerLeafNode,
  type ExplorerLoadState,
} from "./db-explorer-store";
import { createWorkspaceStore } from "./db-workspace-store";
import { createExecutionStore } from "./db-execution-store";

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
  // UI / CHROME store (Phase 1, PR #1): owns the transient chrome atoms —
  // explorer filter, editor-pane split, shortcut overrides, floating menus,
  // tab drag state, connection draft, and the saved-connections / export /
  // history modals — plus their self-contained open/close methods. Destructured
  // into this scope so the rest of the factory and the flat return object are
  // textually unchanged. Cross-domain seams (saveConnectionDraft,
  // connectSavedConnection, downloadDatabaseExport) stay in this coordinator and
  // call the ui.* atoms below.
  const ui = createUiStore();
  const {
    filter,
    setFilter,
    editorPaneSplit,
    setEditorPaneSplit,
    shortcutOverrides,
    setShortcutOverrides,
    savedConnectionsModalOpen,
    setSavedConnectionsModalOpen,
    savedConnectionsFilter,
    setSavedConnectionsFilter,
    savedConnectionsError,
    setSavedConnectionsError,
    pendingConnectionId,
    setPendingConnectionId,
    returnToSavedConnectionsModal,
    setReturnToSavedConnectionsModal,
    connectionMenu,
    setConnectionMenu,
    explorerNodeMenu,
    setExplorerNodeMenu,
    tabMenu,
    setTabMenu,
    draggedTabId,
    setDraggedTabId,
    tabDropTargetId,
    setTabDropTargetId,
    connectionModalMode,
    setConnectionModalMode,
    connectionDraftState,
    setConnectionDraftState,
    historyModalOpen,
    setHistoryModalOpen,
    databaseExportModal,
    setDatabaseExportModal,
    databaseExportIncludeDrop,
    setDatabaseExportIncludeDrop,
    databaseExportIncludeCreate,
    setDatabaseExportIncludeCreate,
    databaseExportBulkInsert,
    setDatabaseExportBulkInsert,
    databaseExportFormat,
    setDatabaseExportFormat,
    databaseExportZip,
    setDatabaseExportZip,
    closeFloatingMenus,
    openSavedConnectionsModal,
    closeSavedConnectionsModal,
    openCreateConnectionModal,
    openEditConnectionModal,
    closeConnectionModal,
    changeConnectionDraftKind,
    updateConnectionDraftConfig,
    openDatabaseExportModal,
    closeDatabaseExportModal,
  } = ui;

  // WORKSPACE (persistent) store (Phase 1, PR #3): owns the single persistent
  // signal and the memos derived purely from it (connectionMap,
  // connectedConnections, activeTab, activeConnection, activeConnectionId,
  // tabItems). The two label helpers tabItems needs are injected so the store
  // avoids the adapter registry and there is no circular import. Created here, at
  // the workspace signal's original position and BEFORE the explorer store (which
  // injects connectionMap / activeConnection), so injection ordering holds.
  // Destructured into this scope so the rest of the factory and the flat return
  // object are textually unchanged. The cross-domain seams (commitWorkspace, the
  // filtered* memos, and every tab/connection mutation) stay in this coordinator.
  const workspaceStore = createWorkspaceStore({
    getConnectionBadge,
    getDbTabTypeLabel,
  });
  const {
    workspace,
    setWorkspace,
    connectionMap,
    connectedConnections,
    activeTab,
    activeConnection,
    activeConnectionId,
    tabItems,
  } = workspaceStore;
  // EXECUTION (transient) store (Phase 1, PR #4 — final): owns the per-tab
  // query-execution atoms (execution status, result/raw payloads, result
  // view/paging, edited rows + pending keys, live query text, Redis name/TTL
  // drafts, execution warning, schema-completion cache) and the accessors that
  // touch only those atoms. Created here, after the workspace store (it injects
  // workspace's activeTab) and BEFORE the explorer store (which injects this
  // store's loadAndCacheSchema). Destructured into this scope so the rest of the
  // factory and the flat return object are textually unchanged. The cross-domain
  // orchestrators (commitWorkspace, runCurrentTab, rerunPagedSourceTab,
  // saveEditedRow, clearTabArtifacts, flushLiveQuery), the debounced
  // updateActiveQuery + its shared queryPersistTimer, and the activeEditorView
  // ref + its editor accessors all stay in this coordinator.
  const executionStore = createExecutionStore({ activeTab });
  const {
    schemaCompletionCache,
    setSchemaCompletionCache,
    resultByTabId,
    setResultByTabId,
    rawByTabId,
    setRawByTabId,
    executionByTabId,
    setExecutionByTabId,
    redisKeyNameDraftByTabId,
    setRedisKeyNameDraftByTabId,
    redisKeyTtlDraftByTabId,
    setRedisKeyTtlDraftByTabId,
    resultViewByTabId,
    setResultViewByTabId,
    resultPageByTabId,
    setResultPageByTabId,
    resultPageSizeByTabId,
    setResultPageSizeByTabId,
    editedRowsByTabId,
    setEditedRowsByTabId,
    rowSavePendingKeys,
    setRowSavePendingKeys,
    executionWarning,
    setExecutionWarning,
    liveQueryByTabId,
    setLiveQueryByTabId,
    clientSortByTabId,
    setClientSortByTabId,
    loadAndCacheSchema,
    cancelCurrentExecution,
    getActiveResultRows,
    getResultPageSize,
    getResultPage,
    copyCurrentResult,
    exportCurrentResult,
    getEditedRows,
    getVisibleRowValue,
    updateEditedCell,
    resetEditedRow,
    getTabQuery,
    getClientSort,
    toggleClientSort,
    sortRowsForClient,
  } = executionStore;
  let queryPersistTimer: ReturnType<typeof setTimeout> | null = null;
  let activeEditorView: EditorView | null = null;

  const normalizedFilter = createMemo(() => filter().trim().toLowerCase());
  const normalizedSavedConnectionsFilter = createMemo(() =>
    savedConnectionsFilter().trim().toLowerCase(),
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

  // EXPLORER TREE CORE store (Phase 1, PR #2): owns the explorer-tree atoms
  // (expand state, cached node trees, loading nodes, selected leaf, object-detail
  // cache) and the read/mutate helpers + tree loaders over them. Called here,
  // after connectionMap / loadAndCacheSchema / activeConnection are declared,
  // because those three cross-domain seams are injected as deps. Destructured into
  // this scope so the rest of the factory and the flat return object are textually
  // unchanged; coordinator-level orchestrators (openExplorerLeaf,
  // refreshConnectionExplorer, resetConnectionExplorerCache, …) stay here and call
  // these via the destructured bindings.
  const explorer = createExplorerStore({
    connectionMap,
    loadAndCacheSchema,
    activeConnection,
  });
  const {
    expandedConnectionIds,
    setExpandedConnectionIds,
    expandedExplorerNodeIds,
    setExpandedExplorerNodeIds,
    explorerByConnectionId,
    setExplorerByConnectionId,
    loadingExplorerNodeIds,
    setLoadingExplorerNodeIds,
    selectedExplorerLeafByConnectionId,
    setSelectedExplorerLeafByConnectionId,
    objectDetailByNodeId,
    setObjectDetailByNodeId,
    isConnectionExpanded,
    isExplorerNodeExpanded,
    toggleExplorerNodeExpanded,
    updateExplorerNodeChildren,
    expandExplorerGroupNode,
    loadLazyExplorerNode,
    loadConnectionExplorer,
    toggleConnectionExpanded,
    findExplorerLeafNode,
    findExplorerNode,
    findMatchingExplorerLeaf,
    getExplorerPreviewMenuLabel,
    getFirstDatabaseNode,
    getSelectedExplorerLeaf,
    getActiveObjectDetail,
    getTabObjectDetail,
    resetConnectionExplorer,
  } = explorer;

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
      // Tab navigation (mirrors dbx): modifier+Tab cycles forward,
      // modifier+Shift+Tab cycles back, modifier+1..9 jumps to the nth tab
      // (9 selects the last). Uses the platform modifier (⌘ on macOS, Alt
      // elsewhere) consistent with the rest of the shortcut system.
      if (isModifierHeld(event) && event.code === "Tab") {
        event.preventDefault();
        selectTabByOffset(event.shiftKey ? -1 : 1);
        return;
      }
      if (isModifierHeld(event) && /^Digit[1-9]$/.test(event.code)) {
        event.preventDefault();
        const digit = Number(event.code.slice(5));
        selectTabByIndex(digit === 9 ? Number.MAX_SAFE_INTEGER : digit - 1);
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

  async function selectConnectedConnection(connection: DbConnection) {
    await commitWorkspace((draft) => {
      draft.activeConnectionId = connection.id;
    });
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
      tab.source.sort,
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

  // Header-click sort for a SERVER-PAGED table source: cycles the column through
  // asc → desc → unsorted, persists it into tab.source.sort, then re-queries
  // from page 1 (control flow shared with paging via rerunPagedSourceTab). For
  // ad-hoc/client-paged results this is never called — the grid sorts in memory.
  async function setSourceSort(tabId: string, column: string) {
    const tab = workspace().tabsById[tabId];
    if (!tab?.source) return;
    if (tab.source.nodeKind !== "table" && tab.source.nodeKind !== "view")
      return;

    const current = tab.source.sort;
    let next: DbSortOrder | undefined;
    if (!current || current.column !== column) {
      next = { column, dir: "asc" };
    } else if (current.dir === "asc") {
      next = { column, dir: "desc" };
    } else {
      next = undefined;
    }

    await commitWorkspace((draft) => {
      const target = draft.tabsById[tabId];
      if (!target?.source) return;
      if (next) {
        target.source.sort = next;
      } else {
        delete target.source.sort;
      }
      target.source.page = 1;
    });

    await rerunPagedSourceTab(tabId, 1);
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
    setClientSortByTabId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tabId]) => !tabIds.includes(tabId)),
      ),
    );
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

  function activateTab(tabId: string) {
    void commitWorkspace((draft) => {
      if (!draft.tabsById[tabId]) return;
      draft.activeTabId = tabId;
      draft.activeConnectionId =
        draft.tabsById[tabId]?.connectionId ?? draft.activeConnectionId;
    });
  }

  /** Cycle the active tab by `offset` (e.g. +1 / -1), wrapping at the ends. */
  function selectTabByOffset(offset: number) {
    const ids = workspace().openTabIds;
    if (ids.length === 0) return;
    const current = workspace().activeTabId;
    const index = current ? ids.indexOf(current) : -1;
    const base = index < 0 ? 0 : index;
    const nextIndex = (base + offset + ids.length) % ids.length;
    activateTab(ids[nextIndex]);
  }

  /** Activate the nth open tab (0-based); the last index selects the last tab. */
  function selectTabByIndex(index: number) {
    const ids = workspace().openTabIds;
    if (ids.length === 0) return;
    const target = index >= ids.length ? ids.length - 1 : index;
    if (target < 0) return;
    activateTab(ids[target]);
  }

  async function duplicateTab(tabId: string) {
    const original = workspace().tabsById[tabId];
    const connection = original
      ? connectionMap().get(original.connectionId)
      : null;
    if (!original || !connection) {
      setTabMenu(null);
      return;
    }

    const liveQuery = getTabQuery(original);
    await commitWorkspace((draft) => {
      const tab = createDbTab(connection, original.type);
      tab.title = `${original.title} (copy)`;
      tab.query = liveQuery;
      tab.databaseName = original.databaseName;
      // A duplicate is a fresh scratch tab: it does NOT inherit the server-side
      // paging `source`, so it behaves as an ad-hoc (client-paged) query tab.
      draft.tabsById[tab.id] = tab;
      const anchor = draft.openTabIds.indexOf(tabId);
      if (anchor < 0) {
        draft.openTabIds.push(tab.id);
      } else {
        draft.openTabIds.splice(anchor + 1, 0, tab.id);
      }
      draft.activeTabId = tab.id;
      draft.activeConnectionId = connection.id;
    });
    setTabMenu(null);
  }

  async function copyTabName(tabId: string) {
    const tab = workspace().tabsById[tabId];
    setTabMenu(null);
    if (!tab || !navigator?.clipboard?.writeText) return;
    await navigator.clipboard.writeText(tab.title);
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
    clientSortByTabId,
    setClientSortByTabId,
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
    setSourceSort,
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
    getClientSort,
    toggleClientSort,
    sortRowsForClient,
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
    duplicateTab,
    copyTabName,
    selectTabByOffset,
    selectTabByIndex,
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
