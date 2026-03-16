import type { ToolDefinition } from "../app/tool-registry";

type ToolCardProps = {
  tool: ToolDefinition;
};

export function ToolCard(props: ToolCardProps) {
  const isReady = props.tool.status === "ready";

  return (
    <article class="rounded-2xl border border-white/10 bg-white/4 p-4 transition hover:border-accent-400/40 hover:bg-white/7">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-medium text-white">{props.tool.name}</p>
          <p class="text-xs uppercase tracking-[0.18em] text-white/45">
            {props.tool.category}
          </p>
        </div>
        <span
          class={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
            isReady
              ? "bg-accent-500/15 text-accent-400"
              : "bg-signal-500/15 text-signal-400"
          }`}
        >
          {isReady ? "Ready" : "Planned"}
        </span>
      </div>
      <p class="text-sm leading-6 text-white/72">{props.tool.summary}</p>
    </article>
  );
}

