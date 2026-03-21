import {
  For,
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { ControlDot } from "../../../components/ui-primitives";
import type { KeyValueEntry } from "../models";

function ColumnResizeHandle(props: {
  onMouseDown: (event: MouseEvent) => void;
}) {
  return (
    <div class="relative h-full w-full">
      <button
        class="group absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 cursor-col-resize bg-transparent p-0"
        aria-label="Resize key and value columns"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onMouseDown(event);
        }}
      >
        <span
          class="mx-auto block h-full w-px transition group-hover:bg-[var(--app-accent)]"
          style={{ background: "var(--app-border)" }}
        />
      </button>
    </div>
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, base64 = ""] = result.split(",", 2);
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

export function KeyValueTableEditor(props: {
  rows: KeyValueEntry[];
  valuePlaceholder?: string;
  readOnly?: boolean;
  keySuggestions?: string[];
  getValueSuggestions?: (row: KeyValueEntry) => string[];
  resizeStorageKey?: string;
  onUpdate?: (id: string, key: "key" | "value", value: string) => void;
  onToggle?: (id: string) => void;
  onRemove?: (id: string) => void;
  onAdd?: () => void;
}) {
  const [suggestionField, setSuggestionField] = createSignal<{
    rowId: string;
    field: "key" | "value";
  } | null>(null);
  const [suggestionRect, setSuggestionRect] = createSignal<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const [columnSplit, setColumnSplit] = createSignal(50);
  const isReadOnly = () => props.readOnly ?? false;
  let containerRef: HTMLDivElement | undefined;

  const clampColumnSplit = (value: number) =>
    Math.min(72, Math.max(28, Math.round(value)));
  const resolvedStorageKey = () =>
    props.resizeStorageKey
      ? `${props.resizeStorageKey}:${isReadOnly() ? "readonly" : "editable"}`
      : null;

  function getSuggestions(row: KeyValueEntry, field: "key" | "value") {
    const source =
      field === "key"
        ? (props.keySuggestions ?? [])
        : (props.getValueSuggestions?.(row) ?? []);
    const currentValue = (field === "key" ? row.key : row.value)
      .trim()
      .toLowerCase();

    return source
      .filter((item, index, list) => list.indexOf(item) === index)
      .filter(
        (item) =>
          currentValue.length === 0 ||
          item.toLowerCase().includes(currentValue),
      )
      .slice(0, 8);
  }

  function openSuggestions(
    rowId: string,
    field: "key" | "value",
    element: HTMLInputElement,
  ) {
    const rect = element.getBoundingClientRect();
    setSuggestionField({ rowId, field });
    setSuggestionRect({
      left: rect.left,
      top: rect.bottom + 4,
      width: rect.width,
    });
  }

  function closeSuggestions(rowId: string, field: "key" | "value") {
    window.setTimeout(() => {
      const active = suggestionField();
      if (active?.rowId === rowId && active.field === field) {
        setSuggestionField(null);
        setSuggestionRect(null);
      }
    }, 120);
  }

  const activeSuggestionRow = createMemo(() => {
    const active = suggestionField();
    if (!active) {
      return null;
    }

    return props.rows.find((row) => row.id === active.rowId) ?? null;
  });

  onMount(() => {
    const storageKey = resolvedStorageKey();
    if (storageKey) {
      const saved = window.localStorage.getItem(storageKey);
      const parsed = Number(saved);
      if (!Number.isNaN(parsed)) {
        setColumnSplit(clampColumnSplit(parsed));
      }
    }

    const clearSuggestions = () => {
      setSuggestionField(null);
      setSuggestionRect(null);
    };

    window.addEventListener("resize", clearSuggestions);
    window.addEventListener("scroll", clearSuggestions, true);
    onCleanup(() => {
      window.removeEventListener("resize", clearSuggestions);
      window.removeEventListener("scroll", clearSuggestions, true);
    });
  });

  createEffect(() => {
    const storageKey = resolvedStorageKey();
    if (storageKey) {
      window.localStorage.setItem(storageKey, String(columnSplit()));
    }
  });

  function startColumnResize(event: MouseEvent) {
    const container = containerRef;
    if (!container) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = container.getBoundingClientRect();

    const handlePointerMove = (moveEvent: MouseEvent) => {
      const ratio = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setColumnSplit(clampColumnSplit(ratio));
    };

    const handlePointerUp = () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp, { once: true });
  }

  return (
    <div
      ref={containerRef}
      class="relative overflow-visible rounded-[18px] border"
      style={{ "border-color": "var(--app-border)" }}
    >
      <div
        class="theme-kv-grid overflow-hidden rounded-[18px] grid gap-px"
        style={{
          "grid-template-columns": isReadOnly()
            ? `minmax(180px, ${columnSplit()}fr) 1px minmax(0, ${100 - columnSplit()}fr)`
            : `68px minmax(120px, ${columnSplit()}fr) 1px minmax(140px, ${100 - columnSplit()}fr) 44px`,
        }}
      >
        <Show when={!isReadOnly()}>
          <div class="theme-kv-head px-2.5 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.16em]">
            State
          </div>
        </Show>
        <div class="theme-kv-head px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]">
          Key
        </div>
        <div class="theme-kv-head px-0 py-0">
          <ColumnResizeHandle onMouseDown={startColumnResize} />
        </div>
        <div class="theme-kv-head px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]">
          Value
        </div>
        <Show when={!isReadOnly()}>
          <div class="theme-kv-head px-2.5 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.16em]">
            Del
          </div>
        </Show>

        <Index each={props.rows}>
          {(row) => (
            <>
              <Show when={!isReadOnly()}>
                <div class="theme-kv-cell-muted flex items-center justify-center px-2 py-1.5 text-sm">
                  <button
                    class={`inline-flex min-w-[38px] items-center justify-center rounded-full px-2 py-0.75 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                      row().enabled
                        ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
                        : "theme-chip"
                    }`}
                    onClick={() => props.onToggle?.(row().id)}
                  >
                    {row().enabled ? "On" : "Off"}
                  </button>
                </div>
              </Show>

              <div class="theme-kv-cell px-2 py-2">
                <Show
                  when={!props.readOnly}
                  fallback={<div class="px-3 py-2 text-sm">{row().key}</div>}
                >
                  <div class="relative">
                    <input
                      class="theme-input h-8 w-full rounded-md px-2.5 py-1 text-sm"
                      placeholder="key"
                      value={row().key}
                      onFocus={(event) =>
                        openSuggestions(row().id, "key", event.currentTarget)
                      }
                      onClick={(event) =>
                        openSuggestions(row().id, "key", event.currentTarget)
                      }
                      onBlur={() => closeSuggestions(row().id, "key")}
                      onInput={(event) => {
                        openSuggestions(row().id, "key", event.currentTarget);
                        props.onUpdate?.(
                          row().id,
                          "key",
                          event.currentTarget.value,
                        );
                      }}
                    />
                  </div>
                </Show>
              </div>

              <div class="theme-kv-cell px-0 py-0">
                <ColumnResizeHandle onMouseDown={startColumnResize} />
              </div>

              <div class="theme-kv-cell-muted px-1.5 py-1.5">
                <Show
                  when={!props.readOnly}
                  fallback={
                    <div class="px-3 py-2 font-mono text-sm">{row().value}</div>
                  }
                >
                  <div class="relative">
                    <input
                      class="theme-input h-8 w-full rounded-md px-2.5 py-1 font-mono text-sm"
                      placeholder={props.valuePlaceholder ?? "value"}
                      value={row().value}
                      onFocus={(event) =>
                        openSuggestions(row().id, "value", event.currentTarget)
                      }
                      onClick={(event) =>
                        openSuggestions(row().id, "value", event.currentTarget)
                      }
                      onBlur={() => closeSuggestions(row().id, "value")}
                      onInput={(event) => {
                        openSuggestions(row().id, "value", event.currentTarget);
                        props.onUpdate?.(
                          row().id,
                          "value",
                          event.currentTarget.value,
                        );
                      }}
                    />
                  </div>
                </Show>
              </div>

              <Show when={!isReadOnly()}>
                <div class="theme-kv-cell-muted flex items-center justify-center px-1 py-1.5">
                  <button
                    class="inline-flex h-6 w-6 items-center justify-center"
                    onClick={() => props.onRemove?.(row().id)}
                  >
                    <ControlDot size="small" variant="delete" />
                  </button>
                </div>
              </Show>
            </>
          )}
        </Index>
      </div>

      <Show
        when={
          suggestionField() &&
          suggestionRect() &&
          activeSuggestionRow() &&
          getSuggestions(activeSuggestionRow()!, suggestionField()!.field)
            .length > 0
        }
      >
        <div
          class="theme-panel-soft fixed z-[18] overflow-hidden rounded-xl border p-1"
          style={{
            "border-color": "var(--app-border)",
            left: `${suggestionRect()!.left}px`,
            top: `${suggestionRect()!.top}px`,
            width: `${suggestionRect()!.width}px`,
          }}
        >
          <For
            each={getSuggestions(
              activeSuggestionRow()!,
              suggestionField()!.field,
            )}
          >
            {(item) => (
              <button
                class="theme-sidebar-item block w-full rounded-lg px-2.5 py-1.5 text-left text-sm"
                onMouseDown={(event) => {
                  event.preventDefault();
                  const active = suggestionField();
                  if (active) {
                    props.onUpdate?.(active.rowId, active.field, item);
                  }
                  setSuggestionField(null);
                  setSuggestionRect(null);
                }}
              >
                {item}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function FormDataTableEditor(props: {
  rows: KeyValueEntry[];
  resizeStorageKey?: string;
  onUpdate: (id: string, patch: Partial<KeyValueEntry>) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [columnSplit, setColumnSplit] = createSignal(48);
  let containerRef: HTMLDivElement | undefined;
  const clampColumnSplit = (value: number) =>
    Math.min(72, Math.max(28, Math.round(value)));

  onMount(() => {
    if (!props.resizeStorageKey) {
      return;
    }
    const saved = window.localStorage.getItem(props.resizeStorageKey);
    const parsed = Number(saved);
    if (!Number.isNaN(parsed)) {
      setColumnSplit(clampColumnSplit(parsed));
    }
  });

  createEffect(() => {
    if (props.resizeStorageKey) {
      window.localStorage.setItem(
        props.resizeStorageKey,
        String(columnSplit()),
      );
    }
  });

  function startColumnResize(event: MouseEvent) {
    const container = containerRef;
    if (!container) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = container.getBoundingClientRect();

    const handlePointerMove = (moveEvent: MouseEvent) => {
      const fixedWidth = 68 + 92 + 44 + 20;
      const flexibleWidth = rect.width - fixedWidth;
      const keyStart = rect.left + 68 + 92;
      const ratio = ((moveEvent.clientX - keyStart) / flexibleWidth) * 100;
      setColumnSplit(clampColumnSplit(ratio));
    };

    const handlePointerUp = () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp, { once: true });
  }

  return (
    <div
      ref={containerRef}
      class="w-full overflow-hidden rounded-[18px] border"
      style={{ "border-color": "var(--app-border)" }}
    >
      <div
        class="theme-kv-grid grid gap-px"
        style={{
          "grid-template-columns": `68px 92px minmax(120px, ${columnSplit()}fr) 1px minmax(160px, ${100 - columnSplit()}fr) 44px`,
        }}
      >
        <div class="theme-kv-head px-2.5 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.16em]">
          State
        </div>
        <div class="theme-kv-head px-2.5 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.16em]">
          Type
        </div>
        <div class="theme-kv-head px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]">
          Key
        </div>
        <div class="theme-kv-head px-0 py-0">
          <ColumnResizeHandle onMouseDown={startColumnResize} />
        </div>
        <div class="theme-kv-head px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]">
          Value
        </div>
        <div class="theme-kv-head px-2.5 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.16em]">
          Del
        </div>

        <Index each={props.rows}>
          {(row) => (
            <>
              <div class="theme-kv-cell-muted flex items-center justify-center px-2 py-1.5 text-sm">
                <button
                  class={`inline-flex min-w-[38px] items-center justify-center rounded-full px-2 py-0.75 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                    row().enabled
                      ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
                      : "theme-chip"
                  }`}
                  onClick={() => props.onToggle(row().id)}
                >
                  {row().enabled ? "On" : "Off"}
                </button>
              </div>

              <div class="theme-kv-cell-muted px-1.5 py-1.5">
                <select
                  class="theme-input h-8 w-full rounded-md px-2.5 py-1 text-sm"
                  value={row().valueType ?? "text"}
                  onInput={(event) => {
                    const nextType = event.currentTarget.value as
                      | "text"
                      | "file";
                    props.onUpdate(
                      row().id,
                      nextType === "file"
                        ? {
                            valueType: "file",
                            value: "",
                            fileName: "",
                            fileContent: "",
                            fileContentType: "",
                          }
                        : {
                            valueType: "text",
                            fileName: "",
                            fileContent: "",
                            fileContentType: "",
                          },
                    );
                  }}
                >
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </select>
              </div>

              <div class="theme-kv-cell px-2 py-2">
                <input
                  class="theme-input h-8 w-full rounded-md px-2.5 py-1 text-sm"
                  placeholder="key"
                  value={row().key}
                  onInput={(event) =>
                    props.onUpdate(row().id, { key: event.currentTarget.value })
                  }
                />
              </div>

              <div class="theme-kv-cell px-0 py-0">
                <ColumnResizeHandle onMouseDown={startColumnResize} />
              </div>

              <div class="theme-kv-cell-muted px-1.5 py-1.5">
                <Show
                  when={(row().valueType ?? "text") === "file"}
                  fallback={
                    <input
                      class="theme-input h-8 w-full rounded-md px-2.5 py-1 font-mono text-sm"
                      placeholder="value"
                      value={row().value}
                      onInput={(event) =>
                        props.onUpdate(row().id, {
                          value: event.currentTarget.value,
                        })
                      }
                    />
                  }
                >
                  <div class="flex min-w-0 items-center">
                    <label
                      class={`inline-flex h-8 min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-md px-3 text-sm transition ${
                        row().fileName
                          ? "bg-[var(--app-method-get-bg)] text-[var(--app-method-get)]"
                          : "theme-control"
                      }`}
                    >
                      <span class="truncate">{row().fileName || "Choose"}</span>
                      <Show when={row().fileName}>
                        <button
                          class="inline-flex h-5 w-5 items-center justify-center"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            props.onUpdate(row().id, {
                              fileName: "",
                              fileContent: "",
                              fileContentType: "",
                              value: "",
                            });
                          }}
                        >
                          <ControlDot size="small" variant="delete" />
                        </button>
                      </Show>
                      <input
                        class="hidden"
                        type="file"
                        onChange={async (event) => {
                          const file = event.currentTarget.files?.[0];
                          if (!file) {
                            return;
                          }

                          const fileContent = await readFileAsBase64(file);
                          props.onUpdate(row().id, {
                            fileName: file.name,
                            fileContent,
                            fileContentType: file.type,
                            value: file.name,
                          });
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                </Show>
              </div>

              <div class="theme-kv-cell-muted flex items-center justify-center px-1 py-1.5">
                <button
                  class="inline-flex h-6 w-6 items-center justify-center"
                  onClick={() => props.onRemove(row().id)}
                >
                  <ControlDot size="small" variant="delete" />
                </button>
              </div>
            </>
          )}
        </Index>
      </div>
    </div>
  );
}
