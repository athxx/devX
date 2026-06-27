import { createMemo, createSignal, For, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { useDbPanel } from "../db-panel-context";
import {
  buildAlterTableDdl,
  toColumnDrafts,
  type StructureColumnDraft,
} from "./structure-ddl";

/**
 * Table structure editor (Phase 3B). Renders the loaded object detail as an
 * editable column grid and previews the ALTER TABLE DDL implied by the edits.
 * It never executes anything: "Open in editor" drops the generated DDL into a
 * fresh query tab for the user to review and run by hand.
 */
export function DbStructureView() {
  const {
    activeConnection,
    activeTab,
    getTabObjectDetail,
    getActiveObjectDetail,
    openDdlTab,
  } = useDbPanel();

  const tab = activeTab();
  const connection = activeConnection();
  const detail = tab
    ? (getTabObjectDetail(tab) ?? getActiveObjectDetail())
    : undefined;
  const originalColumns = detail?.columns ?? [];

  const [drafts, setDrafts] = createStore<StructureColumnDraft[]>(
    toColumnDrafts(originalColumns),
  );
  const [copied, setCopied] = createSignal(false);

  const qualifiedName =
    tab?.source?.qualifiedName ?? tab?.source?.label ?? "table";

  const ddl = createMemo(() =>
    buildAlterTableDdl(qualifiedName, originalColumns, [...drafts]),
  );

  function updateDraft(
    index: number,
    patch: Partial<StructureColumnDraft>,
  ) {
    setDrafts(
      index,
      produce((row) => Object.assign(row, patch)),
    );
  }

  function addColumn() {
    setDrafts(drafts.length, {
      name: "new_column",
      type: "text",
      nullable: true,
      defaultValue: "",
      dropped: false,
    });
  }

  function primaryKeys() {
    return new Set(detail?.primaryKeys ?? []);
  }

  if (!tab || !connection) {
    return <div class="min-h-0 flex-1" />;
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div
        class="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2"
        style={{ "border-color": "var(--app-border)" }}
      >
        <div class="flex items-center gap-2">
          <span class="theme-text text-sm font-semibold">{qualifiedName}</span>
          <span class="theme-text-soft text-[11px]">
            {originalColumns.length} columns
          </span>
        </div>
        <button
          class="theme-control h-7 rounded-md px-2.5 text-[11px] font-medium"
          onClick={addColumn}
        >
          + Column
        </button>
      </div>

      <Show
        when={originalColumns.length > 0}
        fallback={
          <div class="theme-text-soft p-4 text-sm">
            No column metadata available for this object.
          </div>
        }
      >
        <div class="min-h-0 flex-1 overflow-auto">
          <table class="w-full border-collapse text-xs">
            <thead class="sticky top-0 z-10">
              <tr>
                <For
                  each={["Name", "Type", "Nullable", "Default", "PK", ""]}
                >
                  {(label) => (
                    <th
                      class="whitespace-nowrap px-2.5 py-1.5 text-left text-[11px] font-semibold"
                      style={{
                        background: "var(--app-surface)",
                        color: "var(--app-text-soft)",
                        "border-bottom": "1px solid var(--app-border)",
                      }}
                    >
                      {label}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={drafts}>
                {(row, index) => (
                  <tr
                    classList={{ "opacity-40 line-through": row.dropped }}
                    class="hover:bg-[var(--app-hover)]"
                    style={{ "border-bottom": "1px solid var(--app-border)" }}
                  >
                    <td class="px-2 py-1">
                      <input
                        class="theme-input h-7 w-full rounded px-1.5 text-xs"
                        value={row.name}
                        disabled={row.dropped}
                        onInput={(e) =>
                          updateDraft(index(), { name: e.currentTarget.value })
                        }
                      />
                    </td>
                    <td class="px-2 py-1">
                      <input
                        class="theme-input h-7 w-full rounded px-1.5 text-xs"
                        value={row.type}
                        disabled={row.dropped}
                        onInput={(e) =>
                          updateDraft(index(), { type: e.currentTarget.value })
                        }
                      />
                    </td>
                    <td class="px-2 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={row.nullable}
                        disabled={row.dropped}
                        onChange={(e) =>
                          updateDraft(index(), {
                            nullable: e.currentTarget.checked,
                          })
                        }
                      />
                    </td>
                    <td class="px-2 py-1">
                      <input
                        class="theme-input h-7 w-full rounded px-1.5 text-xs"
                        value={row.defaultValue}
                        disabled={row.dropped}
                        placeholder="—"
                        onInput={(e) =>
                          updateDraft(index(), {
                            defaultValue: e.currentTarget.value,
                          })
                        }
                      />
                    </td>
                    <td class="px-2 py-1 text-center">
                      <Show
                        when={
                          row.originalName &&
                          primaryKeys().has(row.originalName)
                        }
                      >
                        <span class="text-[var(--app-accent)]">●</span>
                      </Show>
                    </td>
                    <td class="px-2 py-1 text-right">
                      <button
                        class="theme-control h-6 rounded px-2 text-[10px]"
                        onClick={() =>
                          updateDraft(index(), { dropped: !row.dropped })
                        }
                      >
                        {row.dropped ? "Undo" : "Drop"}
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>

        <div
          class="flex min-h-0 shrink-0 flex-col border-t"
          style={{ "border-color": "var(--app-border)", "max-height": "40%" }}
        >
          <div
            class="flex shrink-0 items-center justify-between px-3 py-1.5"
            style={{ "border-bottom": "1px solid var(--app-border)" }}
          >
            <span class="theme-text-soft text-[10px] uppercase tracking-[0.14em]">
              ALTER preview
            </span>
            <div class="flex items-center gap-2">
              <button
                class="theme-control h-7 rounded-md px-2.5 text-[11px]"
                disabled={!ddl()}
                onClick={() => {
                  if (!ddl() || !navigator?.clipboard?.writeText) return;
                  void navigator.clipboard.writeText(ddl()).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  });
                }}
              >
                {copied() ? "Copied" : "Copy"}
              </button>
              <button
                class="theme-success h-7 rounded-md px-2.5 text-[11px] font-semibold"
                disabled={!ddl()}
                onClick={() =>
                  void openDdlTab(
                    connection,
                    `${tab.title.split(" · ").at(-1) ?? "table"} · ALTER`,
                    ddl(),
                  )
                }
              >
                Open in editor
              </button>
            </div>
          </div>
          <div class="min-h-0 flex-1 overflow-auto p-3">
            <Show
              when={ddl()}
              fallback={
                <p class="theme-text-soft text-xs">
                  Edit a column above to preview the ALTER statements.
                </p>
              }
            >
              <pre class="m-0 whitespace-pre-wrap break-words font-mono text-xs">
                {ddl()}
              </pre>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
