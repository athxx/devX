import type { JSX } from "solid-js";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { createStore } from "solid-js/store";
import { TabsBar } from "../../../components/tabs-bar";
import { ControlDot, PinIcon, RefreshIcon } from "../../../components/ui-primitives";
import { WorkspaceSidebarLayout } from "../../../components/workspace-sidebar-layout";
import { arrayMove, cloneValue } from "../../../lib/utils";
import { loadDbUiStateFromDb, saveDbUiStateToDb } from "../local-db";
import { DbCodeEditor } from "./db-code-editor";
import { DbConnectionsPane } from "./db-connections-pane";
import { DbConnectionModal } from "./db-connection-modal";
import { DbContextMenu } from "./db-context-menus";
import { DbEditorPane } from "./db-editor-pane";
import { DbExplorerPane } from "./db-explorer-pane";
import { DbResultGrid } from "./db-result-grid";
import { DbResultsPane } from "./db-results-pane";
import { DbSavedConnectionsModal } from "./db-saved-connections-modal";
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

type DbConnectionDatabaseTarget = {
  key: string;
  connectionId: string;
  databaseName: string | null;
  label: string;
};
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
  saveDbWorkspace,
  startDbExecution,
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
        label: "RDS",
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

function getDefaultTabTypeForConnection(connection: DbConnection): DbTabType {
  return 'query';
}

function getDbTabTypeLabel(type: DbTabType) {
  switch (type) {
    case 'data':
      return 'Data';
    case 'structure':
      return 'Structure';
    case 'redis':
      return 'Redis';
    case 'mongo':
      return 'Mongo';
    case 'raw':
      return 'Action';
    case 'query':
    default:
      return 'Query';
  }
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

function DatabaseStackIcon(props: { active?: boolean }) {
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
      <ellipse
        cx="10"
        cy="5"
        rx="6.25"
        ry="2.5"
        stroke="currentColor"
        stroke-width="1.4"
      />
      <path
        d="M3.75 5V10C3.75 11.38 6.55 12.5 10 12.5C13.45 12.5 16.25 11.38 16.25 10V5"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
      <path
        d="M3.75 10V15C3.75 16.38 6.55 17.5 10 17.5C13.45 17.5 16.25 16.38 16.25 15V10"
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
  kind: "table" | "view" | "function" | "collection" | "key";
}) {
  return (
    <span
      class={`inline-flex h-5 min-w-[30px] items-center justify-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${
        props.kind === "view"
          ? "theme-method-badge theme-method-head"
          : props.kind === "function"
            ? "theme-method-badge theme-method-post"
            : props.kind === "collection"
              ? "theme-method-badge theme-method-trace"
              : props.kind === "key"
                ? "theme-method-badge theme-method-patch"
                : "theme-method-badge theme-method-get"
      }`}
    >
      {props.kind === "view"
        ? "VIEW"
        : props.kind === "function"
          ? "FUNC"
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

export function DbPanel(props: DbPanelProps) {
  const [workspace, setWorkspace] = createSignal<DbWorkspaceState>(
    getInitialWorkspace(),
  );
  const [filter, setFilter] = createSignal("");
  const [objectFilter, setObjectFilter] = createSignal("");
  const [sidebarConnectionsHeight, setSidebarConnectionsHeight] =
    createSignal(58);
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
    'sql' | 'csv' | 'json'
  >('sql');
  const [databaseExportZip, setDatabaseExportZip] = createSignal(false);
  const [loadingExplorerNodeIds, setLoadingExplorerNodeIds] = createSignal<
    string[]
  >([]);
  const [selectedExplorerRootIds, setSelectedExplorerRootIds] = createSignal<
    Record<string, string>
  >({});
  const [selectedExplorerSchemaIds, setSelectedExplorerSchemaIds] =
    createSignal<Record<string, string>>({});
  const [selectedExplorerLeafByConnectionId, setSelectedExplorerLeafByConnectionId] =
    createSignal<Record<string, string>>({});
  const [objectDetailByNodeId, setObjectDetailByNodeId] = createSignal<
    Record<string, { status: "loading" | "ready" | "error"; detail?: DbObjectDetail; error?: string }>
  >({});
  const [editedRowsByTabId, setEditedRowsByTabId] = createSignal<
    Record<string, Record<string, Record<string, string>>>
  >({});
  const [rowSavePendingKeys, setRowSavePendingKeys] = createSignal<string[]>([]);
  const [executionWarning, setExecutionWarning] = createSignal<string | null>(null);
  const [connectionDraftState, setConnectionDraftState] = createStore<{
    value: DbConnection | null;
  }>({
    value: null,
  });
  let sidebarSectionsRef: HTMLDivElement | undefined;

  const normalizedFilter = createMemo(() => filter().trim().toLowerCase());
  const normalizedObjectFilter = createMemo(() =>
    objectFilter().trim().toLowerCase(),
  );
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
        node.label.toLowerCase().includes(normalizedFilter()),
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
    });

    void loadDbUiStateFromDb().then((uiState) => {
      const sidebarParsed = Number(uiState?.sidebarConnectionsHeight);
      if (Number.isFinite(sidebarParsed) && sidebarParsed >= 24 && sidebarParsed <= 76) {
        setSidebarConnectionsHeight(sidebarParsed);
      }

      const editorSplitParsed = Number(uiState?.editorPaneSplit);
      if (Number.isFinite(editorSplitParsed) && editorSplitParsed >= 20 && editorSplitParsed <= 80) {
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
    onCleanup(() => {
      document.removeEventListener("pointerdown", handlePointerDown);
    });
  });

  createEffect(() => {
    void saveDbUiStateToDb({
      sidebarConnectionsHeight: sidebarConnectionsHeight(),
      editorPaneSplit: editorPaneSplit(),
    });
  });

  createEffect(() => {
    activeTab()?.id;
    setExecutionWarning(null);
  });

  createEffect(() => {
    const tab = activeTab();
    if (!tab || tab.type !== 'redis' || tab.source?.nodeKind !== 'key') {
      return;
    }

    const detail = getTabObjectDetail(tab) ?? getActiveObjectDetail();
    const ttl = getDetailSummaryValue(detail, 'TTL') || '-1';

    setRedisKeyNameDraftByTabId((current) => ({
      ...current,
      [tab.id]: current[tab.id] ?? tab.source?.label ?? '',
    }));
    setRedisKeyTtlDraftByTabId((current) => ({
      ...current,
      [tab.id]: current[tab.id] ?? ttl,
    }));
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
      setLoadingExplorerNodeIds((prev) => prev.filter((id) => id !== node.id));
    }
  }

  async function loadConnectionExplorer(
    connection: DbConnection,
    options?: {
      preferredRoot?: { label: string; groupKind: ExplorerGroupNode['groupKind'] } | null;
      preferredSchemaLabel?: string | null;
      preferredLeaf?: {
        kind: ExplorerLeafNode['kind'];
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
      const nextRoot =
        (options?.preferredRoot
          ? nodes.find(
              (node) =>
                node.kind === 'group' &&
                node.groupKind === options.preferredRoot!.groupKind &&
                node.label === options.preferredRoot!.label,
            )
          : null) ??
        nodes.find((node) => node.kind === "group") ??
        null;

      if (nextRoot?.kind === 'group') {
        setSelectedExplorerRootIds((current) => ({
          ...current,
          [connection.id]: nextRoot.id,
        }));

        if (nextRoot.lazy && nextRoot.children.length === 0) {
          await loadLazyExplorerNode(connection.id, nextRoot);
        }

        const refreshedRoot = findExplorerNode(
          explorerByConnectionId()[connection.id]?.nodes ?? [],
          nextRoot.id,
        );

        if (
          options?.preferredSchemaLabel &&
          refreshedRoot &&
          refreshedRoot.kind === 'group'
        ) {
          const schemaNodes = getSchemaNodesForRoot(refreshedRoot);
          const matchingSchema = schemaNodes.find(
            (schemaNode) => schemaNode.label === options.preferredSchemaLabel,
          );
          if (matchingSchema) {
            setSelectedExplorerSchemaIds((current) => ({
              ...current,
              [getSchemaSelectionKey(connection.id, refreshedRoot.id)]: matchingSchema.id,
            }));
          }
        }

        if (options?.preferredLeaf) {
          const refreshedNodes = explorerByConnectionId()[connection.id]?.nodes ?? [];
          const matchingLeaf = findMatchingExplorerLeaf(refreshedNodes, options.preferredLeaf);
          if (matchingLeaf) {
            setSelectedExplorerLeafByConnectionId((current) => ({
              ...current,
              [connection.id]: matchingLeaf.id,
            }));
          }
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
    setExpandedConnectionIds(willExpand ? [connection.id] : []);

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

  function startSidebarSplitResize(event: PointerEvent) {
    const container = sidebarSectionsRef;
    if (!container) {
      return;
    }

    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const minRatio = 24;
    const maxRatio = 76;

    const updateRatio = (clientY: number) => {
      const nextRatio = ((clientY - rect.top) / rect.height) * 100;
      setSidebarConnectionsHeight(
        Math.min(maxRatio, Math.max(minRatio, nextRatio)),
      );
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateRatio(moveEvent.clientY);
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    updateRatio(event.clientY);
  }

  async function selectExplorerRoot(
    connection: DbConnection,
    node: ExplorerGroupNode,
  ) {
    setWorkspace((current) => ({
      ...current,
      activeConnectionId: connection.id,
    }));
    setSelectedExplorerRootIds((current) => ({
      ...current,
      [connection.id]: node.id,
    }));
    setExpandedConnectionIds([connection.id]);
    void saveDbWorkspace({
      ...workspace(),
      activeConnectionId: connection.id,
    });

    if (node.lazy && node.children.length === 0) {
      await loadLazyExplorerNode(connection.id, node);
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

  function findExplorerNode(
    nodes: DbExplorerNode[],
    nodeId: string,
  ): DbExplorerNode | null {
    for (const node of nodes) {
      if (node.id === nodeId) {
        return node;
      }

      if (node.kind === 'group') {
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
      kind: ExplorerLeafNode['kind'];
      label: string;
      qualifiedName?: string;
    },
  ): ExplorerLeafNode | null {
    for (const node of nodes) {
      if (node.kind === 'group') {
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

  function getExplorerCategoryLabel(kind: ExplorerLeafNode["kind"]) {
    switch (kind) {
      case "table":
        return "Tables";
      case "view":
        return "Views";
      case "function":
        return "Functions";
      case "collection":
        return "Collections";
      case "key":
      default:
        return "Keys";
    }
  }

  function makeBrowserCategoryId(parentId: string, label: string) {
    return `${parentId}::${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }

  function cloneLeafForSchema(
    node: ExplorerLeafNode,
    schemaLabel: string,
  ): ExplorerLeafNode {
    return {
      ...node,
      id: `${schemaLabel}::${node.id}`,
      description: node.description
        ? `${schemaLabel} · ${node.description}`
        : schemaLabel,
    };
  }

  function getSelectedExplorerRoot(connection: DbConnection | null) {
    if (!connection) return null;
    const explorer = explorerByConnectionId()[connection.id];
    const nodes = explorer?.nodes ?? [];
    const selectedId = selectedExplorerRootIds()[connection.id];
    return (
      (nodes.find((node) => node.id === selectedId) as
        | ExplorerGroupNode
        | undefined) ??
      (nodes.find((node) => node.kind === "group") as
        | ExplorerGroupNode
        | undefined) ??
      null
    );
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

  function buildSourceFromNode(node: ExplorerLeafNode): DbTab["source"] | undefined {
    return {
      nodeId: node.id,
      nodeKind: node.kind,
      label: node.label,
      schemaName: node.schemaName,
      qualifiedName: node.qualifiedName,
      page: 1,
      pageSize: node.kind === 'table' || node.kind === 'view' ? 50 : 1,
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

  function getSchemaSelectionKey(connectionId: string, rootId: string) {
    return `${connectionId}:${rootId}`;
  }

  function getSchemaNodesForRoot(root: ExplorerGroupNode | null) {
    if (!root) return [] as ExplorerGroupNode[];
    return root.children.filter(
      (node): node is ExplorerGroupNode =>
        node.kind === "group" && node.groupKind === "schema",
    );
  }

  function getSelectedSchemaId(
    connectionId: string,
    rootId: string,
    schemaNodes: ExplorerGroupNode[],
  ) {
    const key = getSchemaSelectionKey(connectionId, rootId);
    const selectedId = selectedExplorerSchemaIds()[key];
    if (
      selectedId === "__all__" ||
      schemaNodes.some((schemaNode) => schemaNode.id === selectedId)
    ) {
      return selectedId ?? "__all__";
    }
    return "__all__";
  }

  function buildObjectBrowserCategories(
    connection: DbConnection,
    root: ExplorerGroupNode | null,
  ) {
    if (!root) return [] as ExplorerGroupNode[];

    const schemaNodes = getSchemaNodesForRoot(root);
    const sourceNodes =
      schemaNodes.length === 0
        ? root.children
        : (() => {
            const selectedSchemaId = getSelectedSchemaId(
              connection.id,
              root.id,
              schemaNodes,
            );
            if (selectedSchemaId !== "__all__") {
              return (
                schemaNodes.find(
                  (schemaNode) => schemaNode.id === selectedSchemaId,
                )?.children ?? []
              );
            }

            const buckets = new Map<string, ExplorerLeafNode[]>();
            for (const schemaNode of schemaNodes) {
              for (const child of schemaNode.children) {
                if (child.kind !== "group" || child.groupKind !== "category") {
                  continue;
                }
                const bucket = buckets.get(child.label) ?? [];
                for (const leaf of child.children) {
                  if (leaf.kind === "group") continue;
                  bucket.push(cloneLeafForSchema(leaf, schemaNode.label));
                }
                buckets.set(child.label, bucket);
              }
            }

            return Array.from(buckets.entries()).map(([label, children]) => ({
              id: makeBrowserCategoryId(root.id, label),
              kind: "group" as const,
              groupKind: "category" as const,
              label,
              description: `${children.length} objects`,
              children,
            }));
          })();

    const categoryNodes = sourceNodes.filter(
      (node): node is ExplorerGroupNode =>
        node.kind === "group" && node.groupKind === "category",
    );

    if (categoryNodes.length > 0) {
      return categoryNodes
        .map((categoryNode) => {
          const children = categoryNode.children.filter((child) => {
            if (child.kind === "group") {
              return false;
            }
            if (!normalizedObjectFilter()) {
              return true;
            }
            return (
              child.label.toLowerCase().includes(normalizedObjectFilter()) ||
              (child.description ?? "")
                .toLowerCase()
                .includes(normalizedObjectFilter())
            );
          });

          return {
            ...categoryNode,
            description: `${children.length} objects`,
            children,
          };
        })
        .filter((categoryNode) => categoryNode.children.length > 0);
    }

    const groupedLeaves = new Map<string, ExplorerLeafNode[]>();
    for (const node of sourceNodes) {
      if (node.kind === "group") {
        continue;
      }
      if (
        normalizedObjectFilter() &&
        !node.label.toLowerCase().includes(normalizedObjectFilter()) &&
        !(node.description ?? "")
          .toLowerCase()
          .includes(normalizedObjectFilter())
      ) {
        continue;
      }
      const label = getExplorerCategoryLabel(node.kind);
      const bucket = groupedLeaves.get(label) ?? [];
      bucket.push(node);
      groupedLeaves.set(label, bucket);
    }

    return Array.from(groupedLeaves.entries()).map(([label, children]) => ({
      id: makeBrowserCategoryId(root.id, label),
      kind: "group" as const,
      groupKind: "category" as const,
      label,
      description: `${children.length} objects`,
      children: children.sort((a, b) => a.label.localeCompare(b.label)),
    }));
  }

  function getObjectBrowserHeading(categories: ExplorerGroupNode[]) {
    const labels = categories.map((category) => category.label.toUpperCase());
    if (labels.length === 0) {
      return "OBJECTS";
    }
    return labels.slice(0, 3).join(", ");
  }

  function escapeSqlString(value: string) {
    return value.replace(/'/g, "''");
  }

  function buildExplorerStructureQuery(
    connection: DbConnection,
    node: ExplorerLeafNode,
  ) {
    const qualifiedName = node.qualifiedName ?? node.label;
    const schemaName = node.schemaName ?? "";
    const objectName = node.label;

    if (node.kind === "function") {
      switch (connection.kind) {
        case "postgresql":
        case "gaussdb":
        case "mysql":
        case "tidb":
          return `SELECT routine_schema, routine_name, routine_type, data_type
FROM information_schema.routines
WHERE routine_schema = '${escapeSqlString(schemaName)}'
  AND routine_name = '${escapeSqlString(objectName)}';`;
        default:
          return `-- Function metadata template
-- ${qualifiedName}`;
      }
    }

    switch (connection.kind) {
      case "sqlite":
        return `PRAGMA table_info(${qualifiedName});`;
      case "mysql":
      case "tidb":
      case "clickhouse":
        return `DESCRIBE ${qualifiedName};`;
      case "sqlserver":
        return `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = '${escapeSqlString(schemaName)}'
  AND TABLE_NAME = '${escapeSqlString(objectName)}'
ORDER BY ORDINAL_POSITION;`;
      case "oracle":
        return `SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT
FROM USER_TAB_COLUMNS
WHERE TABLE_NAME = UPPER('${escapeSqlString(objectName)}')
ORDER BY COLUMN_ID;`;
      default:
        return `SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = '${escapeSqlString(schemaName)}'
  AND table_name = '${escapeSqlString(objectName)}'
ORDER BY ordinal_position;`;
    }
  }

  function buildExplorerShowSqlQuery(
    connection: DbConnection,
    node: ExplorerLeafNode,
  ) {
    const qualifiedName = node.qualifiedName ?? node.label;
    const schemaName = node.schemaName ?? "";
    const objectName = node.label;

    if (node.kind === "view") {
      switch (connection.kind) {
        case "postgresql":
        case "gaussdb":
          return `SELECT pg_get_viewdef('${escapeSqlString(
            qualifiedName,
          )}'::regclass, true);`;
        case "mysql":
        case "tidb":
          return `SHOW CREATE VIEW ${qualifiedName};`;
      }
    }

    if (node.kind === "function") {
      switch (connection.kind) {
        case "postgresql":
        case "gaussdb":
          return `SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = '${escapeSqlString(schemaName)}'
  AND p.proname = '${escapeSqlString(objectName)}';`;
        case "mysql":
        case "tidb":
          return `SHOW CREATE FUNCTION ${qualifiedName};`;
        default:
          return `-- Function DDL template
-- ${qualifiedName}`;
      }
    }

    switch (connection.kind) {
      case "mysql":
      case "tidb":
        return `SHOW CREATE TABLE ${qualifiedName};`;
      case "clickhouse":
        return `SHOW CREATE TABLE ${qualifiedName};`;
      case "sqlite":
        return `SELECT sql
FROM sqlite_master
WHERE type = 'table'
  AND name = '${escapeSqlString(objectName)}';`;
      case "postgresql":
      case "gaussdb":
        return `-- PostgreSQL table DDL helper
-- Use pg_dump -s -t ${qualifiedName}
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = '${escapeSqlString(schemaName)}'
  AND table_name = '${escapeSqlString(objectName)}'
ORDER BY ordinal_position;`;
      default:
        return `-- DDL helper
-- ${qualifiedName}`;
    }
  }

  function buildExplorerRenameQuery(
    connection: DbConnection,
    node: ExplorerLeafNode,
  ) {
    const qualifiedName = node.qualifiedName ?? node.label;

    switch (connection.kind) {
      case "mysql":
      case "tidb":
      case "clickhouse":
        return `RENAME TABLE ${qualifiedName} TO new_${node.label};`;
      case "sqlserver":
        return `EXEC sp_rename '${qualifiedName.replace(/'/g, "''")}', 'new_${node.label}';`;
      default:
        return `ALTER TABLE ${qualifiedName} RENAME TO new_${node.label};`;
    }
  }

  function buildExplorerTruncateQuery(
    connection: DbConnection,
    node: ExplorerLeafNode,
  ) {
    const qualifiedName = node.qualifiedName ?? node.label;
    if (connection.kind === "sqlite") {
      return `DELETE FROM ${qualifiedName};`;
    }
    return `TRUNCATE TABLE ${qualifiedName};`;
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

    return 'raw';
  }

  function resolveExplorerTabType(
    connection: DbConnection,
    node: ExplorerLeafNode,
    options?: {
      titleSuffix?: string;
      source?: DbTab['source'];
      tabType?: DbTabType;
    },
  ): DbTabType {
    if (options?.tabType) {
      return options.tabType;
    }

    if (options?.source) {
      if (node.kind === 'table' || node.kind === 'view') {
        return 'data';
      }

      if (node.kind === 'key') {
        return 'redis';
      }

      if (node.kind === 'collection') {
        return 'mongo';
      }
    }

    if (options?.titleSuffix === 'Structure' || options?.titleSuffix === 'SQL') {
      return 'structure';
    }

    if (node.kind === 'function') {
      return 'structure';
    }

    return 'query';
  }

  function resolveExplorerDatabaseName(
    connection: DbConnection,
    node: ExplorerLeafNode,
    options?: {
      databaseName?: string | null;
      source?: DbTab['source'];
    },
  ) {
    if (options?.databaseName !== undefined) {
      return options.databaseName;
    }

    if (connection.kind === 'mongodb' || connection.kind === 'redis') {
      return options?.source?.schemaName ?? node.schemaName ?? getDefaultDatabaseForConnection(connection);
    }

    if (
      connection.kind === 'mysql' ||
      connection.kind === 'tidb' ||
      connection.kind === 'clickhouse'
    ) {
      return options?.source?.schemaName ?? node.schemaName ?? getDefaultDatabaseForConnection(connection);
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
    const databaseName = options?.databaseName ?? getDefaultDatabaseForConnection(connection);
    const activeTabId = workspace().activeTabId;
    const existingId = !forceNew
      ? activeTabId &&
        workspace().tabsById[activeTabId]?.connectionId === connection.id &&
        workspace().tabsById[activeTabId]?.type === tabType &&
        (workspace().tabsById[activeTabId]?.databaseName ?? null) === databaseName
        ? activeTabId
        : (workspace().openTabIds.find(
            (tabId) =>
              workspace().tabsById[tabId]?.connectionId === connection.id &&
              workspace().tabsById[tabId]?.type === tabType &&
              (workspace().tabsById[tabId]?.databaseName ?? null) === databaseName,
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
    return (
      connection.kind !== "redis" &&
      connection.kind !== "sqlite" &&
      connection.kind !== "oracle"
    );
  }

  function canShowConnectionSummary(connection: DbConnection) {
    return connection.kind !== "redis";
  }

  function buildCreateDatabaseTemplate(connection: DbConnection) {
    switch (connection.kind) {
      case "postgresql":
      case "gaussdb":
        return "CREATE DATABASE new_database;";
      case "mysql":
      case "tidb":
        return "CREATE DATABASE `new_database`;";
      case "sqlserver":
        return "CREATE DATABASE [new_database];";
      case "clickhouse":
        return "CREATE DATABASE new_database;";
      case "mongodb":
        return "use new_database\n\ndb.createCollection(\"sample_collection\")";
      default:
        return "CREATE DATABASE new_database;";
    }
  }

  function buildCreateTableTemplate(
    connection: DbConnection,
    databaseName: string,
  ) {
    switch (connection.kind) {
      case 'mysql':
      case 'tidb':
        return `USE \`${databaseName}\`;

CREATE TABLE new_table (
  id BIGINT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;
      case 'sqlserver':
        return `USE [${databaseName}];

CREATE TABLE dbo.new_table (
  id BIGINT PRIMARY KEY,
  name NVARCHAR(255) NOT NULL,
  created_at DATETIME2 DEFAULT SYSDATETIME()
);`;
      case 'clickhouse':
        return `CREATE TABLE ${databaseName}.new_table (
  id UInt64,
  name String,
  created_at DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY id;`;
      case 'mongodb':
        return `use ${databaseName}

db.createCollection('new_collection')`;
      default:
        return `CREATE TABLE ${databaseName}.new_table (
  id BIGINT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;
    }
  }

  function buildImportTemplate(
    connection: DbConnection,
    databaseName: string,
    source: 'sql' | 'json' | 'csv',
  ) {
    if (connection.kind === 'mongodb') {
      if (source === 'json') {
        return `use ${databaseName}

mongoimport --db ${databaseName} --collection new_collection --file ./data.json --jsonArray`;
      }

      if (source === 'csv') {
        return `use ${databaseName}

mongoimport --db ${databaseName} --collection new_collection --type csv --headerline --file ./data.csv`;
      }

      return `use ${databaseName}

// Paste or run your SQL migration equivalent here`;
    }

    if (source === 'json') {
      return `-- Import JSON into ${databaseName}
-- Replace file paths and table names as needed
-- Example workflow: stage JSON -> transform -> insert`;
    }

    if (source === 'csv') {
      switch (connection.kind) {
        case 'postgresql':
        case 'gaussdb':
          return `\c ${databaseName}
\copy new_table FROM './data.csv' WITH (FORMAT csv, HEADER true);`;
        case 'mysql':
        case 'tidb':
          return `USE \`${databaseName}\`;
LOAD DATA LOCAL INFILE './data.csv'
INTO TABLE new_table
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 LINES;`;
        default:
          return `-- Import CSV into ${databaseName}
-- Replace file paths and table names as needed`;
      }
    }

    return `-- Import SQL into ${databaseName}
-- Paste your schema/data script here`;
  }

  function buildDropDatabaseTemplate(
    connection: DbConnection,
    databaseName: string,
  ) {
    switch (connection.kind) {
      case 'mysql':
      case 'tidb':
        return `DROP DATABASE \`${databaseName}\`;`;
      case 'sqlserver':
        return `DROP DATABASE [${databaseName}];`;
      case 'mongodb':
        return `use ${databaseName}
db.dropDatabase()`;
      default:
        return `DROP DATABASE ${databaseName};`;
    }
  }

  function openDatabaseExportModal(connectionId: string, databaseName: string) {
    setDatabaseExportIncludeDrop(true);
    setDatabaseExportIncludeCreate(true);
    setDatabaseExportBulkInsert(true);
    setDatabaseExportFormat('sql');
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
      `-- Include DROP: ${databaseExportIncludeDrop() ? 'yes' : 'no'}`,
      `-- Include CREATE: ${databaseExportIncludeCreate() ? 'yes' : 'no'}`,
      `-- Bulk insert: ${databaseExportBulkInsert() ? 'yes' : 'no'}`,
      '',
      format === 'sql'
        ? `${databaseExportIncludeDrop() ? `${buildDropDatabaseTemplate(connection, modal.databaseName)}\n` : ''}${databaseExportIncludeCreate() ? buildCreateTableTemplate(connection, modal.databaseName) : ''}`
        : format === 'json'
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
    ].join('\n');

    const blob = new Blob([content], {
      type: format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${modal.databaseName}-export.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
    closeDatabaseExportModal();
  }

  function buildConnectionSummaryQuery(connection: DbConnection) {
    switch (connection.kind) {
      case "postgresql":
      case "gaussdb":
        return "SELECT name, setting, unit, short_desc FROM pg_settings ORDER BY name;";
      case "mysql":
      case "tidb":
        return "SHOW VARIABLES;";
      case "sqlserver":
        return "SELECT name, value_in_use, description FROM sys.configurations ORDER BY name;";
      case "clickhouse":
        return "SELECT name, value, changed, description FROM system.settings ORDER BY name;";
      case "oracle":
        return "SELECT name, value, display_value, description FROM v$parameter ORDER BY name";
      case "sqlite":
        return "PRAGMA compile_options;";
      case "mongodb":
        return "db.adminCommand({ getCmdLineOpts: 1 })";
      default:
        return "SELECT 1;";
    }
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
        (workspace().tabsById[activeTabId]?.databaseName ?? null) === databaseName
        ? activeTabId
        : (workspace().openTabIds.find(
            (tabId) =>
              workspace().tabsById[tabId]?.connectionId === connection.id &&
              workspace().tabsById[tabId]?.type === tabType &&
              (workspace().tabsById[tabId]?.databaseName ?? null) === databaseName,
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
    await openExplorerQuery(connection, node, getNodeOpenQuery(connection, node), {
      forceNew: true,
      source: buildSourceFromNode(node),
    });
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
        status:
          current[node.id]?.status === "ready" ? "ready" : "loading",
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
            error instanceof Error ? error.message : "Failed to load object details.",
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
    const requestId = execution.status === "running" ? execution.requestId : null;
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
    return detail?.summary.find((item) => item.label === label)?.value ?? '';
  }

  function getSameKindConnections(connection: DbConnection | null) {
    if (!connection) {
      return [] as DbConnection[];
    }

    return connectedConnections().filter((item) => item.kind === connection.kind);
  }

  function formatConnectionDatabaseLabel(
    connection: DbConnection,
    databaseName: string | null,
  ) {
    const instanceLabel =
      connection.name || connection.config.host || getConnectionTypeLabel(connection.kind);
    return databaseName?.trim()
      ? `${instanceLabel} - ${databaseName.trim()}`
      : instanceLabel;
  }

  function getDefaultDatabaseForConnection(connection: DbConnection) {
    const selectedRoot = getSelectedExplorerRoot(connection);
    if (selectedRoot?.groupKind === 'database') {
      return selectedRoot.label;
    }

    return connection.config.database.trim() || null;
  }

  function buildDatabaseTargetKey(connectionId: string, databaseName: string | null) {
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
          node.kind === 'group' && node.groupKind === 'database',
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
        const currentConnection = connectionMap().get(currentTarget.connectionId);
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
    const nextConnectionId = parsed.connectionId ?? '';
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
      const targetTab = draft.tabsById[tab.id]
      if (!targetTab) {
        return;
      }
      targetTab.connectionId = nextConnectionId;
      targetTab.databaseName = nextDatabaseName;
      if (currentConnection) {
        const currentPrefix = `${currentConnection.name} · `
        if (targetTab.title.startsWith(currentPrefix)) {
          targetTab.title = `${nextConnection.name} · ${targetTab.title.slice(currentPrefix.length)}`
        } else if (targetTab.title === currentConnection.name) {
          targetTab.title = nextConnection.name
        }
      }
      draft.activeConnectionId = nextConnectionId;
    });
  }

  function getCurrentConnectionHistory(connectionId: string | null) {
    if (!connectionId) {
      return [] as DbWorkspaceState['history'];
    }

    return workspace().history.filter((item) => item.connectionId === connectionId);
  }

  async function appendHistoryQueryToCurrentTab(query: string) {
    const tab = activeTab();
    if (!tab) return;

    await commitWorkspace((draft) => {
      const currentQuery = draft.tabsById[tab.id]?.query ?? '';
      draft.tabsById[tab.id].query = currentQuery.trim()
        ? `${currentQuery.trimEnd()}\n\n${query}`
        : query;
    });

    setHistoryModalOpen(false);
  }

  function getRedisKeyTypeClass(type: string) {
    switch (type.toLowerCase()) {
      case 'string':
        return 'bg-[rgba(59,130,246,0.12)] text-[#1d4ed8]';
      case 'hash':
        return 'bg-[rgba(34,197,94,0.12)] text-[#15803d]';
      case 'zset':
        return 'bg-[rgba(168,85,247,0.12)] text-[#7e22ce]';
      case 'set':
        return 'bg-[rgba(249,115,22,0.12)] text-[#c2410c]';
      case 'list':
        return 'bg-[rgba(236,72,153,0.12)] text-[#be185d]';
      case 'stream':
        return 'bg-[rgba(14,165,233,0.12)] text-[#0369a1]';
      default:
        return 'bg-[rgba(148,163,184,0.18)] text-[#475569]';
    }
  }

  async function refreshRedisKeyTab() {
    const tab = activeTab();
    const connection = activeConnection();
    if (!tab || !connection || tab.type !== 'redis') {
      return;
    }

    if (tab.source?.nodeId) {
      const node = findMatchingExplorerLeaf(
        explorerByConnectionId()[connection.id]?.nodes ?? [],
        {
          kind: 'key',
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
      tab.type !== 'redis' ||
      tab.source?.nodeKind !== 'key'
    ) {
      return;
    }

    const nextName = (redisKeyNameDraftByTabId()[tab.id] ?? '').trim();
    const nextTtl = Number(redisKeyTtlDraftByTabId()[tab.id] ?? '-1');
    const currentName = tab.source.label;
    if (!nextName || Number.isNaN(nextTtl) || nextTtl < -1) {
      return;
    }

    if (nextName !== currentName) {
      await executeDbAdHocQuery(connection, `RENAME ${JSON.stringify(currentName)} ${JSON.stringify(nextName)}`, 'redis');
    }

    const targetKey = nextName || currentName;
    if (nextTtl === -1) {
      await executeDbAdHocQuery(connection, `PERSIST ${JSON.stringify(targetKey)}`, 'redis');
    } else {
      await executeDbAdHocQuery(connection, `EXPIRE ${JSON.stringify(targetKey)} ${nextTtl}`, 'redis');
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
      tab.type !== 'redis' ||
      tab.source?.nodeKind !== 'key'
    ) {
      return;
    }

    const keyName = tab.source.label;
    if (!window.confirm(`Delete redis key \"${keyName}\"?`)) {
      return;
    }

    await executeDbAdHocQuery(connection, `DEL ${JSON.stringify(keyName)}`, 'redis');
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
    return edited ?? JSON.stringify(row[column] ?? null, null, 2);
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
    if (tab.source.nodeKind !== "table" && tab.source.nodeKind !== "view") return;

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
    if (!tab || !connection || !detail?.primaryKeys?.length || !tab.source) return;
    const rowIndex = rows.findIndex((row, index) => getRowKey(row, index) === rowKey);
    if (rowIndex < 0) return;

    const original = rows[rowIndex];
    const edited = getEditedRows(tab.id)[rowKey] ?? {};
    const changedEntries = Object.entries(edited).filter(
      ([column, value]) => value !== JSON.stringify(original[column] ?? null, null, 2),
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
        draft.tabsById[tab.id].query = `UPDATE ${tab.source?.qualifiedName ?? tab.source?.label}
SET ${setClause}
WHERE ${whereClause};`;
      });
      await runCurrentTab();
      await rerunPagedSourceTab(tab.id, tab.source.page);
      resetEditedRow(tab.id, rowKey);
    } finally {
      setRowSavePendingKeys((current) => current.filter((key) => key !== rowKey));
    }
  }

  function resetConnectionExplorer(connectionId: string) {
    setExpandedConnectionIds((current) =>
      current.filter((id) => id !== connectionId),
    );
    setSelectedExplorerRootIds((current) => {
      const next = { ...current };
      delete next[connectionId];
      return next;
    });
    setSelectedExplorerSchemaIds((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => !key.startsWith(`${connectionId}:`),
        ),
      ),
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
    const selectedRoot = getSelectedExplorerRoot(connection);
    const selectedLeaf = getSelectedExplorerLeaf(connection);
    const schemaNodes = getSchemaNodesForRoot(selectedRoot);
    const selectedSchemaId = selectedRoot
      ? getSelectedSchemaId(connection.id, selectedRoot.id, schemaNodes)
      : '__all__';
    const selectedSchemaLabel =
      selectedSchemaId !== '__all__'
        ? schemaNodes.find((schemaNode) => schemaNode.id === selectedSchemaId)?.label ?? null
        : null;

    setExpandedExplorerNodeIds([]);
    closeFloatingMenus();

    await loadConnectionExplorer(connection, {
      preferredRoot: selectedRoot
        ? { label: selectedRoot.label, groupKind: selectedRoot.groupKind }
        : null,
      preferredSchemaLabel: selectedSchemaLabel,
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
    setSelectedExplorerSchemaIds((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => !key.startsWith(`${connection.id}:`),
        ),
      ),
    );
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

  async function updateActiveQuery(query: string) {
    const tab = activeTab();
    if (!tab) return;

    await commitWorkspace((draft) => {
      draft.tabsById[tab.id].query = query;
    });
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
            (workspace().tabsById[tabId]?.databaseName ?? null) === databaseName,
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

    if (connection && workspace().connectedConnectionIds.includes(connectionId)) {
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

    const execution = startDbExecution(tab, connection);

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

    const connection = activeConnection();
    const result = resultByTabId()[tab.id];
    const raw = rawByTabId()[tab.id];
    const execution = executionByTabId()[tab.id] ?? { status: "idle" };
    const resultView = resultViewByTabId()[tab.id] ?? "table";
    const sqlResult = result?.kind === "sql" ? result : null;
    const redisResult = result?.kind === "redis" ? result : null;
    const mongoResult = result?.kind === "mongo" ? result : null;
    const pageSize = tab.source?.pageSize ?? getResultPageSize(tab.id);
    const currentPage = tab.source?.page ?? getResultPage(tab.id);
    const totalRows = sqlResult?.data.rows?.length ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const canGoNext = tab.source ? totalRows >= pageSize : currentPage < totalPages;
    const pagedRows =
      sqlResult?.data.rows?.slice((currentPage - 1) * pageSize, currentPage * pageSize) ??
      [];
    const activeDetail = getTabObjectDetail(tab) ?? getActiveObjectDetail();
    const dirtyRowKeys = Object.keys(getEditedRows(tab.id));
    const editableSql = Boolean(
      connection &&
        tab.source?.nodeKind === "table" &&
        activeDetail?.primaryKeys?.length &&
        sqlResult?.data.columns?.length,
    );

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
            <Show when={tab.source && sqlResult && totalRows > 0}>
              <select
                class="theme-input h-7 rounded-md px-2 text-[11px]"
                value={String(tab.source?.pageSize ?? pageSize)}
                onInput={(event) => {
                  const nextSize = Number(event.currentTarget.value);
                  void commitWorkspace((draft) => {
                    if (!draft.tabsById[tab.id]?.source) return;
                    draft.tabsById[tab.id].source!.pageSize = nextSize;
                    draft.tabsById[tab.id].source!.page = 1;
                  }).then(() => void rerunPagedSourceTab(tab.id, 1));
                }}
              >
                <option value="25">25 rows</option>
                <option value="50">50 rows</option>
                <option value="100">100 rows</option>
                <option value="200">200 rows</option>
              </select>
            </Show>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="theme-control h-7 rounded-md px-2.5 text-[11px]"
              disabled={!result}
              onClick={() => void copyCurrentResult()}
            >
              Copy
            </button>
            <button
              class="theme-control h-7 rounded-md px-2.5 text-[11px]"
              disabled={!result}
              onClick={() => exportCurrentResult("json")}
            >
              JSON
            </button>
            <button
              class="theme-control h-7 rounded-md px-2.5 text-[11px]"
              disabled={!sqlResult}
              onClick={() => exportCurrentResult("csv")}
            >
              CSV
            </button>
            <Show when={canCancelDbExecution(executionByTabId()[tab.id])}>
              <button
                class="rounded-md bg-[#ffebe9] px-2.5 py-1 text-[11px] font-semibold text-[#b42318]"
                onClick={() => void cancelCurrentExecution()}
              >
                Cancel
              </button>
            </Show>
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
        </div>
        <Show when={executionWarning()}>
          <div class="border-b bg-[rgba(255,245,229,0.7)] px-3 py-2 text-[11px] text-[#b54708]" style={{ "border-color": "var(--app-border)" }}>
            {executionWarning()}
          </div>
        </Show>
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
                  <DbResultGrid
                    columns={sqlResult?.data.columns ?? []}
                    rows={pagedRows}
                    editable={editableSql}
                    dirtyRowKeys={dirtyRowKeys}
                    pendingRowKeys={rowSavePendingKeys()}
                    getRowKey={(row, index) => getRowKey(row, index)}
                    getCellValue={(row, column) =>
                      getVisibleRowValue(tab.id, row, pagedRows.indexOf(row), column)
                    }
                    onCellInput={(rowKey, column, value) => {
                      const rowIndex = pagedRows.findIndex(
                        (row, index) => getRowKey(row, index) === rowKey,
                      );
                      if (rowIndex < 0) return;
                      updateEditedCell(tab.id, pagedRows[rowIndex], rowIndex, column, value);
                    }}
                    onSaveRow={(rowKey) => void saveEditedRow(rowKey)}
                    onResetRow={(rowKey) => resetEditedRow(tab.id, rowKey)}
                  />
                  <Show when={sqlResult && (tab.source || totalRows > pageSize)}>
                    <div class="mt-3 flex items-center justify-between gap-2 text-[11px]">
                      <span class="theme-text-soft">
                        {`Showing ${Math.min((currentPage - 1) * pageSize + 1, totalRows)}-${Math.min(currentPage * pageSize, totalRows)} of ${totalRows}`}
                      </span>
                      <div class="flex items-center gap-2">
                        <button
                          class="theme-control h-7 rounded-md px-2.5"
                          disabled={currentPage <= 1}
                          onClick={() => {
                            const nextPage = Math.max(1, currentPage - 1);
                            if (tab.source) {
                              void rerunPagedSourceTab(tab.id, nextPage);
                            } else {
                              setResultPageByTabId((current) => ({
                                ...current,
                                [tab.id]: nextPage,
                              }));
                            }
                          }}
                        >
                          Prev
                        </button>
                        <span class="theme-text-soft">
                          {tab.source ? `Page ${currentPage}` : `${currentPage} / ${totalPages}`}
                        </span>
                        <button
                          class="theme-control h-7 rounded-md px-2.5"
                          disabled={!canGoNext}
                          onClick={() => {
                            const nextPage = Math.min(totalPages, currentPage + 1);
                            if (tab.source) {
                              void rerunPagedSourceTab(tab.id, nextPage);
                            } else {
                              setResultPageByTabId((current) => ({
                                ...current,
                                [tab.id]: nextPage,
                              }));
                            }
                          }}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </Show>
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

  function renderActiveTabPane() {
    const tab = activeTab();
    const connection = activeConnection();
    if (!tab || !connection) {
      return <div class="min-h-0 flex-1" />;
    }

    const readOnlyEditor = tab.type === 'structure';
    const detail = getTabObjectDetail(tab) ?? getActiveObjectDetail();
    const databaseTargets = getSameKindDatabaseTargets(connection, {
      connectionId: tab.connectionId,
      databaseName: tab.databaseName ?? null,
    });
    const isRedisKeyTab = tab.type === 'redis' && tab.source?.nodeKind === 'key';
    const redisKeyType = getDetailSummaryValue(detail, 'Type') || 'key';
    const redisTtl =
      redisKeyTtlDraftByTabId()[tab.id] ??
      (getDetailSummaryValue(detail, 'TTL') || '-1');
    const redisKeyName = redisKeyNameDraftByTabId()[tab.id] ?? tab.source?.label ?? '';
    const header = (
      <div class="border-b px-3 py-2" style={{ 'border-color': 'var(--app-border)' }}>
        <div class="flex flex-wrap items-center gap-2">
          <Show
            when={isRedisKeyTab}
            fallback={
              <>
                <select
                  class="theme-input h-8 min-w-[220px] rounded-md px-3 text-sm"
                  value={buildDatabaseTargetKey(connection.id, tab.databaseName ?? null)}
                  onInput={(event) => void switchActiveTabConnectionTarget(event.currentTarget.value)}
                >
                  <For each={databaseTargets}>
                    {(item) => (
                      <option value={item.key}>{item.label}</option>
                    )}
                  </For>
                </select>
                <button
                  class="theme-control h-8 rounded-md px-3 text-sm font-medium"
                  onClick={() => setHistoryModalOpen(true)}
                >
                  History
                </button>
                <button
                  class="theme-success h-8 rounded-md px-3 text-sm font-semibold"
                  onClick={() => void runCurrentTab()}
                >
                  Run
                </button>
              </>
            }
          >
            <span class={`inline-flex h-8 items-center rounded-md px-3 text-sm font-semibold ${getRedisKeyTypeClass(redisKeyType)}`}>
              {redisKeyType}
            </span>
            <input
              class="theme-input h-8 min-w-[220px] rounded-md px-3 text-sm"
              value={redisKeyName}
              onInput={(event) =>
                setRedisKeyNameDraftByTabId((current) => ({
                  ...current,
                  [tab.id]: event.currentTarget.value,
                }))
              }
            />
            <span class="theme-text-soft text-sm font-medium">TTL</span>
            <input
              class="theme-input h-8 w-20 rounded-md px-3 text-sm"
              type="number"
              min="-1"
              value={redisTtl}
              onInput={(event) => {
                const value = event.currentTarget.value;
                if (value === '' || Number(value) >= -1) {
                  setRedisKeyTtlDraftByTabId((current) => ({
                    ...current,
                    [tab.id]: value,
                  }))
                }
              }}
            />
            <button
              class="inline-flex h-8 w-8 items-center justify-center rounded-md p-0 transition hover:opacity-80"
              title="Refresh"
              onClick={() => void refreshRedisKeyTab()}
            >
              <RefreshIcon />
            </button>
            <button
              class="theme-success h-8 rounded-md px-3 text-sm font-semibold"
              onClick={() => void saveRedisKey()}
            >
              Save
            </button>
            <div class="ml-auto" />
            <button
              class="traffic-dot-button inline-flex h-6 w-6 items-center justify-center rounded-full p-0"
              title="Delete key"
              onClick={() => void deleteRedisKey()}
            >
              <ControlDot size="mid" variant="delete" />
            </button>
          </Show>
        </div>
      </div>
    );

    return (
      <DbEditorPane
        header={header}
        editorMeta={<></>}
        splitRatio={editorPaneSplit()}
        onSplitChange={setEditorPaneSplit}
        editor={
          <div class="h-full">
            <DbCodeEditor
              kind={connection.kind}
              value={tab.query}
              readOnly={readOnlyEditor}
              onChange={(value) => void updateActiveQuery(value)}
              onRun={() => void runCurrentTab()}
            />
          </div>
        }
        results={<DbResultsPane>{renderResultView()}</DbResultsPane>}
      />
    );
  }

  function renderExplorerNode(
    connection: DbConnection,
    node: DbExplorerNode,
    depth: number,
  ): JSX.Element {
    const paddingLeft = `${depth * 14 + 12}px`;

    if (node.kind === "group") {
      const expanded = () => isExplorerNodeExpanded(node.id);
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
              <TreeChevronIcon expanded={expanded()} />
            </button>
            <Show
              when={node.groupKind === "database"}
              fallback={<DatabaseFolderIcon />}
            >
              <DatabaseStackIcon />
            </Show>
            <button class="min-w-0 flex-1 text-left" onClick={handleClick}>
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
          <Show when={expanded()}>
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
    const isActive = () => activeConnectionId() === connection.id;
    const expanded = () => isConnectionExpanded(connection.id);
    const badge = getConnectionBadge(connection);
    const explorer = () =>
      explorerByConnectionId()[connection.id] ?? {
        status: "idle" as const,
        nodes: [] as DbExplorerNode[],
      };
    const selectedRoot = () => getSelectedExplorerRoot(connection);

    return (
      <div class="grid gap-1">
        <div
          class={`theme-sidebar-item group flex min-w-0 items-center gap-2 rounded-xl px-2 py-2 ${
            isActive() ? "theme-sidebar-item-active" : ""
          }`}
          onClick={() => {
            void selectConnectedConnection(connection);
            toggleConnectionExpanded(connection);
          }}
          onDblClick={() => void openConnectionTab(connection)}
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
            <TreeChevronIcon expanded={expanded()} />
          </button>
          <button class="min-w-0 flex-1 text-left">
            <div class="flex min-w-0 items-center gap-2">
              <span class={`${badge.class} shrink-0`}>{badge.label}</span>
              <p class="truncate text-[13px] font-medium" title={connection.name}>
                {connection.name}
              </p>
            </div>
            <p class="theme-text-soft truncate text-[11px]">
              {describeConnection(connection)}
            </p>
          </button>
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
              <ControlDot size="small" variant="menu" />
            </button>
          </div>
        </div>

        <Show when={expanded()}>
          <div class="grid gap-1">
            <Show when={explorer().status === "loading"}>
              <div class="theme-text-soft px-2 py-1 text-[11px]">
                Loading objects...
              </div>
            </Show>
            <Show when={explorer().status === "error"}>
              <button
                class="theme-control rounded-lg px-3 py-2 text-left text-[11px]"
                onClick={() => void loadConnectionExplorer(connection)}
              >
                {explorer().error || "Failed to load database objects."}
              </button>
            </Show>
            <Show
              when={
                explorer().status === "ready" && explorer().nodes.length === 0
              }
            >
              <div class="theme-text-soft px-2 py-1 text-[11px]">
                No objects found.
              </div>
            </Show>
            <For each={explorer().nodes}>
              {(node) =>
                node.kind === "group" ? (
                  <button
                    class={`theme-sidebar-item ml-6 flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left ${
                      selectedRoot()?.id === node.id
                        ? "theme-sidebar-item-active"
                        : ""
                    }`}
                    onClick={() => void selectExplorerRoot(connection, node)}
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
                    <DatabaseStackIcon
                      active={selectedRoot()?.id === node.id}
                    />
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-[11px] font-medium leading-5">
                        {node.label}
                      </p>
                    </div>
                  </button>
                ) : null
              }
            </For>
          </div>
        </Show>
      </div>
    );
  }

  function renderObjectBrowserPanel() {
    const connection = () => {
      const connId = workspace().activeConnectionId;
      return (
        (connId ? (connectionMap().get(connId) ?? null) : null) ??
        activeConnection() ??
        connectedConnections()[0] ??
        null
      );
    };
    const explorer = () => {
      const conn = connection();
      return conn
        ? (explorerByConnectionId()[conn.id] ?? {
            status: "idle" as const,
            nodes: [] as DbExplorerNode[],
          })
        : null;
    };
    const root = () => getSelectedExplorerRoot(connection());
    const schemaNodes = () => getSchemaNodesForRoot(root());
    const categories = () => {
      const conn = connection();
      const r = root();
      return conn && r ? buildObjectBrowserCategories(conn, r) : [];
    };
    const selectedSchemaId = () => {
      const conn = connection();
      const r = root();
      const sn = schemaNodes();
      return conn && r ? getSelectedSchemaId(conn.id, r.id, sn) : "__all__";
    };
    const totalSchemaObjectCount = () =>
      schemaNodes().reduce(
        (total, schemaNode) =>
          total +
          schemaNode.children.reduce(
            (schemaTotal, child) =>
              schemaTotal +
              (child.kind === "group" ? child.children.length : 1),
            0,
          ),
        0,
      );
    const isRootLoading = () => {
      const r = root();
      return r ? loadingExplorerNodeIds().includes(r.id) : false;
    };

    return (
      <DbExplorerPane
        heading={getObjectBrowserHeading(categories())}
        subtitle={
          root()
            ? `${connection()?.name} / ${root()!.label}`
            : ''
        }
        objectFilter={objectFilter()}
        showSchemaSelect={schemaNodes().length > 0 && Boolean(connection() && root())}
        totalSchemaObjectCount={totalSchemaObjectCount()}
        selectedSchemaId={selectedSchemaId()}
        schemaNodes={schemaNodes()}
        categories={categories()}
        hasConnection={Boolean(connection())}
        hasRoot={Boolean(root())}
        isRootLoading={isRootLoading()}
        explorerStatus={explorer()?.status}
        explorerError={explorer()?.error}
        renderSchemaOption={(schemaNode) => (
          <option value={schemaNode.id}>{schemaNode.label}</option>
        )}
        renderCategory={(category) => renderExplorerNode(connection()!, category, 0)}
        onObjectFilterInput={setObjectFilter}
        onSchemaChange={(value) =>
          setSelectedExplorerSchemaIds((current) => ({
            ...current,
            [getSchemaSelectionKey(connection()!.id, root()!.id)]: value,
          }))
        }
        onRefreshConnection={() => void refreshConnectionExplorer(connection()!)}
        onRetryExplorer={() => {
          const c = connection();
          if (c) void loadConnectionExplorer(c);
        }}
      />
    )
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
          <div
            ref={sidebarSectionsRef}
            class="flex min-h-0 flex-col overflow-hidden"
            style={{
              height: "calc(100dvh - 52px)",
              "max-height": "calc(100dvh - 52px)",
            }}
          >
            <DbConnectionsPane
              sidebarConnectionsHeight={sidebarConnectionsHeight()}
              filter={filter()}
              connectedCount={connectedConnections().length}
              filteredItems={filteredConnectedConnections()}
              onFilterInput={setFilter}
              onOpenSavedConnections={openSavedConnectionsModal}
              onResizeStart={startSidebarSplitResize}
              renderItem={(connection) => renderConnectedConnectionRow(connection)}
            />

            <div class="min-h-[180px] min-w-0 flex-1 overflow-hidden">
              <div class="flex h-full min-h-0 flex-col overflow-hidden">
                <div class="min-h-0 flex-1 overflow-hidden">{renderObjectBrowserPanel()}</div>
              </div>
            </div>
          </div>
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
                renderCloseIcon={() => (
                  <ControlDot size="small" variant="delete" />
                )}
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
            fallback={<div class="min-h-0 flex-1" />}
          >
            {renderActiveTabPane()}
          </Show>
        </div>
      </WorkspaceSidebarLayout>

      <DbSavedConnectionsModal
        open={savedConnectionsModalOpen()}
        filter={savedConnectionsFilter()}
        error={savedConnectionsError()}
        items={filteredSavedConnections()}
        onClose={closeSavedConnectionsModal}
        onFilterInput={setSavedConnectionsFilter}
        onCreate={() => openCreateConnectionModal("postgresql", true)}
        renderItem={(connection) => {
          const badge = getConnectionBadge(connection)
          const isConnected = workspace().connectedConnectionIds.includes(connection.id)
          const isPending = pendingConnectionId() === connection.id

          return (
            <div
              class="theme-control grid gap-3 rounded-[18px] px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
              onDblClick={() =>
                void (isConnected
                  ? disconnectConnection(connection.id)
                  : connectSavedConnection(connection))
              }
            >
              <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-2">
                  <span class={badge.class}>{badge.label}</span>
                  <p class="truncate text-sm font-semibold" title={connection.name}>{connection.name}</p>
                  <p class="theme-text-soft truncate text-xs">{describeConnection(connection)}</p>
                </div>
              </div>
              <div class="flex items-center justify-end gap-2">
                <button
                  class="rounded-xl border px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-60"
                  style={{ background: '#007aff', 'border-color': 'rgba(0, 122, 255, 0.45)' }}
                  disabled={isPending}
                  onClick={() => openEditConnectionModal(connection, true)}
                >
                  Edit
                </button>
                <button class="rounded-xl border px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110" style={{ background: '#ff5f57', 'border-color': 'rgba(255, 95, 87, 0.5)' }} disabled={isPending} onClick={() => void removeSavedConnection(connection.id)}>Delete</button>
                <button
                  class="rounded-xl border px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    background: isConnected ? '#8e8e93' : '#28c840',
                    'border-color': isConnected
                      ? 'rgba(142, 142, 147, 0.5)'
                      : 'rgba(40, 200, 64, 0.5)',
                  }}
                  disabled={Boolean(pendingConnectionId())}
                  onClick={() =>
                    void (isConnected
                      ? disconnectConnection(connection.id)
                      : connectSavedConnection(connection))
                  }
                >
                  {isPending ? 'Connecting...' : isConnected ? 'Disconnect' : 'Connect'}
                </button>
              </div>
            </div>
          )
        }}
      />

      <Show when={historyModalOpen()}>
        <div
          class="fixed inset-0 z-[331] flex items-center justify-center bg-[rgba(15,23,42,0.3)] px-4 py-6"
          data-db-menu-root
          onClick={() => setHistoryModalOpen(false)}
        >
          <div
            class="theme-panel-soft w-full max-w-3xl rounded-[22px] border p-5 shadow-[0_24px_60px_rgba(15,23,42,0.24)]"
            style={{ 'border-color': 'var(--app-border)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div class="flex items-start justify-between gap-4 border-b pb-4" style={{ 'border-color': 'var(--app-border)' }}>
              <div>
                <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">History</p>
                <h3 class="theme-text mt-2 text-lg font-semibold">Execution History</h3>
              </div>
              <button class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0" onClick={() => setHistoryModalOpen(false)}>
                <ControlDot size="small" variant="delete" />
              </button>
            </div>
            <div class="mt-4 max-h-[55vh] overflow-auto">
              <div class="grid gap-2">
                <For each={getCurrentConnectionHistory(activeConnectionId())}>
                  {(item) => (
                    <button
                      class="theme-control grid gap-2 rounded-[18px] px-4 py-3 text-left"
                      onClick={() => void appendHistoryQueryToCurrentTab(item.query)}
                    >
                      <div class="flex items-center justify-between gap-2">
                        <span class={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.status === 'success' ? 'bg-[rgba(40,200,64,0.12)] text-[#1f8f3a]' : 'bg-[rgba(255,95,87,0.12)] text-[#c2410c]'}`}>
                          {item.status}
                        </span>
                        <span class="theme-text-soft text-[11px]">
                          {new Date(item.executedAt).toLocaleString()}
                        </span>
                      </div>
                      <pre class="theme-text-soft whitespace-pre-wrap break-all font-mono text-[11px]">
                        {item.query}
                      </pre>
                    </button>
                  )}
                </For>
                <Show when={getCurrentConnectionHistory(activeConnectionId()).length === 0}>
                  <div class="theme-text-soft rounded-xl px-2 py-3 text-xs">
                    No execution history.
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <DbConnectionModal
        open={Boolean(connectionModalMode() && connectionDraftState.value)}
        mode={connectionModalMode()}
        title={getConnectionTypeLabel(connectionDraftState.value?.kind ?? 'postgresql')}
        kind={connectionDraftState.value?.kind ?? 'postgresql'}
        kinds={databaseKinds}
        renderKindLabel={getConnectionTypeLabel}
        showEnvironment={connectionModalMode() === 'edit'}
        environment={connectionDraftState.value?.environment ?? 'local'}
        aliasField={renderConfigField(
          'Alias',
          () => connectionDraftState.value!.name,
          (value) => setConnectionDraftState('value', 'name', value),
        )}
        form={connectionDraftState.value ? renderConnectionDraftForm(connectionDraftState.value) : <div />}
        onClose={closeConnectionModal}
        onKindChange={(kind) => changeConnectionDraftKind(kind as DbConnectionKind)}
        onEnvironmentChange={(value) =>
          setConnectionDraftState('value', 'environment', value as DbConnection['environment'])
        }
        onSave={() => void saveConnectionDraft()}
      />

      <Show when={databaseExportModal()} keyed>
        {(modal) => (
          <div
            class="fixed inset-0 z-[332] flex items-center justify-center bg-[rgba(15,23,42,0.3)] px-4 py-6"
            data-db-menu-root
          >
            <div
              class="theme-panel-soft w-full max-w-xl rounded-[22px] border p-5 shadow-[0_24px_60px_rgba(15,23,42,0.24)]"
              style={{ 'border-color': 'var(--app-border)' }}
            >
              <div class="flex items-start justify-between gap-4 border-b pb-4" style={{ 'border-color': 'var(--app-border)' }}>
                <div>
                  <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">Export</p>
                  <h3 class="theme-text mt-2 text-lg font-semibold">{modal.databaseName}</h3>
                </div>
                <button class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0" onClick={() => closeDatabaseExportModal()}>
                  <ControlDot size="small" variant="delete" />
                </button>
              </div>

              <div class="mt-4 grid gap-3 md:grid-cols-2">
                <label class="theme-control flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                  <input type="checkbox" checked={databaseExportIncludeDrop()} onInput={(event) => setDatabaseExportIncludeDrop(event.currentTarget.checked)} />
                  <span>Include DROP DATABASE</span>
                </label>
                <label class="theme-control flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                  <input type="checkbox" checked={databaseExportIncludeCreate()} onInput={(event) => setDatabaseExportIncludeCreate(event.currentTarget.checked)} />
                  <span>Include CREATE TABLE</span>
                </label>
                <label class="theme-control flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                  <input type="checkbox" checked={databaseExportBulkInsert()} onInput={(event) => setDatabaseExportBulkInsert(event.currentTarget.checked)} />
                  <span>Use bulk insert</span>
                </label>
                <label class="theme-control flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                  <input type="checkbox" checked={databaseExportZip()} onInput={(event) => setDatabaseExportZip(event.currentTarget.checked)} />
                  <span>Zip output</span>
                </label>
                <label class="grid gap-1 md:col-span-2">
                  <span class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">File Type</span>
                  <select class="theme-input h-9 rounded-xl px-3 text-sm" value={databaseExportFormat()} onInput={(event) => setDatabaseExportFormat(event.currentTarget.value as 'sql' | 'csv' | 'json')}>
                    <option value="sql">SQL</option>
                    <option value="csv">CSV</option>
                    <option value="json">JSON</option>
                  </select>
                </label>
              </div>

              <div class="mt-5 flex items-center justify-end gap-2">
                <button class="theme-control h-8 rounded-md px-3 text-sm font-medium" onClick={() => closeDatabaseExportModal()}>
                  Cancel
                </button>
                <button class="theme-success h-8 rounded-md px-3 text-sm font-semibold" onClick={() => downloadDatabaseExport()}>
                  Export
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>

      <Show when={connectionMenu()} keyed>
        {(menu) => {
          const connection = connectionMap().get(menu.id);
          if (!connection) return null;

          return (
            <DbContextMenu open={true} menu={menu} zIndex={300}>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void openConnectionTab(connection, true)}
              >
                New Query
              </button>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void refreshConnectionExplorer(connection)}
              >
                Refresh
              </button>
              <Show when={canCreateDatabase(connection)}>
                <button
                  class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                  onClick={() =>
                    void openConnectionActionQuery(
                      connection,
                      "Create Database",
                      buildCreateDatabaseTemplate(connection),
                      { forceNew: true, resultView: "raw" },
                    )
                  }
                >
                  Create Database
                </button>
              </Show>
              <Show when={canShowConnectionSummary(connection)}>
                <button
                  class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                  onClick={() =>
                    void openConnectionActionQuery(
                      connection,
                      "Summary",
                      buildConnectionSummaryQuery(connection),
                      {
                        forceNew: true,
                        resultView:
                          connection.kind === "mongodb" ? "raw" : "table",
                      },
                    )
                  }
                >
                  Summary
                </button>
              </Show>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() => void disconnectConnection(connection.id)}
              >
                Disconnect
              </button>
            </DbContextMenu>
          );
        }}
      </Show>

      <Show when={explorerNodeMenu()} keyed>
        {(menu) => {
          const connection = connectionMap().get(menu.connectionId);
          const node = connection
            ? findExplorerNode(
                explorerByConnectionId()[menu.connectionId]?.nodes ?? [],
                menu.nodeId,
              )
            : null;
          if (!connection || !node) return null;
          if (node.kind === 'group') {
            const databaseName = node.label;
            const showExtendedMenu = connection.kind !== 'redis';

            return (
              <DbContextMenu open={true} menu={menu} zIndex={305}>
                <button
                  class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                  onClick={() => void openConnectionTab(connection, true, databaseName)}
                >
                  New Query
                </button>
                <Show when={showExtendedMenu}>
                  <>
                    <button
                      class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                      onClick={() =>
                        void openConnectionActionQuery(
                          connection,
                          `${databaseName} · New Table`,
                          buildCreateTableTemplate(connection, databaseName),
                          { forceNew: true, resultView: 'raw', databaseName },
                        )
                      }
                    >
                      New Table
                    </button>
                    <div class="my-1 h-px" style={{ background: 'var(--app-border)' }} />
                    <button
                      class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                      onClick={() => void copyTextValue(databaseName)}
                    >
                      Copy Name
                    </button>
                    <div class="my-1 h-px" style={{ background: 'var(--app-border)' }} />
                    <div class="group relative">
                      <button class="theme-sidebar-item flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm">
                        <span>Import</span>
                        <span class="theme-text-soft text-[10px]">&gt;</span>
                      </button>
                      <div
                        class="theme-panel-soft invisible absolute left-full top-0 z-[306] ml-1 grid min-w-[160px] auto-cols-max rounded-[18px] border p-1.5 opacity-0 shadow-[0_18px_45px_rgba(15,23,42,0.18)] transition group-hover:visible group-hover:opacity-100"
                        style={{ 'border-color': 'var(--app-border)' }}
                      >
                        <button
                          class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                          onClick={() =>
                            void openConnectionActionQuery(
                              connection,
                              `${databaseName} · Import SQL`,
                              buildImportTemplate(connection, databaseName, 'sql'),
                              { forceNew: true, resultView: 'raw', databaseName },
                            )
                          }
                        >
                          From SQL
                        </button>
                        <button
                          class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                          onClick={() =>
                            void openConnectionActionQuery(
                              connection,
                              `${databaseName} · Import JSON`,
                              buildImportTemplate(connection, databaseName, 'json'),
                              { forceNew: true, resultView: 'raw', databaseName },
                            )
                          }
                        >
                          From JSON
                        </button>
                        <button
                          class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                          onClick={() =>
                            void openConnectionActionQuery(
                              connection,
                              `${databaseName} · Import CSV`,
                              buildImportTemplate(connection, databaseName, 'csv'),
                              { forceNew: true, resultView: 'raw', databaseName },
                            )
                          }
                        >
                          From CSV
                        </button>
                      </div>
                    </div>
                    <button
                      class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                      onClick={() => openDatabaseExportModal(connection.id, databaseName)}
                    >
                      Export
                    </button>
                    <div class="my-1 h-px" style={{ background: 'var(--app-border)' }} />
                    <button
                      class="whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm text-[#b42318] transition hover:bg-[rgba(180,35,24,0.08)]"
                      onClick={() => {
                        if (!window.confirm(`Drop database \"${databaseName}\"? This only opens the command template.`)) {
                          return;
                        }
                        void openConnectionActionQuery(
                          connection,
                          `${databaseName} · Drop Database`,
                          buildDropDatabaseTemplate(connection, databaseName),
                          { forceNew: true, resultView: 'raw', databaseName },
                        )
                      }}
                    >
                      Drop Database
                    </button>
                  </>
                </Show>
              </DbContextMenu>
            );
          }

          const qualifiedName = node.qualifiedName ?? node.label;
          const isTableLike = node.kind === "table" || node.kind === "view";
          const isSqlObject =
            node.kind === "table" ||
            node.kind === "view" ||
            node.kind === "function";

          return (
            <DbContextMenu open={true} menu={menu} zIndex={305}>
              <Show when={isTableLike}>
                <>
                  <button
                    class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                    onClick={() => void inspectExplorerLeaf(connection, node)}
                  >
                    Inspect
                  </button>
                  <button
                    class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                    onClick={() =>
                      void openExplorerQuery(connection, node, getNodeOpenQuery(connection, node), {
                        forceNew: true,
                        source: buildSourceFromNode(node),
                      })
                    }
                  >
                    Open data
                  </button>
                </>
              </Show>
              <Show when={isSqlObject}>
                <>
                  <button
                    class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                    onClick={() =>
                      void openExplorerQuery(
                        connection,
                        node,
                        buildExplorerStructureQuery(connection, node),
                        {
                          forceNew: true,
                          titleSuffix: "Structure",
                        },
                      )
                    }
                  >
                    Open structure
                  </button>
                  <button
                    class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                    onClick={() =>
                      void openExplorerQuery(
                        connection,
                        node,
                        buildExplorerShowSqlQuery(connection, node),
                        {
                          forceNew: true,
                          titleSuffix: "SQL",
                        },
                      )
                    }
                  >
                    Show SQL
                  </button>
                </>
              </Show>
              <Show when={isTableLike || isSqlObject}>
                <div
                  class="my-1 h-px"
                  style={{ background: "var(--app-border)" }}
                />
              </Show>
              <Show when={isTableLike}>
                <>
                  <button
                    class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                    onClick={() =>
                      void openExplorerQuery(connection, node, getNodeOpenQuery(connection, node), {
                        forceNew: true,
                        titleSuffix: "Select",
                        source: buildSourceFromNode(node),
                      })
                    }
                  >
                    Select template
                  </button>
                  <button
                    class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                    onClick={() =>
                      void openExplorerQuery(
                        connection,
                        node,
                        `INSERT INTO ${qualifiedName} ()\nVALUES ();`,
                        {
                          forceNew: true,
                          titleSuffix: "Insert",
                        },
                      )
                    }
                  >
                    Insert template
                  </button>
                  <button
                    class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                    onClick={() =>
                      void openExplorerQuery(
                        connection,
                        node,
                        `UPDATE ${qualifiedName}\nSET \nWHERE ;`,
                        {
                          forceNew: true,
                          titleSuffix: "Update",
                        },
                      )
                    }
                  >
                    Update template
                  </button>
                  <button
                    class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                    onClick={() =>
                      void openExplorerQuery(
                        connection,
                        node,
                        `DELETE FROM ${qualifiedName}\nWHERE ;`,
                        {
                          forceNew: true,
                          titleSuffix: "Delete",
                        },
                      )
                    }
                  >
                    Delete template
                  </button>
                </>
              </Show>
              <Show when={node.countQuery}>
                <button
                  class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                  onClick={() =>
                    void openExplorerQuery(connection, node, node.countQuery!, {
                      forceNew: true,
                      titleSuffix: "Count",
                    })
                  }
                >
                  COUNT(*)
                </button>
              </Show>
              <Show when={node.kind === "table"}>
                <>
                  <div
                    class="my-1 h-px"
                    style={{ background: "var(--app-border)" }}
                  />
                  <button
                    class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                    onClick={() =>
                      void openExplorerQuery(
                        connection,
                        node,
                        `DROP TABLE ${qualifiedName};`,
                        {
                          forceNew: true,
                          titleSuffix: "Drop",
                        },
                      )
                    }
                  >
                    Drop table
                  </button>
                  <button
                    class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                    onClick={() =>
                      void openExplorerQuery(
                        connection,
                        node,
                        buildExplorerRenameQuery(connection, node),
                        {
                          forceNew: true,
                          titleSuffix: "Rename",
                        },
                      )
                    }
                  >
                    Rename table
                  </button>
                  <button
                    class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                    onClick={() =>
                      void openExplorerQuery(
                        connection,
                        node,
                        buildExplorerTruncateQuery(connection, node),
                        {
                          forceNew: true,
                          titleSuffix: "Truncate",
                        },
                      )
                    }
                  >
                    Truncate table
                  </button>
                  <button
                    class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                    onClick={() => void copyExplorerNodeName(node)}
                  >
                    Copy table name
                  </button>
                </>
              </Show>
              <button
                class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                onClick={() =>
                  void openExplorerQuery(connection, node, getNodeOpenQuery(connection, node), {
                    forceNew: true,
                    source: buildSourceFromNode(node),
                  })
                }
              >
                Open In New Tab
              </button>
            </DbContextMenu>
          );
        }}
      </Show>

      <Show when={tabMenu()} keyed>
        {(menu) => {
          const isPinned = workspace().pinnedTabIds.includes(menu.id);
          return (
            <DbContextMenu open={true} menu={menu} zIndex={310}>
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
            </DbContextMenu>
          );
        }}
      </Show>

    </>
  );
}
