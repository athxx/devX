export function ControlDot(props: { variant: "add" | "delete" | "menu" | "warn" }) {
  return <span class={`traffic-dot traffic-dot-${props.variant}`} aria-hidden="true" />;
}

export function FormatJsonIcon() {
  return (
    <svg class="block h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6.75 4.5 4.5 10l2.25 5.5M13.25 4.5 15.5 10l-2.25 5.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4"/>
      <path d="M9.25 6.25h3.5M8.75 10h2.5M7.75 13.75h4.5" stroke="currentColor" stroke-linecap="round" stroke-width="1.4"/>
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
