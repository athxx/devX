// dbx-fidelity menu models for the DB panel. Each builder turns a menu target
// (connection / explorer node / tab) into a ContextMenuItem[] consumed by the
// single declarative `ContextMenu` renderer (db-menu.tsx). This replaces the
// hand-rolled <button> menus that previously lived inline in db-panel.tsx so
// every menu shares dbx's icons, submenus, shortcuts and destructive styling.
//
// Actions bind to the existing useDbPanel() contract — no behaviour is changed,
// only the presentation layer is unified and brought to dbx fidelity.
import type { ContextMenuItem } from "./db-menu";
import { getDbAdapter } from "../adapters/registry";
import type { useDbPanel } from "./db-panel-context";
import type {
  DbConnection,
  DbExplorerGroupNode,
  DbExplorerLeafNode,
  DbExplorerNode,
} from "../models";

/** The full useDbPanel() contract the menu builders bind their actions to. */
export type DbMenuActions = ReturnType<typeof useDbPanel>;

const SEPARATOR: ContextMenuItem = { separator: true };

/** Connection-row right-click menu (mirrors dbx connection node menu). */
export function connectionMenuItems(
  connection: DbConnection,
  api: DbMenuActions,
): ContextMenuItem[] {
  const adapter = getDbAdapter(connection.kind);
  const summaryResultView =
    adapter.isDocumentStore() ||
    adapter.isSearchStore() ||
    adapter.isWideColumn()
      ? ("raw" as const)
      : ("table" as const);

  return [
    {
      label: "New Query",
      icon: "TerminalSquare",
      action: () => void api.openConnectionTab(connection, true),
    },
    {
      label: "Refresh",
      icon: "RefreshCw",
      action: () => void api.refreshConnectionExplorer(connection),
    },
    {
      label: "Create Database",
      icon: "Plus",
      visible: api.canCreateDatabase(connection),
      action: () =>
        void api.openConnectionActionQuery(
          connection,
          "Create Database",
          api.buildCreateDatabaseTemplate(connection),
          { forceNew: true, resultView: "raw" },
        ),
    },
    {
      label: "Summary",
      icon: "ListTree",
      visible: api.canShowConnectionSummary(connection),
      action: () =>
        void api.openConnectionActionQuery(
          connection,
          "Summary",
          api.buildConnectionSummaryQuery(connection),
          { forceNew: true, resultView: summaryResultView },
        ),
    },
    {
      label: "Schema Diff",
      icon: "ArrowRightLeft",
      visible: adapter.isRelational(),
      action: () => void api.openSchemaDiffTab(connection),
    },
    SEPARATOR,
    {
      label: "Disconnect",
      icon: "Unplug",
      variant: "destructive",
      action: () => void api.disconnectConnection(connection.id),
    },
  ];
}

/** Database/schema group-node right-click menu. */
function databaseGroupMenuItems(
  connection: DbConnection,
  node: DbExplorerGroupNode,
  api: DbMenuActions,
): ContextMenuItem[] {
  const databaseName = node.label;
  const adapter = getDbAdapter(connection.kind);
  const showExtended =
    !adapter.isKeyValueStore() &&
    !adapter.isSearchStore() &&
    !adapter.isWideColumn();

  const items: ContextMenuItem[] = [
    {
      label: "New Query",
      icon: "TerminalSquare",
      action: () => void api.openConnectionTab(connection, true, databaseName),
    },
  ];

  if (showExtended) {
    items.push(
      {
        label: "New Table",
        icon: "TableProperties",
        action: () =>
          void api.openConnectionActionQuery(
            connection,
            `${databaseName} · New Table`,
            api.buildCreateTableTemplate(connection, databaseName),
            { forceNew: true, resultView: "raw", databaseName },
          ),
      },
      {
        label: "ER Diagram",
        icon: "Network",
        action: () => void api.openErTab(connection, databaseName),
      },
      SEPARATOR,
      {
        label: "Copy Name",
        icon: "Copy",
        action: () => void api.copyTextValue(databaseName),
      },
      SEPARATOR,
      {
        label: "Import",
        icon: "Upload",
        children: [
          {
            label: "From CSV file…",
            icon: "FileSpreadsheet",
            action: () => void api.importCsvFile(connection, databaseName),
          },
          ...(["sql", "json", "csv"] as const).map((format) => ({
            label: `${format.toUpperCase()} template`,
            icon: "FileCode" as const,
            action: () =>
              void api.openConnectionActionQuery(
                connection,
                `${databaseName} · Import ${format.toUpperCase()}`,
                api.buildImportTemplate(connection, databaseName, format),
                { forceNew: true, resultView: "raw", databaseName },
              ),
          })),
        ],
      },
      {
        label: "Export",
        icon: "Download",
        action: () => api.openDatabaseExportModal(connection.id, databaseName),
      },
      SEPARATOR,
      {
        label: "Drop Database",
        icon: "Trash2",
        variant: "destructive",
        action: () => {
          if (
            !window.confirm(
              `Drop database "${databaseName}"? This only opens the command template.`,
            )
          ) {
            return;
          }
          void api.openConnectionActionQuery(
            connection,
            `${databaseName} · Drop Database`,
            api.buildDropDatabaseTemplate(connection, databaseName),
            { forceNew: true, resultView: "raw", databaseName },
          );
        },
      },
    );
  }

  return items;
}

/** Table/view/function leaf right-click menu. */
function leafNodeMenuItems(
  connection: DbConnection,
  node: DbExplorerLeafNode,
  api: DbMenuActions,
): ContextMenuItem[] {
  const qualifiedName = node.qualifiedName ?? node.label;
  const isTableLike = node.kind === "table" || node.kind === "view";
  const isSqlObject =
    node.kind === "table" ||
    node.kind === "view" ||
    node.kind === "function";
  const source = () => api.buildSourceFromNode(node);

  const items: ContextMenuItem[] = [];

  if (isTableLike) {
    items.push(
      {
        label: "Inspect",
        icon: "Search",
        action: () => void api.inspectExplorerLeaf(connection, node),
      },
      {
        label: "Open data",
        icon: "Table2",
        action: () =>
          void api.openExplorerQuery(
            connection,
            node,
            api.getNodeOpenQuery(connection, node),
            { forceNew: true, source: source() },
          ),
      },
    );
    if (api.canCompareData(connection)) {
      items.push(
        {
          label: "Compare data…",
          icon: "ArrowRightLeft",
          action: () => void api.openDataCompareTab(connection, node),
        },
        {
          label: "Transfer data…",
          icon: "ArrowRight",
          action: () => void api.openDataTransferTab(connection, node),
        },
        {
          label: "Column lineage…",
          icon: "GitBranch",
          action: () => void api.openColumnLineageTab(connection, node),
        },
      );
    }
  }

  if (isSqlObject) {
    items.push(
      {
        label: "Open structure",
        icon: "PencilRuler",
        action: () =>
          void api.openExplorerQuery(
            connection,
            node,
            api.buildExplorerStructureQuery(connection, node),
            {
              forceNew: true,
              titleSuffix: "Structure",
              tabType: "structure",
              source: source(),
            },
          ),
      },
      {
        label: "Show SQL",
        icon: "FileCode",
        action: () =>
          void api.openExplorerQuery(
            connection,
            node,
            api.buildExplorerShowSqlQuery(connection, node),
            { forceNew: true, titleSuffix: "SQL" },
          ),
      },
    );
  }

  if (isTableLike || isSqlObject) items.push(SEPARATOR);

  if (isTableLike) {
    items.push(
      {
        label: "Select template",
        icon: "Code2",
        action: () =>
          void api.openExplorerQuery(
            connection,
            node,
            api.getNodeOpenQuery(connection, node),
            { forceNew: true, titleSuffix: "Select", source: source() },
          ),
      },
      {
        label: "Insert template",
        icon: "Plus",
        action: () =>
          void api.openExplorerQuery(
            connection,
            node,
            `INSERT INTO ${qualifiedName} ()\nVALUES ();`,
            { forceNew: true, titleSuffix: "Insert" },
          ),
      },
      {
        label: "Update template",
        icon: "Pencil",
        action: () =>
          void api.openExplorerQuery(
            connection,
            node,
            `UPDATE ${qualifiedName}\nSET \nWHERE ;`,
            { forceNew: true, titleSuffix: "Update" },
          ),
      },
      {
        label: "Delete template",
        icon: "Eraser",
        action: () =>
          void api.openExplorerQuery(
            connection,
            node,
            `DELETE FROM ${qualifiedName}\nWHERE ;`,
            { forceNew: true, titleSuffix: "Delete" },
          ),
      },
    );
  }

  if (node.countQuery) {
    items.push({
      label: "COUNT(*)",
      icon: "Sigma",
      action: () =>
        void api.openExplorerQuery(connection, node, node.countQuery!, {
          forceNew: true,
          titleSuffix: "Count",
        }),
    });
  }

  if (node.kind === "table") {
    items.push(
      SEPARATOR,
      {
        label: "Rename table",
        icon: "Pencil",
        action: () =>
          void api.openExplorerQuery(
            connection,
            node,
            api.buildExplorerRenameQuery(connection, node),
            { forceNew: true, titleSuffix: "Rename" },
          ),
      },
      {
        label: "Truncate table",
        icon: "Scissors",
        variant: "destructive",
        action: () =>
          void api.openExplorerQuery(
            connection,
            node,
            api.buildExplorerTruncateQuery(connection, node),
            { forceNew: true, titleSuffix: "Truncate" },
          ),
      },
      {
        label: "Drop table",
        icon: "Trash2",
        variant: "destructive",
        action: () =>
          void api.openExplorerQuery(
            connection,
            node,
            `DROP TABLE ${qualifiedName};`,
            { forceNew: true, titleSuffix: "Drop" },
          ),
      },
      {
        label: "Copy table name",
        icon: "Copy",
        action: () => void api.copyExplorerNodeName(node),
      },
    );
  }

  items.push(SEPARATOR, {
    label: "Open In New Tab",
    icon: "Maximize2",
    action: () =>
      void api.openExplorerQuery(
        connection,
        node,
        api.getNodeOpenQuery(connection, node),
        { forceNew: true, source: source() },
      ),
  });

  return items;
}

/** Explorer-node right-click menu (dispatches by node kind). */
export function explorerNodeMenuItems(
  connection: DbConnection,
  node: DbExplorerNode,
  api: DbMenuActions,
): ContextMenuItem[] {
  if (node.kind === "group") {
    return databaseGroupMenuItems(connection, node, api);
  }
  return leafNodeMenuItems(connection, node, api);
}

/** Tab right-click menu (mirrors dbx AppTabBar menu). */
export function tabMenuItems(
  tabId: string,
  isPinned: boolean,
  api: DbMenuActions,
): ContextMenuItem[] {
  return [
    {
      label: isPinned ? "Unpin Tab" : "Pin Tab",
      icon: "Pin",
      action: () => void api.togglePinnedTab(tabId),
    },
    {
      label: "Rename",
      icon: "Pencil",
      action: () => api.promptRenameTab(tabId),
    },
    {
      label: "Duplicate Tab",
      icon: "CopyPlus",
      action: () => void api.duplicateTab(tabId),
    },
    {
      label: "Copy Name",
      icon: "Copy",
      action: () => void api.copyTabName(tabId),
    },
    SEPARATOR,
    {
      label: "Close Others",
      icon: "SquareDashed",
      action: () => void api.closeOtherTabs(tabId),
    },
    {
      label: "Close All",
      icon: "Trash2",
      variant: "destructive",
      action: () => void api.closeAllTabs(),
    },
  ];
}
