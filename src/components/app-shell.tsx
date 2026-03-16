import type { JSX, ParentComponent } from "solid-js";

type AppShellProps = {
  title: string;
  subtitle: string;
  actions?: JSX.Element;
  compact?: boolean;
};

export const AppShell: ParentComponent<AppShellProps> = (props) => {
  return (
    <main
      class={`grid-bg min-h-screen text-ink-200 ${
        props.compact ? "p-4" : "p-5 md:p-7"
      }`}
    >
      <div class="mx-auto flex max-w-6xl flex-col gap-5">
        <header class="rounded-3xl border border-white/10 bg-white/6 p-5 shadow-panel backdrop-blur">
          <div class="flex items-start justify-between gap-4">
            <div class="space-y-2">
              <span class="inline-flex rounded-full border border-accent-400/30 bg-accent-500/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-accent-400">
                SolidJS + UnoCSS
              </span>
              <div class="space-y-1">
                <h1 class="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                  {props.title}
                </h1>
                <p class="max-w-3xl text-sm leading-6 text-white/72 md:text-base">
                  {props.subtitle}
                </p>
              </div>
            </div>
            {props.actions}
          </div>
        </header>
        {props.children}
      </div>
    </main>
  );
};

