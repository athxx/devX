import { For, Show, createSignal } from "solid-js";
import { ControlDot, RefreshIcon } from "../../../../components/ui-primitives";
import { DbAiSidebar } from "../ai/db-ai-sidebar";
import { shortcutLabel } from "../../../../lib/shortcuts";
import { compactQuery, formatQuery, supportsFormat } from "../../format";
import {
  DbCodeEditor,
  EDITOR_THEME_OPTIONS,
  isEditorThemeId,
} from "../db-code-editor";
import { DbEditorPane } from "../db-editor-pane";
import { DbResultsPane } from "../db-results-pane";
import { ShortcutHintButton } from "../db-icons";
import { DbResultsView } from "../grid/db-results-view";
import { DbStructureView } from "../structure/db-structure-view";
import { DbErView } from "../er/db-er-view";
import { DbSchemaDiffView } from "../diff/db-schema-diff-view";
import { DbDataCompareView } from "../diff/db-data-compare-view";
import { DbDataTransferView } from "../diff/db-data-transfer-view";
import { DbColumnLineageView } from "../diff/db-column-lineage-view";
import { DbFilePreviewView } from "../diff/db-file-preview-view";
import { useDbPanel } from "../db-panel-context";

export function DbEditorPaneView() {
  const {
    activeConnection,
    activeTab,
    editorPaneSplit,
    liveQueryByTabId,
    redisKeyNameDraftByTabId,
    redisKeyTtlDraftByTabId,
    schemaCompletionCache,
    setEditorPaneSplit,
    editorThemeId,
    setEditorThemeId,
    setHistoryModalOpen,
    setFavoritesModalOpen,
    setRedisKeyNameDraftByTabId,
    setRedisKeyTtlDraftByTabId,
    shortcutOverrides,
    schemaCompletionKey,
    getDefaultSchemaName,
    getActiveObjectDetail,
    getTabObjectDetail,
    getDetailSummaryValue,
    buildDatabaseTargetKey,
    getSameKindDatabaseTargets,
    switchActiveTabConnectionTarget,
    getRedisKeyTypeClass,
    refreshRedisKeyTab,
    saveRedisKey,
    deleteRedisKey,
    updateActiveQuery,
    getEffectiveQuery,
    applyTextResult,
    closeTab,
    runCurrentTab,
    runExplain,
    canExplainActiveTab,
    setActiveEditorView,
  } = useDbPanel();

  const [aiOpen, setAiOpen] = createSignal(false);

  function renderActiveTabPane() {
    const tab = activeTab();
    const connection = activeConnection();
    if (!tab || !connection) {
      return <div class="min-h-0 flex-1" />;
    }

    if (tab.type === "structure") {
      return <DbStructureView />;
    }

    if (tab.type === "er") {
      return <DbErView />;
    }

    if (tab.type === "schema-diff") {
      return <DbSchemaDiffView />;
    }

    if (tab.type === "data-compare") {
      return <DbDataCompareView />;
    }

    if (tab.type === "data-transfer") {
      return <DbDataTransferView />;
    }

    if (tab.type === "column-lineage") {
      return <DbColumnLineageView />;
    }

    if (tab.type === "file-preview") {
      return <DbFilePreviewView />;
    }

    const detail = getTabObjectDetail(tab) ?? getActiveObjectDetail();
    const databaseTargets = getSameKindDatabaseTargets(connection, {
      connectionId: tab.connectionId,
      databaseName: tab.databaseName ?? null,
    });
    const isRedisKeyTab =
      tab.type === "redis" && tab.source?.nodeKind === "key";
    const redisKeyType = getDetailSummaryValue(detail, "Type") || "key";
    const redisTtl =
      redisKeyTtlDraftByTabId()[tab.id] ??
      (getDetailSummaryValue(detail, "TTL") || "-1");
    const redisKeyName =
      redisKeyNameDraftByTabId()[tab.id] ?? tab.source?.label ?? "";
    const header = (
      <div
        class="border-b px-3 py-2"
        style={{ "border-color": "var(--app-border)" }}
      >
        <div class="flex flex-wrap items-center gap-2">
          <Show
            when={isRedisKeyTab}
            fallback={
              <>
                <select
                  class="theme-input h-8 min-w-[220px] rounded-md px-3 text-sm"
                  value={buildDatabaseTargetKey(
                    connection.id,
                    tab.databaseName ?? null,
                  )}
                  onInput={(event) =>
                    void switchActiveTabConnectionTarget(
                      event.currentTarget.value,
                    )
                  }
                >
                  <For each={databaseTargets}>
                    {(item) => <option value={item.key}>{item.label}</option>}
                  </For>
                </select>
                <button
                  class="theme-control h-8 rounded-md px-3 text-sm font-medium"
                  onClick={() => setHistoryModalOpen(true)}
                >
                  History
                </button>
                <button
                  class="theme-control h-8 rounded-md px-3 text-sm font-medium"
                  onClick={() => setFavoritesModalOpen(true)}
                >
                  Snippets
                </button>
                <select
                  class="theme-input h-8 rounded-md px-2 text-sm"
                  title="Editor theme"
                  value={editorThemeId()}
                  onInput={(event) => {
                    const next = event.currentTarget.value;
                    if (isEditorThemeId(next)) setEditorThemeId(next);
                  }}
                >
                  <For each={EDITOR_THEME_OPTIONS}>
                    {(item) => <option value={item.id}>{item.label}</option>}
                  </For>
                </select>
                <Show when={supportsFormat(connection.kind)}>
                  <ShortcutHintButton
                    class="theme-control h-8 rounded-md px-3 text-sm font-medium"
                    shortcut={shortcutLabel("compactQuery", shortcutOverrides())}
                    onClick={() => {
                      const text = getEffectiveQuery();
                      applyTextResult(compactQuery(connection.kind, text));
                    }}
                  >
                    Compact
                  </ShortcutHintButton>
                  <ShortcutHintButton
                    class="theme-control h-8 rounded-md px-3 text-sm font-medium"
                    shortcut={shortcutLabel("formatQuery", shortcutOverrides())}
                    onClick={() => {
                      const text = getEffectiveQuery();
                      void formatQuery(connection.kind, text).then((formatted) => {
                        applyTextResult(formatted);
                      });
                    }}
                  >
                    Pretty
                  </ShortcutHintButton>
                </Show>
                <Show when={canExplainActiveTab()}>
                  <button
                    class="theme-control h-8 rounded-md px-3 text-sm font-medium"
                    onClick={() => void runExplain()}
                  >
                    Explain
                  </button>
                </Show>
                <button
                  class="theme-control h-8 rounded-md px-3 text-sm font-medium"
                  classList={{ "theme-success": aiOpen() }}
                  title="AI 助手"
                  onClick={() => setAiOpen((v) => !v)}
                >
                  AI
                </button>
                <ShortcutHintButton
                  class="theme-success h-8 rounded-md px-3 text-sm font-semibold"
                  shortcut={shortcutLabel("runQuery", shortcutOverrides())}
                  onClick={() => void runCurrentTab()}
                >
                  Run
                </ShortcutHintButton>
              </>
            }
          >
            <span
              class={`inline-flex h-8 items-center rounded-md px-3 text-sm font-semibold ${getRedisKeyTypeClass(redisKeyType)}`}
            >
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
                if (value === "" || Number(value) >= -1) {
                  setRedisKeyTtlDraftByTabId((current) => ({
                    ...current,
                    [tab.id]: value,
                  }));
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
      <div class="flex h-full min-h-0 w-full">
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <DbEditorPane
        header={header}
        editorMeta={<></>}
        splitRatio={editorPaneSplit()}
        onSplitChange={setEditorPaneSplit}
        editor={
          <div class="h-full">
            <DbCodeEditor
              kind={connection.kind}
              themeId={editorThemeId()}
              schema={
                schemaCompletionCache()[
                  schemaCompletionKey(connection.id, tab.databaseName)
                ] ?? schemaCompletionCache()[connection.id]
              }
              defaultSchema={
                tab.databaseName || getDefaultSchemaName(connection)
              }
              value={liveQueryByTabId()[tab.id] ?? tab.query}
              onChange={(value) => updateActiveQuery(value)}
              onRun={() => void runCurrentTab()}
              onRunSelection={() => void runCurrentTab()}
              onCompact={() => {
                const text = getEffectiveQuery();
                applyTextResult(compactQuery(connection.kind, text));
              }}
              onFormat={() => {
                const text = getEffectiveQuery();
                void formatQuery(connection.kind, text).then((formatted) => {
                  applyTextResult(formatted);
                });
              }}
              onEditorReady={(view) => {
                setActiveEditorView(view);
              }}
              onCloseTab={() => {
                const tab = activeTab();
                if (tab) void closeTab(tab.id);
              }}
            />
          </div>
        }
        results={<DbResultsPane><DbResultsView /></DbResultsPane>}
      />
        </div>
        <Show when={aiOpen() && !isRedisKeyTab}>
          <DbAiSidebar onClose={() => setAiOpen(false)} />
        </Show>
      </div>
    );
  }

  return renderActiveTabPane();
}
