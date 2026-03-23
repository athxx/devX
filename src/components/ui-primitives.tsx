import type { JSX } from "solid-js";
import { Show } from "solid-js";

export function ControlDot(props: {
  size: "small" | "mid" | "big";
  variant: "add" | "delete" | "menu" | "warn";
}) {
  return (
    <span
      class={`traffic-dot-${props.size} traffic-dot-${props.variant}`}
      aria-hidden="true"
    />
  );
}

export function FormatJsonIcon() {
  return (
    <svg
      class="block h-4 w-4"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6.75 4.5 4.5 10l2.25 5.5M13.25 4.5 15.5 10l-2.25 5.5"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.4"
      />
      <path
        d="M9.25 6.25h3.5M8.75 10h2.5M7.75 13.75h4.5"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.4"
      />
    </svg>
  );
}

export function PinIcon() {
  return (
    <svg
      aria-hidden="true"
      class="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12.9 3.4c-.7.7-.7 1.8 0 2.5l.3.3-2.4 2.4-2.1-.4-1.1 1.1 3.3 1-3.8 3.8a.7.7 0 1 0 1 1l3.8-3.8 1 3.3 1.1-1.1-.4-2.1 2.4-2.4.3.3c.7.7 1.8.7 2.5 0l-6-6Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg
      aria-hidden="true"
      class="h-[14px] w-4"
      fill="none"
      viewBox="0 0 24 21"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20.21 8.081a1.162 1.162 0 0 1 1.64 0l1.81 1.807a1.162 1.162 0 0 1-.821 1.983h-.713c-.577 5.084-4.899 9.032-10.14 9.032a10.197 10.197 0 0 1-8.092-3.98 1.161 1.161 0 0 1 1.84-1.418 7.874 7.874 0 0 0 6.251 3.076 7.882 7.882 0 0 0 7.798-6.71h-.562a1.162 1.162 0 0 1-.82-1.983l1.808-1.807zM12.014 0c3.31 0 6.254 1.576 8.117 4.014a1.162 1.162 0 0 1-1.845 1.41 7.874 7.874 0 0 0-6.272-3.102 7.881 7.881 0 0 0-7.798 6.71h.562a1.162 1.162 0 0 1 .82 1.984L3.792 12.82a1.162 1.162 0 0 1-1.641 0L.34 11.016a1.162 1.162 0 0 1 .821-1.984h.713C2.451 3.948 6.773 0 12.014 0z"
        fill="#676767"
      />
    </svg>
  );
}

export function EditorToggle(props: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      class={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
        props.active
          ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
          : "theme-text-soft hover:text-[var(--app-text)]"
      }`}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

export function FieldLabel(props: {
  label: string;
  hint?: string;
  children: JSX.Element;
}) {
  return (
    <label class="grid gap-2">
      <span class="theme-text text-sm font-medium">{props.label}</span>
      <Show when={props.hint}>
        <span class="theme-text-soft text-xs leading-5">{props.hint}</span>
      </Show>
      {props.children}
    </label>
  );
}
