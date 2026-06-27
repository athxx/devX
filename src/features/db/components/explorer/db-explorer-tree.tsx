import type { JSX } from "solid-js";
import { For, Show } from "solid-js";
import { ControlDot } from "../../../../components/ui-primitives";
import type { DbConnection, DbExplorerNode } from "../../models";
import {
  DatabaseFolderIcon,
  DatabaseStackIcon,
  ExplorerLeafIcon,
  TreeChevronIcon,
} from "../db-icons";
import {
  describeConnection,
  getConnectionBadge,
  useDbPanel,
} from "../db-panel-context";

export function DbExplorerTree(props: { connection: DbConnection }): JSX.Element {
  const {
    activeConnectionId,
    explorerByConnectionId,
    normalizedFilter,
    setConnectionMenu,
    setExplorerNodeMenu,
    setTabMenu,
    isConnectionExpanded,
    isExplorerNodeExpanded,
    loadingExplorerNodeIds,
    loadConnectionExplorer,
    toggleConnectionExpanded,
    toggleExplorerNodeExpanded,
    expandExplorerGroupNode,
    selectConnectedConnection,
    openConnectionTab,
    openExplorerLeaf,
    nodeMatchesFilter,
    groupOrLeafMatchesFilter,
  } = useDbPanel();

  function renderExplorerNode(
    connection: DbConnection,
    node: DbExplorerNode,
    depth: number,
  ): JSX.Element {
    const paddingLeft = `${depth * 14 + 12}px`;

    if (node.kind === "group") {
      const filterActive = () => Boolean(normalizedFilter());
      const expanded = () => filterActive() || isExplorerNodeExpanded(node.id);
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
              <For each={node.children.filter((child) => groupOrLeafMatchesFilter(child, normalizedFilter()))}>
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
    const filteredNodes = () => {
      const filter = normalizedFilter();
      const nodes = explorer().nodes;
      if (!filter) return nodes;
      return nodes.filter((node) => nodeMatchesFilter(node, filter));
    };

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
              <p
                class="truncate text-[13px] font-medium"
                title={connection.name}
              >
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
                explorer().status === "ready" && filteredNodes().length === 0
              }
            >
              <div class="theme-text-soft px-2 py-1 text-[11px]">
                No objects found.
              </div>
            </Show>
            <For each={filteredNodes()}>
              {(node) => renderExplorerNode(connection, node, 1)}
            </For>
          </div>
        </Show>
      </div>
    );
  }


  return renderConnectedConnectionRow(props.connection);
}
