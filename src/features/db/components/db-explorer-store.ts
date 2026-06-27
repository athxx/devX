// EXPLORER TREE CORE store — extracted from db-panel-context.tsx as Phase 1,
// PR #2 of the state-layer split. This owns the explorer-tree state and the
// functions that read/mutate only those atoms: per-connection expand state,
// per-node expand/loading state, the cached explorer node trees, the selected
// leaf per connection, and the per-node object-detail cache. The lazy/eager
// tree loaders and the selection/lookup helpers live here too.
//
// Façade-preserving: createExplorerStore(deps) is called synchronously inside
// createDbPanelState's reactive owner, so the signals it declares share the same
// SolidJS ownership/lifecycle as before — only their lexical home moved. The
// returned object is destructured back into the coordinator so the rest of the
// factory and the single flat context object are textually unchanged.
//
// Cross-domain dependencies (connectionMap, loadAndCacheSchema, activeConnection)
// are owned by other domains in the coordinator and injected via `deps` rather
// than redeclared here. Coordinator-level functions that orchestrate across
// domains (openExplorerLeaf, refreshConnectionExplorer, resetConnectionExplorerCache,
// copyExplorerNodeName, …) stay in db-panel-context.tsx and call these via the
// destructured bindings.
import { createSignal } from "solid-js";
import { loadDbExplorer, loadDbExplorerDatabaseChildren } from "../service";
import type {
  DbConnection,
  DbExplorerNode,
  DbObjectDetail,
  DbTab,
} from "../models";

export type ExplorerLoadState = {
  status: "idle" | "loading" | "ready" | "error";
  nodes: DbExplorerNode[];
  error?: string;
};

export type ExplorerGroupNode = Extract<DbExplorerNode, { kind: "group" }>;
export type ExplorerLeafNode = Exclude<DbExplorerNode, { kind: "group" }>;

export function createExplorerStore(deps: {
  connectionMap: () => Map<string, DbConnection>;
  loadAndCacheSchema: (
    connection: DbConnection,
    databaseName?: string | null,
  ) => void;
  activeConnection: () => DbConnection | null;
}) {
  const { connectionMap, loadAndCacheSchema, activeConnection } = deps;

  const [expandedConnectionIds, setExpandedConnectionIds] = createSignal<
    string[]
  >([]);
  const [expandedExplorerNodeIds, setExpandedExplorerNodeIds] = createSignal<
    string[]
  >([]);
  const [explorerByConnectionId, setExplorerByConnectionId] = createSignal<
    Record<string, ExplorerLoadState>
  >({});
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

  function getActiveObjectDetail() {
    const connection = activeConnection();
    const leaf = getSelectedExplorerLeaf(connection);
    return leaf ? objectDetailByNodeId()[leaf.id]?.detail : undefined;
  }

  function getTabObjectDetail(tab: DbTab | null) {
    if (!tab?.source?.nodeId) return undefined;
    return objectDetailByNodeId()[tab.source.nodeId]?.detail;
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

  return {
    // explorer-tree atoms
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
    // methods
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
  };
}
