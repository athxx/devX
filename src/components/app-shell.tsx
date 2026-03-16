import type { JSX, ParentComponent } from "solid-js";

type AppShellProps = {
  title: string;
  subtitle?: string;
  actions?: JSX.Element;
  nav?: JSX.Element;
  compact?: boolean;
  workspace?: boolean;
};

export const AppShell: ParentComponent<AppShellProps> = (props) => {
  if (props.workspace) {
    return (
      <main class="grid-bg min-h-screen theme-text">
        <div class="min-h-screen">
          <header
            class="sticky top-0 z-20 border-b backdrop-blur-xl"
            style={{
              "border-color": "var(--app-border)",
              background: "var(--app-header)"
            }}
          >
            <div class="flex h-9 items-center justify-between gap-3 px-4 md:px-5">
              <div class="min-w-0 flex-1">{props.nav}</div>
              <div class="shrink-0">{props.actions}</div>
            </div>
          </header>
          <div class="px-4 py-4 md:px-6 md:py-5">{props.children}</div>
        </div>
      </main>
    );
  }

  return (
    <main
      class={`grid-bg min-h-screen text-ink-200 ${
        props.compact ? "p-4" : "p-5 md:p-7"
      }`}
    >
      <div class="mx-auto flex max-w-6xl flex-col gap-5">
        <header class="theme-panel rounded-3xl p-5">
          <div class="flex items-start justify-between gap-4">
            <div class="space-y-2">
              <span class="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] theme-eyebrow">
                SolidJS + UnoCSS
              </span>
              <div class="space-y-1">
                <h1 class="text-2xl font-semibold tracking-tight theme-text md:text-3xl">
                  {props.title}
                </h1>
                <p class="max-w-3xl text-sm leading-6 theme-text-muted md:text-base">
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
