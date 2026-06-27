import { createMemo, For, Show } from "solid-js";
import { useDbPanel } from "../db-panel-context";
import { parseExplainPlan, type ExplainNode } from "./explain-plan";

/**
 * Renders the EXPLAIN result for the active tab as an indented plan tree with a
 * relative cost/rows bar beside each node (Phase 3C). Bars are plain divs —
 * no charting dependency. Falls back to a notice when the active result isn't
 * an explain-shaped SQL payload.
 */
export function DbExplainView() {
  const { activeTab, resultByTabId } = useDbPanel();

  const plan = createMemo(() => {
    const tab = activeTab();
    if (!tab) return null;
    const result = resultByTabId()[tab.id];
    if (result?.kind !== "sql") return null;
    const columns = result.data.columns ?? [];
    const rows = result.data.rows ?? [];
    if (columns.length === 0 || rows.length === 0) return null;
    return parseExplainPlan(columns, rows);
  });

  const maxMetric = createMemo(() => {
    const p = plan();
    if (!p || !p.metric) return 0;
    return p.nodes.reduce((max, node) => {
      const value = p.metric === "cost" ? node.cost : node.rows;
      return value !== undefined && value > max ? value : max;
    }, 0);
  });

  function nodeMetric(node: ExplainNode): number | undefined {
    const p = plan();
    if (!p?.metric) return undefined;
    return p.metric === "cost" ? node.cost : node.rows;
  }

  return (
    <Show
      when={plan()}
      fallback={
        <div class="theme-text-soft p-3 text-sm">
          No plan to show — run Explain on a query first.
        </div>
      }
    >
      <div class="flex min-h-0 flex-1 flex-col gap-2">
        <Show when={plan()!.metric}>
          <div class="theme-text-soft px-1 text-[10px] uppercase tracking-[0.14em]">
            Relative {plan()!.metric === "cost" ? "cost" : "rows"} per node
          </div>
        </Show>
        <div class="min-h-0 flex-1 overflow-auto">
          <table class="w-full border-collapse text-xs">
            <tbody>
              <For each={plan()!.nodes}>
                {(node) => {
                  const metric = nodeMetric(node);
                  const pct =
                    metric !== undefined && maxMetric() > 0
                      ? Math.max(2, (metric / maxMetric()) * 100)
                      : 0;
                  return (
                    <tr
                      class="hover:bg-[var(--app-hover)]"
                      style={{ "border-bottom": "1px solid var(--app-border)" }}
                    >
                      <td class="py-1.5 pr-3 align-top font-mono">
                        <span
                          style={{
                            "padding-left": `${node.depth * 14}px`,
                          }}
                          class="theme-text whitespace-pre-wrap break-words"
                        >
                          {node.label}
                        </span>
                      </td>
                      <td class="w-[40%] py-1.5 align-middle">
                        <Show when={metric !== undefined}>
                          <div class="flex items-center gap-2">
                            <div
                              class="h-3 rounded-sm"
                              style={{
                                width: `${pct}%`,
                                background: "var(--app-accent)",
                                opacity: "0.7",
                              }}
                            />
                            <span class="theme-text-soft tabular-nums text-[10px]">
                              {metric}
                            </span>
                          </div>
                        </Show>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </div>
    </Show>
  );
}
