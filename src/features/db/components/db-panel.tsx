import { For, Show } from "solid-js";
import { TabsBar } from "../../../components/tabs-bar";
import { ControlDot, PinIcon } from "../../../components/ui-primitives";
import { WorkspaceSidebarLayout } from "../../../components/workspace-sidebar-layout";
import { shortcutLabel } from "../../../lib/shortcuts";
import { DbConnectionsPane } from "./db-connections-pane";
import { DbConnectionModal } from "./db-connection-modal";
import { DbContextMenu } from "./db-context-menus";
import { DbSavedConnectionsModal } from "./db-saved-connections-modal";
import type { DbConnection, DbConnectionKind } from "../models";
import {
  DbPanelProvider,
  useDbPanel,
  databaseKinds,
  describeConnection,
  getConnectionBadge,
  getConnectionTypeLabel,
  type DbPanelProps,
} from "./db-panel-context";
import { DbExplorerTree } from "./explorer/db-explorer-tree";
import { DbEditorPaneView } from "./editor/db-editor-pane-view";
import {
  DbConnectionDraftForm,
  renderConfigField,
} from "./connections/db-connection-form";

export type { DbPanelProps };

export function DbPanel(props: DbPanelProps) {
  return (
    <DbPanelProvider {...props}>
      <DbPanelInner />
    </DbPanelProvider>
  );
}

function DbPanelInner() {
  const {
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
    explorerByConnectionId,
    explorerNodeMenu,
    filter,
    filteredConnectedConnections,
    filteredSavedConnections,
    historyModalOpen,
    pendingConnectionId,
    savedConnectionsError,
    savedConnectionsFilter,
    savedConnectionsModalOpen,
    setConnectionDraftState,
    setConnectionMenu,
    setDatabaseExportBulkInsert,
    setDatabaseExportFormat,
    setDatabaseExportIncludeCreate,
    setDatabaseExportIncludeDrop,
    setDatabaseExportZip,
    setDraggedTabId,
    setExplorerNodeMenu,
    setFilter,
    setHistoryModalOpen,
    setSavedConnectionsFilter,
    setTabDropTargetId,
    setTabMenu,
    shortcutOverrides,
    tabDropTargetId,
    tabItems,
    tabMenu,
    workspace,
    commitWorkspace,
    findExplorerNode,
    buildSourceFromNode,
    getNodeOpenQuery,
    buildExplorerStructureQuery,
    buildExplorerShowSqlQuery,
    buildExplorerRenameQuery,
    buildExplorerTruncateQuery,
    copyExplorerNodeName,
    copyTextValue,
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
    inspectExplorerLeaf,
    getCurrentConnectionHistory,
    appendHistoryQueryToCurrentTab,
    refreshConnectionExplorer,
    openSavedConnectionsModal,
    closeSavedConnectionsModal,
    openCreateConnectionModal,
    openEditConnectionModal,
    closeConnectionModal,
    changeConnectionDraftKind,
    saveConnectionDraft,
    openConnectionTab,
    connectSavedConnection,
    closeTab,
    togglePinnedTab,
    closeOtherTabs,
    closeAllTabs,
    reorderTabs,
    reorderTabsToEnd,
    disconnectConnection,
    removeSavedConnection,
  } = useDbPanel();

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
          <DbConnectionsPane
            filter={filter()}
            connectedCount={connectedConnections().length}
            filteredItems={filteredConnectedConnections()}
            onFilterInput={setFilter}
            onOpenSavedConnections={openSavedConnectionsModal}
            renderItem={(connection) => (
              <DbExplorerTree connection={connection} />
            )}
          />
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
                closeButtonShortcut={shortcutLabel("closeTab", shortcutOverrides())}
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
            <DbEditorPaneView />
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
          const badge = getConnectionBadge(connection);
          const isConnected = workspace().connectedConnectionIds.includes(
            connection.id,
          );
          const isPending = pendingConnectionId() === connection.id;

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
                  <p
                    class="truncate text-sm font-semibold"
                    title={connection.name}
                  >
                    {connection.name}
                  </p>
                  <p class="theme-text-soft truncate text-xs">
                    {describeConnection(connection)}
                  </p>
                </div>
              </div>
              <div class="flex items-center justify-end gap-2">
                <button
                  class="rounded-xl border px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-60"
                  style={{
                    background: "#007aff",
                    "border-color": "rgba(0, 122, 255, 0.45)",
                  }}
                  disabled={isPending}
                  onClick={() => openEditConnectionModal(connection, true)}
                >
                  Edit
                </button>
                <button
                  class="rounded-xl border px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110"
                  style={{
                    background: "#ff5f57",
                    "border-color": "rgba(255, 95, 87, 0.5)",
                  }}
                  disabled={isPending}
                  onClick={() => void removeSavedConnection(connection.id)}
                >
                  Delete
                </button>
                <button
                  class="rounded-xl border px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    background: isConnected ? "#8e8e93" : "#28c840",
                    "border-color": isConnected
                      ? "rgba(142, 142, 147, 0.5)"
                      : "rgba(40, 200, 64, 0.5)",
                  }}
                  disabled={Boolean(pendingConnectionId())}
                  onClick={() =>
                    void (isConnected
                      ? disconnectConnection(connection.id)
                      : connectSavedConnection(connection))
                  }
                >
                  {isPending
                    ? "Connecting..."
                    : isConnected
                      ? "Disconnect"
                      : "Connect"}
                </button>
              </div>
            </div>
          );
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
            style={{ "border-color": "var(--app-border)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              class="flex items-start justify-between gap-4 border-b pb-4"
              style={{ "border-color": "var(--app-border)" }}
            >
              <div>
                <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">
                  History
                </p>
                <h3 class="theme-text mt-2 text-lg font-semibold">
                  Execution History
                </h3>
              </div>
              <button
                class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                onClick={() => setHistoryModalOpen(false)}
              >
                <ControlDot size="small" variant="delete" />
              </button>
            </div>
            <div class="mt-4 max-h-[55vh] overflow-auto">
              <div class="grid gap-2">
                <For each={getCurrentConnectionHistory(activeConnectionId())}>
                  {(item) => (
                    <button
                      class="theme-control grid gap-2 rounded-[18px] px-4 py-3 text-left"
                      onClick={() =>
                        void appendHistoryQueryToCurrentTab(item.query)
                      }
                    >
                      <div class="flex items-center justify-between gap-2">
                        <span
                          class={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.status === "success" ? "bg-[rgba(40,200,64,0.12)] text-[#1f8f3a]" : "bg-[rgba(255,95,87,0.12)] text-[#c2410c]"}`}
                        >
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
                <Show
                  when={
                    getCurrentConnectionHistory(activeConnectionId()).length ===
                    0
                  }
                >
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
        title={getConnectionTypeLabel(
          connectionDraftState.value?.kind ?? "postgresql",
        )}
        kind={connectionDraftState.value?.kind ?? "postgresql"}
        kinds={databaseKinds}
        renderKindLabel={getConnectionTypeLabel}
        showEnvironment={connectionModalMode() === "edit"}
        environment={connectionDraftState.value?.environment ?? "local"}
        aliasField={renderConfigField(
          "Alias",
          () => connectionDraftState.value!.name,
          (value) => setConnectionDraftState("value", "name", value),
        )}
        form={
          connectionDraftState.value ? (
            <DbConnectionDraftForm connection={connectionDraftState.value} />
          ) : (
            <div />
          )
        }
        onClose={closeConnectionModal}
        onKindChange={(kind) =>
          changeConnectionDraftKind(kind as DbConnectionKind)
        }
        onEnvironmentChange={(value) =>
          setConnectionDraftState(
            "value",
            "environment",
            value as DbConnection["environment"],
          )
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
              style={{ "border-color": "var(--app-border)" }}
            >
              <div
                class="flex items-start justify-between gap-4 border-b pb-4"
                style={{ "border-color": "var(--app-border)" }}
              >
                <div>
                  <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">
                    Export
                  </p>
                  <h3 class="theme-text mt-2 text-lg font-semibold">
                    {modal.databaseName}
                  </h3>
                </div>
                <button
                  class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                  onClick={() => closeDatabaseExportModal()}
                >
                  <ControlDot size="small" variant="delete" />
                </button>
              </div>

              <div class="mt-4 grid gap-3 md:grid-cols-2">
                <label class="theme-control flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={databaseExportIncludeDrop()}
                    onInput={(event) =>
                      setDatabaseExportIncludeDrop(event.currentTarget.checked)
                    }
                  />
                  <span>Include DROP DATABASE</span>
                </label>
                <label class="theme-control flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={databaseExportIncludeCreate()}
                    onInput={(event) =>
                      setDatabaseExportIncludeCreate(
                        event.currentTarget.checked,
                      )
                    }
                  />
                  <span>Include CREATE TABLE</span>
                </label>
                <label class="theme-control flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={databaseExportBulkInsert()}
                    onInput={(event) =>
                      setDatabaseExportBulkInsert(event.currentTarget.checked)
                    }
                  />
                  <span>Use bulk insert</span>
                </label>
                <label class="theme-control flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={databaseExportZip()}
                    onInput={(event) =>
                      setDatabaseExportZip(event.currentTarget.checked)
                    }
                  />
                  <span>Zip output</span>
                </label>
                <label class="grid gap-1 md:col-span-2">
                  <span class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
                    File Type
                  </span>
                  <select
                    class="theme-input h-9 rounded-xl px-3 text-sm"
                    value={databaseExportFormat()}
                    onInput={(event) =>
                      setDatabaseExportFormat(
                        event.currentTarget.value as "sql" | "csv" | "json",
                      )
                    }
                  >
                    <option value="sql">SQL</option>
                    <option value="csv">CSV</option>
                    <option value="json">JSON</option>
                  </select>
                </label>
              </div>

              <div class="mt-5 flex items-center justify-end gap-2">
                <button
                  class="theme-control h-8 rounded-md px-3 text-sm font-medium"
                  onClick={() => closeDatabaseExportModal()}
                >
                  Cancel
                </button>
                <button
                  class="theme-success h-8 rounded-md px-3 text-sm font-semibold"
                  onClick={() => downloadDatabaseExport()}
                >
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
          if (node.kind === "group") {
            const databaseName = node.label;
            const showExtendedMenu = connection.kind !== "redis";

            return (
              <DbContextMenu open={true} menu={menu} zIndex={305}>
                <button
                  class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                  onClick={() =>
                    void openConnectionTab(connection, true, databaseName)
                  }
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
                          { forceNew: true, resultView: "raw", databaseName },
                        )
                      }
                    >
                      New Table
                    </button>
                    <div
                      class="my-1 h-px"
                      style={{ background: "var(--app-border)" }}
                    />
                    <button
                      class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                      onClick={() => void copyTextValue(databaseName)}
                    >
                      Copy Name
                    </button>
                    <div
                      class="my-1 h-px"
                      style={{ background: "var(--app-border)" }}
                    />
                    <div class="group relative">
                      <button class="theme-sidebar-item flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm">
                        <span>Import</span>
                        <span class="theme-text-soft text-[10px]">&gt;</span>
                      </button>
                      <div
                        class="theme-panel-soft invisible absolute left-full top-0 z-[306] ml-1 grid min-w-[160px] auto-cols-max rounded-[18px] border p-1.5 opacity-0 shadow-[0_18px_45px_rgba(15,23,42,0.18)] transition group-hover:visible group-hover:opacity-100"
                        style={{ "border-color": "var(--app-border)" }}
                      >
                        <button
                          class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                          onClick={() =>
                            void openConnectionActionQuery(
                              connection,
                              `${databaseName} · Import SQL`,
                              buildImportTemplate(
                                connection,
                                databaseName,
                                "sql",
                              ),
                              {
                                forceNew: true,
                                resultView: "raw",
                                databaseName,
                              },
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
                              buildImportTemplate(
                                connection,
                                databaseName,
                                "json",
                              ),
                              {
                                forceNew: true,
                                resultView: "raw",
                                databaseName,
                              },
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
                              buildImportTemplate(
                                connection,
                                databaseName,
                                "csv",
                              ),
                              {
                                forceNew: true,
                                resultView: "raw",
                                databaseName,
                              },
                            )
                          }
                        >
                          From CSV
                        </button>
                      </div>
                    </div>
                    <button
                      class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
                      onClick={() =>
                        openDatabaseExportModal(connection.id, databaseName)
                      }
                    >
                      Export
                    </button>
                    <div
                      class="my-1 h-px"
                      style={{ background: "var(--app-border)" }}
                    />
                    <button
                      class="whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm text-[#b42318] transition hover:bg-[rgba(180,35,24,0.08)]"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Drop database \"${databaseName}\"? This only opens the command template.`,
                          )
                        ) {
                          return;
                        }
                        void openConnectionActionQuery(
                          connection,
                          `${databaseName} · Drop Database`,
                          buildDropDatabaseTemplate(connection, databaseName),
                          { forceNew: true, resultView: "raw", databaseName },
                        );
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
                      void openExplorerQuery(
                        connection,
                        node,
                        getNodeOpenQuery(connection, node),
                        {
                          forceNew: true,
                          source: buildSourceFromNode(node),
                        },
                      )
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
                      void openExplorerQuery(
                        connection,
                        node,
                        getNodeOpenQuery(connection, node),
                        {
                          forceNew: true,
                          titleSuffix: "Select",
                          source: buildSourceFromNode(node),
                        },
                      )
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
                  void openExplorerQuery(
                    connection,
                    node,
                    getNodeOpenQuery(connection, node),
                    {
                      forceNew: true,
                      source: buildSourceFromNode(node),
                    },
                  )
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
