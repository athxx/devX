import type { ParentComponent } from "solid-js";

type SectionCardProps = {
  title: string;
  eyebrow?: string;
};

export const SectionCard: ParentComponent<SectionCardProps> = (props) => {
  return (
    <section class="theme-panel rounded-3xl p-5">
      <div class="mb-4 space-y-1">
        {props.eyebrow ? (
          <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">
            {props.eyebrow}
          </p>
        ) : null}
        <h2 class="theme-text text-lg font-semibold">{props.title}</h2>
      </div>
      {props.children}
    </section>
  );
};
