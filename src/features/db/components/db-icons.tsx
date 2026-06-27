import type { JSX } from "solid-js";
import { Show, createSignal, onCleanup } from "solid-js";

export function DatabaseFolderIcon(props: { active?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      class={`h-4 w-4 shrink-0 ${
        props.active
          ? "text-[var(--app-accent)]"
          : "text-[var(--app-text-soft)]"
      }`}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2.5 6.25a1.75 1.75 0 0 1 1.75-1.75h4.09c.48 0 .94.2 1.27.55l.58.62c.33.35.79.55 1.27.55h4.29A1.75 1.75 0 0 1 17.5 8v6.25A1.75 1.75 0 0 1 15.75 16H4.25A1.75 1.75 0 0 1 2.5 14.25V6.25Z"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
      <path
        d="M2.75 8.25h14.5"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
  );
}

export function DatabaseStackIcon(props: { active?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      class={`h-4 w-4 shrink-0 ${
        props.active
          ? "text-[var(--app-accent)]"
          : "text-[var(--app-text-soft)]"
      }`}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <ellipse
        cx="10"
        cy="5"
        rx="6.25"
        ry="2.5"
        stroke="currentColor"
        stroke-width="1.4"
      />
      <path
        d="M3.75 5V10C3.75 11.38 6.55 12.5 10 12.5C13.45 12.5 16.25 11.38 16.25 10V5"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
      <path
        d="M3.75 10V15C3.75 16.38 6.55 17.5 10 17.5C13.45 17.5 16.25 16.38 16.25 15V10"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
  );
}

export function TreeChevronIcon(props: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      class={`h-3 w-3 transition-transform ${
        props.expanded ? "rotate-90" : ""
      }`}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6 4.5L9.5 8L6 11.5"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function ExplorerLeafIcon(props: {
  kind: "table" | "view" | "function" | "collection" | "key";
}) {
  return (
    <span
      class={`inline-flex h-5 min-w-[30px] items-center justify-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${
        props.kind === "view"
          ? "theme-method-badge theme-method-head"
          : props.kind === "function"
            ? "theme-method-badge theme-method-post"
            : props.kind === "collection"
              ? "theme-method-badge theme-method-trace"
              : props.kind === "key"
                ? "theme-method-badge theme-method-patch"
                : "theme-method-badge theme-method-get"
      }`}
    >
      {props.kind === "view"
        ? "VIEW"
        : props.kind === "function"
          ? "FUNC"
          : props.kind === "collection"
            ? "COL"
            : props.kind === "key"
              ? "KEY"
              : "TAB"}
    </span>
  );
}

export function ShortcutHintButton(
  props: {
    class: string;
    shortcut: string;
    onClick: () => void;
    children: JSX.Element;
  },
) {
  const [showHint, setShowHint] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onEnter = () => {
    timer = setTimeout(() => setShowHint(true), 500);
  };
  const onLeave = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    setShowHint(false);
  };

  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  return (
    <div class="relative inline-flex">
      <button
        class={props.class}
        onClick={props.onClick}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {props.children}
      </button>
      <Show when={showHint()}>
        <div
          class="theme-text-soft pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium"
          style={{ background: "var(--app-surface, #1e1e1e)", border: "1px solid var(--app-border)" }}
        >
          {props.shortcut}
        </div>
      </Show>
    </div>
  );
}
