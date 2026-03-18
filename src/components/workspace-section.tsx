import type { JSX, ParentComponent } from "solid-js";
import { Show } from "solid-js";

type WorkspaceSectionProps = {
  eyebrow?: string;
  title?: string;
  class?: string;
  compact?: boolean;
};

export const WorkspaceSection: ParentComponent<WorkspaceSectionProps> = (props) => {
  const paddingClass = () => (props.compact ? "px-3 py-2" : "px-4 py-4");
  const headerMarginClass = () => (props.compact ? "mb-3 space-y-0.5" : "mb-4 space-y-1");
  const eyebrowClass = () =>
    props.compact
      ? "theme-eyebrow text-[10px] font-semibold uppercase tracking-[0.18em]"
      : "theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]";
  const titleClass = () => (props.compact ? "theme-text text-sm font-semibold" : "theme-text text-base font-semibold");

  return (
    <section
      class={`border-t ${paddingClass()} ${props.class ?? ""}`}
      style={{ "border-color": "var(--app-border)" }}
    >
      <Show when={props.eyebrow || props.title}>
        <div class={headerMarginClass()}>
          <Show when={props.eyebrow}>
            <p class={eyebrowClass()}>{props.eyebrow}</p>
          </Show>
          <Show when={props.title}>
            <h2 class={titleClass()}>{props.title}</h2>
          </Show>
        </div>
      </Show>
      {props.children}
    </section>
  );
};
