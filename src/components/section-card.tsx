import type { ParentComponent } from "solid-js";

type SectionCardProps = {
  title: string;
  eyebrow?: string;
};

export const SectionCard: ParentComponent<SectionCardProps> = (props) => {
  return (
    <section class="rounded-3xl border border-white/10 bg-ink-900/72 p-5 shadow-panel backdrop-blur">
      <div class="mb-4 space-y-1">
        {props.eyebrow ? (
          <p class="text-xs font-semibold uppercase tracking-[0.22em] text-accent-400">
            {props.eyebrow}
          </p>
        ) : null}
        <h2 class="text-lg font-semibold text-white">{props.title}</h2>
      </div>
      {props.children}
    </section>
  );
};

