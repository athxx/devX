// UI / CHROME store — extracted from db-panel-context.tsx as Phase 1, PR #1 of
// the state-layer split. This owns the transient "chrome" state that never
// persists and writes only to its own atoms: floating menus, drag state,
// connection-form/draft state, the saved-connections / export modals, and the
// editor-pane split / shortcut overrides / explorer filter.
//
// Façade-preserving: createUiStore() is called synchronously inside
// createDbPanelState's reactive owner, so the signals it declares share the same
// SolidJS ownership/lifecycle as before — only their lexical home moved. The
// returned object is spread verbatim into the single flat context object, so the
// ~250-key public API and all six consumers are unchanged.
//
// Cross-domain functions stay in the coordinator (db-panel-context.tsx) and call
// these atoms via the store: saveConnectionDraft, connectSavedConnection, and
// downloadDatabaseExport touch workspace/explorer/service, so they are NOT here —
// they invoke ui.closeConnectionModal() / ui.connectionModalMode() / etc.
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { cloneValue } from "../../../lib/utils";
import type { ShortcutOverrides } from "../../../lib/shortcuts";
import {
  DEFAULT_EDITOR_THEME_ID,
  type EditorThemeId,
} from "./db-code-editor";
import { buildDbConnectionUrl, createDbConnection } from "../service";
import type {
  DbConnection,
  DbConnectionConfig,
  DbConnectionKind,
} from "../models";

export type ConnectionMenuState = {
  id: string;
  x: number;
  y: number;
};

export type DbTabMenuState = {
  id: string;
  x: number;
  y: number;
};

export type ExplorerNodeMenuState = {
  connectionId: string;
  nodeId: string;
  x: number;
  y: number;
};

export type DatabaseExportModalState = {
  connectionId: string;
  databaseName: string;
};

export type DbConnectionModalMode = "create" | "edit";

export function createUiStore() {
  // --- explorer filter + editor chrome -----------------------------------
  const [filter, setFilter] = createSignal("");
  const [editorPaneSplit, setEditorPaneSplit] = createSignal(48);
  const [editorThemeId, setEditorThemeId] =
    createSignal<EditorThemeId>(DEFAULT_EDITOR_THEME_ID);
  const [shortcutOverrides, setShortcutOverrides] =
    createSignal<ShortcutOverrides>({});

  // --- saved-connections modal -------------------------------------------
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

  // --- floating menus -----------------------------------------------------
  const [connectionMenu, setConnectionMenu] =
    createSignal<ConnectionMenuState | null>(null);
  const [explorerNodeMenu, setExplorerNodeMenu] =
    createSignal<ExplorerNodeMenuState | null>(null);
  const [tabMenu, setTabMenu] = createSignal<DbTabMenuState | null>(null);

  // --- tab drag/drop ------------------------------------------------------
  const [draggedTabId, setDraggedTabId] = createSignal<string | null>(null);
  const [tabDropTargetId, setTabDropTargetId] = createSignal<string | null>(
    null,
  );

  // --- connection create/edit modal + draft ------------------------------
  const [connectionModalMode, setConnectionModalMode] =
    createSignal<DbConnectionModalMode | null>(null);
  const [connectionDraftState, setConnectionDraftState] = createStore<{
    value: DbConnection | null;
  }>({
    value: null,
  });

  // --- history modal ------------------------------------------------------
  const [historyModalOpen, setHistoryModalOpen] = createSignal(false);

  // --- saved-snippets (favorites) modal -----------------------------------
  const [favoritesModalOpen, setFavoritesModalOpen] = createSignal(false);

  // --- database export modal + options -----------------------------------
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

  // --- methods (self-contained over the atoms above) ---------------------
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

  return {
    // explorer filter + editor chrome
    filter,
    setFilter,
    editorPaneSplit,
    setEditorPaneSplit,
    editorThemeId,
    setEditorThemeId,
    shortcutOverrides,
    setShortcutOverrides,
    // saved-connections modal
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
    // floating menus
    connectionMenu,
    setConnectionMenu,
    explorerNodeMenu,
    setExplorerNodeMenu,
    tabMenu,
    setTabMenu,
    // tab drag/drop
    draggedTabId,
    setDraggedTabId,
    tabDropTargetId,
    setTabDropTargetId,
    // connection modal + draft
    connectionModalMode,
    setConnectionModalMode,
    connectionDraftState,
    setConnectionDraftState,
    // history modal
    historyModalOpen,
    setHistoryModalOpen,
    // saved-snippets (favorites) modal
    favoritesModalOpen,
    setFavoritesModalOpen,
    // database export modal + options
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
    // methods
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
  };
}
