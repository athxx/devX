// WORKSPACE (persistent) store — extracted from db-panel-context.tsx as Phase 1,
// PR #3 of the state-layer split. This owns the single persistent signal
// (`workspace`) and the memos derived purely from it: the connection lookup map,
// the connected/active connection selectors, the active-tab selector, and the
// presentational tab list.
//
// Façade-preserving: createWorkspaceStore(deps) is called synchronously inside
// createDbPanelState's reactive owner, so the signal/memos it declares share the
// same SolidJS ownership/lifecycle as before — only their lexical home moved. The
// returned members are destructured back into the coordinator so the rest of the
// factory, the single flat context object, and all six consumers are textually
// unchanged.
//
// Boundary (per the plan's seam rule — "functions writing >1 domain stay in the
// coordinator"): only the persistent signal and its PURE derived memos live here.
// `commitWorkspace` reads execution state (liveQueryByTabId) and calls the
// persistence service, so it stays in the coordinator and is the central commit
// primitive every workspace mutation calls. The filtered* memos read UI filter
// state and explorer node trees (other domains) and sit inside the explorer
// ordering cycle, so they also stay in the coordinator. Tab/connection mutations
// (closeTab, reorderTabs, disconnectConnection, …) call commitWorkspace /
// clearTabArtifacts / setTabMenu across domains and stay in the coordinator too.
//
// The two label helpers tabItems needs (getConnectionBadge, getDbTabTypeLabel)
// are injected as deps rather than imported, so this store does not pull in the
// adapter registry and there is no circular import with db-panel-context.tsx.
import { createSignal, createMemo } from "solid-js";
import type { DbConnection, DbTabType, DbWorkspaceState } from "../models";

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

export function createWorkspaceStore(deps: {
  getConnectionBadge: (connection: DbConnection) => {
    label: string;
    class: string;
  };
  getDbTabTypeLabel: (type: DbTabType) => string;
}) {
  const { getConnectionBadge, getDbTabTypeLabel } = deps;

  const [workspace, setWorkspace] = createSignal<DbWorkspaceState>(
    getInitialWorkspace(),
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

  return {
    // persistent signal
    workspace,
    setWorkspace,
    // pure derived memos
    connectionMap,
    connectedConnections,
    activeTab,
    activeConnection,
    activeConnectionId,
    tabItems,
  };
}
