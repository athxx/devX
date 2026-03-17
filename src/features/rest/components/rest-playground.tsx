import type { JSX } from "solid-js";
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount
} from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { WorkspaceSidebarLayout } from "../../../components/workspace-sidebar-layout";
import type {
  Collection,
  CollectionFolder,
  Environment,
  KeyValueEntry,
  RequestBody,
  RequestDraft,
  RequestKind,
  RequestMethod,
  ResponseSummary,
  RestWorkspaceState
} from "../models";
import {
  createDefaultRestWorkspace,
  createHistoryEntry,
  createKeyValueEntry,
  createRequestDraft,
  executeRestRequest,
  loadRestWorkspace,
  normalizeRestWorkspace,
  resolveTemplate,
  saveRestWorkspace
} from "../service";

type SidebarPanelId = "collections" | "environments" | "history";
type EditorTabId = "params" | "headers" | "body" | "auth";
type ResponseTabId = "body" | "headers" | "timeline";
type SaveState = "idle" | "saving" | "saved" | "error";

type RestPlaygroundProps = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarResizing: boolean;
  onSidebarResizeStart: (event: MouseEvent) => void;
};

type RequestTabMenuState = {
  id: string;
  x: number;
  y: number;
};

const editorTabs: Array<{ id: EditorTabId; label: string }> = [
  { id: "params", label: "Params" },
  { id: "headers", label: "Headers" },
  { id: "body", label: "Body" },
  { id: "auth", label: "Auth" }
];

const responseTabs: Array<{ id: ResponseTabId; label: string }> = [
  { id: "body", label: "Body" },
  { id: "headers", label: "Headers" },
  { id: "timeline", label: "Timeline" }
];

const sidebarTabs: Array<{ id: SidebarPanelId; label: string }> = [
  { id: "collections", label: "Collections" },
  { id: "environments", label: "Environments" },
  { id: "history", label: "History" }
];

const requestCreateOptions: Array<{ id: RequestKind; label: string }> = [
  { id: "http", label: "HTTP Request" },
  { id: "curl", label: "cURL" },
  { id: "websocket", label: "WebSocket" },
  { id: "graphql", label: "GraphQL" },
  { id: "socketio", label: "Socket.IO" }
];

const requestMethods: RequestMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT"
];

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function arrayMove<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return items.slice();
  }

  const next = items.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, item);
  return next;
}

function reorderByDirection(ids: string[], id: string, direction: "top" | "up" | "down") {
  const index = ids.indexOf(id);

  if (index < 0) {
    return ids.slice();
  }

  if (direction === "top") {
    return arrayMove(ids, index, 0);
  }

  if (direction === "up" && index > 0) {
    return arrayMove(ids, index, index - 1);
  }

  if (direction === "down" && index < ids.length - 1) {
    return arrayMove(ids, index, index + 1);
  }

  return ids.slice();
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function getMethodClass(method: RequestMethod) {
  switch (method) {
    case "GET":
      return "theme-method-get";
    case "POST":
      return "theme-method-post";
    case "PUT":
      return "theme-method-put";
    case "PATCH":
      return "theme-method-patch";
    case "DELETE":
      return "theme-method-delete";
    case "HEAD":
      return "theme-method-head";
    case "OPTIONS":
      return "theme-method-options";
    case "TRACE":
      return "theme-method-trace";
    case "CONNECT":
      return "theme-method-connect";
    default:
      return "theme-method-default";
  }
}

function getRequestKindLabel(request: RequestDraft) {
  switch (request.kind) {
    case "curl":
      return "cURL";
    case "websocket":
      return "WS";
    case "graphql":
      return "GQL";
    case "socketio":
      return "SIO";
    case "http":
    default:
      return request.method;
  }
}

function getRequestBadgeClass(request: RequestDraft) {
  if (request.kind !== "http") {
    return "theme-method-badge theme-method-default";
  }

  return `theme-method-badge ${getMethodClass(request.method)}`;
}

function createRequestForKind(
  collectionId: string,
  kind: RequestKind,
  folderId: string | null = null
) {
  switch (kind) {
    case "graphql":
      return createRequestDraft(collectionId, {
        folderId,
        kind: "graphql",
        method: "POST",
        name: "GraphQL Query",
        url: "{{baseUrl}}/graphql",
        headers: [
          createKeyValueEntry({ key: "Accept", value: "application/json" }),
          createKeyValueEntry({ key: "Content-Type", value: "application/json" })
        ],
        body: {
          type: "json",
          value: JSON.stringify(
            {
              query: "query Example {\n  __typename\n}"
            },
            null,
            2
          )
        }
      });
    case "websocket":
      return createRequestDraft(collectionId, {
        folderId,
        kind: "websocket",
        name: "WebSocket Request",
        url: "wss://example.com/socket",
        headers: [],
        body: { type: "none" }
      });
    case "socketio":
      return createRequestDraft(collectionId, {
        folderId,
        kind: "socketio",
        name: "Socket.IO Request",
        url: "https://example.com/socket.io/?EIO=4&transport=websocket",
        headers: [],
        body: { type: "none" }
      });
    case "curl":
      return createRequestDraft(collectionId, {
        folderId,
        kind: "curl",
        name: "Imported cURL",
        url: "{{baseUrl}}/users"
      });
    case "http":
    default:
      return createRequestDraft(collectionId, {
        folderId,
        name: "New Request",
        url: "{{baseUrl}}/posts"
      });
  }
}

function decodeShellToken(token: string) {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1).replace(/\\(["'])/g, "$1");
  }

  return token.replace(/\\ /g, " ");
}

function splitShellArgs(input: string) {
  const tokens: string[] = [];
  let buffer = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of input.trim()) {
    if (escaping) {
      buffer += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        buffer += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (buffer) {
        tokens.push(buffer);
        buffer = "";
      }
      continue;
    }

    buffer += char;
  }

  if (buffer) {
    tokens.push(buffer);
  }

  return tokens.map(decodeShellToken);
}

function buildCurlCommand(request: RequestDraft, environment?: Environment) {
  const url = new URL(resolveTemplate(request.url, environment));

  request.query
    .filter((entry) => entry.enabled && entry.key.trim())
    .forEach((entry) => {
      url.searchParams.append(
        resolveTemplate(entry.key, environment),
        resolveTemplate(entry.value, environment)
      );
    });

  const parts = ["curl", "-X", request.method, `'${url.toString()}'`];

  request.headers
    .filter((entry) => entry.enabled && entry.key.trim())
    .forEach((entry) => {
      parts.push(
        "-H",
        `'${resolveTemplate(entry.key, environment)}: ${resolveTemplate(entry.value, environment)}'`
      );
    });

  switch (request.auth.type) {
    case "bearer":
      parts.push(
        "-H",
        `'Authorization: Bearer ${resolveTemplate(request.auth.token, environment)}'`
      );
      break;
    case "basic":
      parts.push(
        "-u",
        `'${resolveTemplate(request.auth.username, environment)}:${resolveTemplate(request.auth.password, environment)}'`
      );
      break;
    case "api-key":
      if (request.auth.addTo === "header" && request.auth.key.trim()) {
        parts.push(
          "-H",
          `'${resolveTemplate(request.auth.key, environment)}: ${resolveTemplate(
            request.auth.value,
            environment
          )}'`
        );
      }
      break;
    default:
      break;
  }

  switch (request.body.type) {
    case "json":
      parts.push("-H", "'Content-Type: application/json'");
      parts.push("--data-raw", `'${resolveTemplate(request.body.value, environment)}'`);
      break;
    case "raw":
      parts.push(
        "-H",
        `'Content-Type: ${resolveTemplate(request.body.contentType, environment) || "text/plain"}'`
      );
      parts.push("--data-raw", `'${resolveTemplate(request.body.value, environment)}'`);
      break;
    case "form-urlencoded":
      request.body.entries
        .filter((entry) => entry.enabled && entry.key.trim())
        .forEach((entry) => {
          parts.push(
            "--data-urlencode",
            `'${resolveTemplate(entry.key, environment)}=${resolveTemplate(entry.value, environment)}'`
          );
        });
      break;
    default:
      break;
  }

  return parts.join(" ");
}

function parseCurlCommand(
  collectionId: string,
  input: string,
  folderId: string | null = null
) {
  const tokens = splitShellArgs(input);

  if (tokens.length === 0 || tokens[0] !== "curl") {
    throw new Error("Please paste a valid cURL command.");
  }

  let method: RequestMethod = "GET";
  let url = "";
  let rawBody = "";
  let contentType = "";
  let basicUsername = "";
  let basicPassword = "";
  const queryEntries: KeyValueEntry[] = [];
  const headers: KeyValueEntry[] = [];
  const urlEncodedEntries: KeyValueEntry[] = [];

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    switch (token) {
      case "-X":
      case "--request": {
        const next = tokens[index + 1]?.toUpperCase() as RequestMethod | undefined;
        if (next && requestMethods.includes(next)) {
          method = next;
          index += 1;
        }
        break;
      }
      case "-H":
      case "--header": {
        const value = tokens[index + 1];
        if (value) {
          const separatorIndex = value.indexOf(":");
          if (separatorIndex >= 0) {
            headers.push(
              createKeyValueEntry({
                key: value.slice(0, separatorIndex).trim(),
                value: value.slice(separatorIndex + 1).trim()
              })
            );
          }
          index += 1;
        }
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii":
        rawBody = tokens[index + 1] ?? "";
        if (method === "GET") {
          method = "POST";
        }
        index += 1;
        break;
      case "--data-urlencode": {
        const value = tokens[index + 1] ?? "";
        const separatorIndex = value.indexOf("=");
        if (separatorIndex >= 0) {
          urlEncodedEntries.push(
            createKeyValueEntry({
              key: value.slice(0, separatorIndex),
              value: value.slice(separatorIndex + 1)
            })
          );
        }
        if (method === "GET") {
          method = "POST";
        }
        index += 1;
        break;
      }
      case "-u":
      case "--user": {
        const value = tokens[index + 1] ?? "";
        const separatorIndex = value.indexOf(":");
        basicUsername = separatorIndex >= 0 ? value.slice(0, separatorIndex) : value;
        basicPassword = separatorIndex >= 0 ? value.slice(separatorIndex + 1) : "";
        index += 1;
        break;
      }
      case "-I":
      case "--head":
        method = "HEAD";
        break;
      default:
        if (!token.startsWith("-") && !url) {
          url = token;
        }
        break;
    }
  }

  if (!url) {
    throw new Error("The cURL command does not contain a URL.");
  }

  try {
    const parsed = new URL(url);
    parsed.searchParams.forEach((value, key) => {
      queryEntries.push(createKeyValueEntry({ key, value }));
    });
    url = parsed.origin + parsed.pathname;
  } catch {
    // Ignore partial URLs.
  }

  const contentTypeHeader = headers.find((header) => header.key.toLowerCase() === "content-type");
  contentType = contentTypeHeader?.value ?? "";

  let body: RequestBody = { type: "none" };
  if (urlEncodedEntries.length > 0) {
    body = {
      type: "form-urlencoded",
      entries: urlEncodedEntries
    };
  } else if (rawBody) {
    body = contentType.includes("application/json")
      ? {
          type: "json",
          value: rawBody
        }
      : {
          type: "raw",
          value: rawBody,
          contentType: contentType || "text/plain"
        };
  }

  return createRequestDraft(collectionId, {
    folderId,
    kind: "curl",
    method,
    name: "Imported cURL",
    url,
    query: queryEntries,
    headers,
    body,
    auth:
      basicUsername || basicPassword
        ? { type: "basic", username: basicUsername, password: basicPassword }
        : { type: "none" }
  });
}

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function downloadJsonFile(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function tryFormatJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function cloneRestValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getResponseStatusClass(status: number) {
  if (status >= 200 && status < 300) {
    return "text-[#34c759]";
  }
  if (status >= 300 && status < 400) {
    return "text-[#ff9f0a]";
  }
  return "text-[#ff3b30]";
}

function MacCloseIcon() {
  return (
    <svg
      aria-hidden="true"
      class="h-4.5 w-4.5"
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M9.55 18.55a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" fill="#FF5F57" />
      <path
        d="M9.55 18.1a8.55 8.55 0 1 0 0-17.1 8.55 8.55 0 0 0 0 17.1z"
        stroke="#000"
        stroke-opacity=".2"
        stroke-width="2"
      />
      <path
        d="M13.369 12.733l-7-7a.45.45 0 1 0-.637.636l7 7a.45.45 0 1 0 .637-.636z"
        fill="#000"
        fill-opacity=".5"
      />
      <path
        d="M12.733 5.732l-7 7a.45.45 0 1 0 .636.636l7-7a.45.45 0 1 0-.636-.636z"
        fill="#000"
        fill-opacity=".5"
      />
    </svg>
  );
}

function MacAddIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g clip-path="url(#clip0_mac_add)">
        <path d="M20 40c11.046 0 20-8.954 20-20S31.046 0 20 0 0 8.954 0 20s8.954 20 20 20z" fill="#28C840"/>
        <path d="M20 39c10.493 0 19-8.507 19-19S30.493 1 20 1 1 9.507 1 20s8.507 19 19 19z" stroke="#000" stroke-opacity=".2" stroke-width="2"/>
        <path d="M20 8a1 1 0 0 1 1 1v10h10a1 1 0 1 1 0 2H21v10a1 1 0 1 1-2 0V21H9a1 1 0 1 1 0-2h10V9a1 1 0 0 1 1-1z" fill="#000" fill-opacity=".5"/>
      </g>
      <defs>
        <clipPath id="clip0_mac_add">
          <rect width="40" height="40" fill="white"/>
        </clipPath>
      </defs>
    </svg>
  );
}

function PinIcon() {
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

function EditorToggle(props: {
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

function LinearSection(props: {
  eyebrow?: string;
  title?: string;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <section
      class={`border-t px-3 py-2 ${props.class ?? ""}`}
      style={{ "border-color": "var(--app-border)" }}
    >
      <Show when={props.eyebrow || props.title}>
        <div class="mb-3 space-y-0.5">
          <Show when={props.eyebrow}>
            <p class="theme-eyebrow text-[10px] font-semibold uppercase tracking-[0.18em]">
              {props.eyebrow}
            </p>
          </Show>
          <Show when={props.title}>
            <h2 class="theme-text text-sm font-semibold">{props.title}</h2>
          </Show>
        </div>
      </Show>
      {props.children}
    </section>
  );
}

function KeyValueTableEditor(props: {
  rows: KeyValueEntry[];
  valuePlaceholder?: string;
  readOnly?: boolean;
  onUpdate?: (id: string, key: "key" | "value", value: string) => void;
  onToggle?: (id: string) => void;
  onRemove?: (id: string) => void;
  onAdd?: () => void;
}) {
  return (
    <div class="overflow-hidden border" style={{ "border-color": "var(--app-border)" }}>
      <div class="theme-kv-grid grid grid-cols-[68px_1fr_1fr_44px] gap-px">
        <div class="theme-kv-head px-2.5 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.16em]">State</div>
        <div class="theme-kv-head px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]">Key</div>
        <div class="theme-kv-head px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]">Value</div>
        <div class="theme-kv-head px-2.5 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.16em]">Del</div>

        <For each={props.rows}>
          {(row) => (
            <>
              <div class="theme-kv-cell-muted flex items-center justify-center px-2 py-1.5 text-sm">
                <Show
                  when={!props.readOnly}
                  fallback={
                    <span
                      class={`inline-flex items-center justify-center rounded-full px-2 py-0.75 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                        row.enabled
                          ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
                          : "theme-chip"
                      }`}
                    >
                      {row.enabled ? "On" : "Off"}
                    </span>
                  }
                >
                  <button
                    class={`inline-flex min-w-[38px] items-center justify-center rounded-full px-2 py-0.75 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                      row.enabled
                        ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
                        : "theme-chip"
                    }`}
                    onClick={() => props.onToggle?.(row.id)}
                  >
                    {row.enabled ? "On" : "Off"}
                  </button>
                </Show>
              </div>

              <div class="theme-kv-cell px-2 py-2">
                <Show
                  when={!props.readOnly}
                  fallback={<div class="px-3 py-2 text-sm">{row.key}</div>}
                >
                  <input
                    class="theme-input h-8 w-full rounded-md px-2.5 py-1 text-sm"
                    placeholder="key"
                    value={row.key}
                    onInput={(event) => props.onUpdate?.(row.id, "key", event.currentTarget.value)}
                  />
                </Show>
              </div>

              <div class="theme-kv-cell-muted px-1.5 py-1.5">
                <Show
                  when={!props.readOnly}
                  fallback={<div class="px-3 py-2 font-mono text-sm">{row.value}</div>}
                >
                  <input
                    class="theme-input h-8 w-full rounded-md px-2.5 py-1 font-mono text-sm"
                    placeholder={props.valuePlaceholder ?? "value"}
                    value={row.value}
                    onInput={(event) => props.onUpdate?.(row.id, "value", event.currentTarget.value)}
                  />
                </Show>
              </div>

              <div class="theme-kv-cell-muted flex items-center justify-center px-1 py-1.5">
                <Show when={!props.readOnly}>
                  <button
                    class="inline-flex h-6 w-6 items-center justify-center"
                    onClick={() => props.onRemove?.(row.id)}
                  >
                    <MacCloseIcon />
                  </button>
                </Show>
              </div>
            </>
          )}
        </For>
      </div>

    </div>
  );
}

export function RestPlayground(props: RestPlaygroundProps) {
  const [workspace, setWorkspace] = createStore<RestWorkspaceState>(createDefaultRestWorkspace());
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [sidebarPanel, setSidebarPanel] = createSignal<SidebarPanelId>("collections");
  const [editorTab, setEditorTab] = createSignal<EditorTabId>("params");
  const [topEditorTab, setTopEditorTab] = createSignal<"headers" | "auth">("headers");
  const [bottomEditorTab, setBottomEditorTab] = createSignal<"body" | "params">("body");
  const [responseTab, setResponseTab] = createSignal<ResponseTabId>("body");
  const [mainPaneSplit, setMainPaneSplit] = createSignal(40);
  const [mainPaneResizing, setMainPaneResizing] = createSignal(false);
  const [expandedCollectionIds, setExpandedCollectionIds] = createSignal<string[]>([]);
  const [collectionFilter, setCollectionFilter] = createSignal("");
  const [responseSummary, setResponseSummary] = createSignal<ResponseSummary | null>(null);
  const [responseError, setResponseError] = createSignal<string | null>(null);
  const [isSending, setIsSending] = createSignal(false);
  const [saveState, setSaveState] = createSignal<SaveState>("idle");

  const [showCollectionCreateMenu, setShowCollectionCreateMenu] = createSignal(false);
  const [collectionMenuId, setCollectionMenuId] = createSignal<string | null>(null);
  const [collectionOrderMenuId, setCollectionOrderMenuId] = createSignal<string | null>(null);
  const [collectionAddMenuId, setCollectionAddMenuId] = createSignal<string | null>(null);

  const [folderMenuId, setFolderMenuId] = createSignal<string | null>(null);
  const [folderOrderMenuId, setFolderOrderMenuId] = createSignal<string | null>(null);
  const [folderMoveMenuId, setFolderMoveMenuId] = createSignal<string | null>(null);
  const [folderAddMenuId, setFolderAddMenuId] = createSignal<string | null>(null);

  const [requestMenuId, setRequestMenuId] = createSignal<string | null>(null);
  const [requestOrderMenuId, setRequestOrderMenuId] = createSignal<string | null>(null);
  const [requestMoveMenuId, setRequestMoveMenuId] = createSignal<string | null>(null);

  const [requestTabMenuState, setRequestTabMenuState] = createSignal<RequestTabMenuState | null>(null);
  const [draggedTabId, setDraggedTabId] = createSignal<string | null>(null);
  const [tabDropTargetId, setTabDropTargetId] = createSignal<string | null>(null);

  const [curlImportCollectionId, setCurlImportCollectionId] = createSignal<string | null>(null);
  const [curlImportFolderId, setCurlImportFolderId] = createSignal<string | null>(null);
  const [curlInput, setCurlInput] = createSignal("");
  const [curlError, setCurlError] = createSignal<string | null>(null);

  let importCollectionInputRef: HTMLInputElement | undefined;
  let persistTimer: number | undefined;
  let saveFeedbackTimer: number | undefined;

  const mainPaneSplitStorageKey = "devox-api-main-pane-split";

  const requestMap = createMemo(() => new Map(workspace.requests.map((request) => [request.id, request])));
  const activeRequest = createMemo(
    () => requestMap().get(workspace.activeRequestId) ?? workspace.requests[0] ?? null
  );
  const activeCollection = createMemo(
    () =>
      workspace.collections.find((collection) => collection.id === workspace.activeCollectionId) ??
      workspace.collections[0] ??
      null
  );
  const activeEnvironment = createMemo(
    () =>
      workspace.environments.find((environment) => environment.id === workspace.activeEnvironmentId) ??
      workspace.environments[0] ??
      null
  );

  const orderedOpenRequestIds = createMemo(() => {
    const validRequestIds = new Set(workspace.requests.map((request) => request.id));
    const openRequestIds = workspace.openRequestIds.filter((id) => validRequestIds.has(id));
    const pinnedRequestIds = new Set(
      workspace.pinnedRequestIds.filter((id) => validRequestIds.has(id))
    );

    return [
      ...openRequestIds.filter((id) => pinnedRequestIds.has(id)),
      ...openRequestIds.filter((id) => !pinnedRequestIds.has(id))
    ];
  });

  const filteredCollections = createMemo(() => {
    const filter = collectionFilter().trim().toLowerCase();

    return workspace.collections
      .map((collection) => {
        const folders = collection.folders.map((folder) => ({
          folder,
          requests: folder.requestIds
            .map((requestId) => requestMap().get(requestId))
            .filter((request): request is RequestDraft => Boolean(request))
        }));
        const folderIds = new Set(collection.folders.map((folder) => folder.id));
        const rootRequests = collection.requestIds
          .map((requestId) => requestMap().get(requestId))
          .filter(
            (request): request is RequestDraft =>
              Boolean(request) && (!request.folderId || !folderIds.has(request.folderId))
          );

        if (!filter) {
          return { collection, folders, rootRequests };
        }

        const collectionMatches = collection.name.toLowerCase().includes(filter);
        if (collectionMatches) {
          return { collection, folders, rootRequests };
        }

        const matchingFolders = folders
          .map((entry) => {
            const folderMatches = entry.folder.name.toLowerCase().includes(filter);
            const requests = folderMatches
              ? entry.requests
              : entry.requests.filter((request) => request.name.toLowerCase().includes(filter));

            if (!folderMatches && requests.length === 0) {
              return null;
            }

            return {
              folder: entry.folder,
              requests
            };
          })
          .filter(
            (
              entry
            ): entry is {
              folder: CollectionFolder;
              requests: RequestDraft[];
            } => Boolean(entry)
          );

        const matchingRootRequests = rootRequests.filter((request) =>
          request.name.toLowerCase().includes(filter)
        );

        if (matchingFolders.length === 0 && matchingRootRequests.length === 0) {
          return null;
        }

        return {
          collection,
          folders: matchingFolders,
          rootRequests: matchingRootRequests
        };
      })
      .filter(
        (
          entry
        ): entry is {
          collection: Collection;
          folders: Array<{ folder: CollectionFolder; requests: RequestDraft[] }>;
          rootRequests: RequestDraft[];
        } => Boolean(entry)
      );
  });

  const currentTabMenuRequest = createMemo(() =>
    requestTabMenuState() ? requestMap().get(requestTabMenuState()!.id) ?? null : null
  );

  const canSendActiveRequest = createMemo(() => {
    const request = activeRequest();
    return Boolean(request && request.kind !== "websocket" && request.kind !== "socketio");
  });

  const activeRequestResolvedUrl = createMemo(() => {
    const request = activeRequest();
    if (!request) {
      return "";
    }

    return resolveTemplate(request.url, activeEnvironment() ?? undefined);
  });

  function closeAllMenus() {
    setShowCollectionCreateMenu(false);
    setCollectionMenuId(null);
    setCollectionOrderMenuId(null);
    setCollectionAddMenuId(null);
    setFolderMenuId(null);
    setFolderOrderMenuId(null);
    setFolderMoveMenuId(null);
    setFolderAddMenuId(null);
    setRequestMenuId(null);
    setRequestOrderMenuId(null);
    setRequestMoveMenuId(null);
    setRequestTabMenuState(null);
  }

  function clampMainPaneSplit(value: number) {
    return Math.min(72, Math.max(28, Math.round(value)));
  }

  function snapshotWorkspace() {
    return normalizeRestWorkspace(cloneRestValue(unwrap(workspace)));
  }

  function schedulePersist() {
    if (!isLoaded()) {
      return;
    }

    if (persistTimer) {
      window.clearTimeout(persistTimer);
    }

    persistTimer = window.setTimeout(async () => {
      try {
        await saveRestWorkspace(snapshotWorkspace());
      } catch {
        // Ignore autosave failures.
      }
    }, 180);
  }

  function setSaveFeedback(state: SaveState) {
    setSaveState(state);

    if (saveFeedbackTimer) {
      window.clearTimeout(saveFeedbackTimer);
    }

    if (state === "saved" || state === "error") {
      saveFeedbackTimer = window.setTimeout(() => setSaveState("idle"), 1800);
    }
  }

  function commitWorkspace(mutator: (next: RestWorkspaceState) => void, options?: { persist?: boolean }) {
    const next = snapshotWorkspace();
    mutator(next);
    const normalized = normalizeRestWorkspace(next);
    setWorkspace(normalized);
    if (options?.persist !== false) {
      schedulePersist();
    }
    return normalized;
  }

  function ensureCollectionExpanded(collectionId: string) {
    setExpandedCollectionIds((current) =>
      current.includes(collectionId) ? current : [...current, collectionId]
    );
  }

  function toggleCollectionExpanded(collectionId: string) {
    setExpandedCollectionIds((current) =>
      current.includes(collectionId)
        ? current.filter((id) => id !== collectionId)
        : [...current, collectionId]
    );
  }

  function openRequestTab(requestId: string, collectionId?: string) {
    const request = requestMap().get(requestId);
    if (!request) {
      return;
    }

    commitWorkspace((next) => {
      if (!next.openRequestIds.includes(requestId)) {
        next.openRequestIds.push(requestId);
      }
      next.activeRequestId = requestId;
      next.activeCollectionId = collectionId ?? request.collectionId;
    });

    ensureCollectionExpanded(collectionId ?? request.collectionId);
    setResponseSummary(null);
    setResponseError(null);
  }

  function selectCollection(collectionId: string) {
    commitWorkspace((next) => {
      next.activeCollectionId = collectionId;
      const collection = next.collections.find((item) => item.id === collectionId);
      if (!collection) {
        return;
      }
      const nextRequestId = collection.requestIds[0];
      if (nextRequestId) {
        next.activeRequestId = nextRequestId;
        if (!next.openRequestIds.includes(nextRequestId)) {
          next.openRequestIds.push(nextRequestId);
        }
      }
    });

    ensureCollectionExpanded(collectionId);
  }

  function updateActiveRequest(mutator: (request: RequestDraft) => void) {
    const request = activeRequest();
    if (!request) {
      return;
    }

    commitWorkspace((next) => {
      const target = next.requests.find((item) => item.id === request.id);
      if (target) {
        mutator(target);
      }
    });
  }

  function addRequestToWorkspace(collectionId: string, request: RequestDraft, folderId: string | null) {
    commitWorkspace((next) => {
      const collection = next.collections.find((item) => item.id === collectionId);
      if (!collection) {
        return;
      }

      next.requests.push(request);
      collection.requestIds.push(request.id);
      if (folderId) {
        const folder = collection.folders.find((item) => item.id === folderId);
        folder?.requestIds.push(request.id);
      }

      next.activeCollectionId = collectionId;
      next.activeRequestId = request.id;
      if (!next.openRequestIds.includes(request.id)) {
        next.openRequestIds.push(request.id);
      }
    });

    ensureCollectionExpanded(collectionId);
    setResponseSummary(null);
    setResponseError(null);
  }

  function closeRequestTab(requestId: string) {
    if (workspace.pinnedRequestIds.includes(requestId)) {
      return;
    }

    const currentOpenIds = orderedOpenRequestIds();
    const currentIndex = currentOpenIds.indexOf(requestId);

    commitWorkspace((next) => {
      next.openRequestIds = next.openRequestIds.filter((id) => id !== requestId);
      next.pinnedRequestIds = next.pinnedRequestIds.filter((id) => id !== requestId);

      if (next.activeRequestId === requestId) {
        const fallbackId =
          currentOpenIds[currentIndex + 1] ??
          currentOpenIds[currentIndex - 1] ??
          next.requests[0]?.id ??
          "";
        next.activeRequestId = fallbackId;
        const fallbackRequest = next.requests.find((request) => request.id === fallbackId);
        if (fallbackRequest) {
          next.activeCollectionId = fallbackRequest.collectionId;
        }
      }
    });

    setRequestTabMenuState(null);
    setResponseSummary(null);
    setResponseError(null);
  }

  function togglePinnedRequestTab(requestId: string) {
    commitWorkspace((next) => {
      if (next.pinnedRequestIds.includes(requestId)) {
        next.pinnedRequestIds = next.pinnedRequestIds.filter((id) => id !== requestId);
      } else {
        next.pinnedRequestIds = [requestId, ...next.pinnedRequestIds.filter((id) => id !== requestId)];
        if (!next.openRequestIds.includes(requestId)) {
          next.openRequestIds.push(requestId);
        }
      }
    });
  }

  function closeOtherTabs(requestId: string) {
    commitWorkspace((next) => {
      const pinned = new Set(next.pinnedRequestIds);
      next.openRequestIds = next.openRequestIds.filter((id) => id === requestId || pinned.has(id));
      next.activeRequestId = requestId;
    });
    setRequestTabMenuState(null);
  }

  function closeAllTabs() {
    const currentId = currentTabMenuRequest()?.id ?? activeRequest()?.id ?? "";

    commitWorkspace((next) => {
      const pinned = next.pinnedRequestIds.filter((id) =>
        next.requests.some((request) => request.id === id)
      );
      next.openRequestIds = pinned.length > 0 ? pinned : currentId ? [currentId] : [];
      if (next.openRequestIds.length > 0) {
        next.activeRequestId = next.openRequestIds[0];
        const active = next.requests.find((request) => request.id === next.activeRequestId);
        if (active) {
          next.activeCollectionId = active.collectionId;
        }
      }
    });

    setRequestTabMenuState(null);
  }

  function closeTabsToDirection(requestId: string, direction: "left" | "right") {
    const orderedIds = orderedOpenRequestIds();
    const currentIndex = orderedIds.indexOf(requestId);
    if (currentIndex < 0) {
      return;
    }

    commitWorkspace((next) => {
      const pinned = new Set(next.pinnedRequestIds);
      next.openRequestIds = next.openRequestIds.filter((id) => {
        if (pinned.has(id) || id === requestId) {
          return true;
        }
        const index = orderedIds.indexOf(id);
        return direction === "left" ? index > currentIndex : index < currentIndex;
      });
      next.activeRequestId = requestId;
    });

    setRequestTabMenuState(null);
  }

  function reorderRequestTabs(draggedId: string, targetId: string | null) {
    if (!draggedId || workspace.pinnedRequestIds.includes(draggedId)) {
      return;
    }

    const pinnedSet = new Set(workspace.pinnedRequestIds);
    const orderedIds = orderedOpenRequestIds();
    const nextIds = orderedIds.slice();
    const fromIndex = nextIds.indexOf(draggedId);

    if (fromIndex < 0) {
      return;
    }

    nextIds.splice(fromIndex, 1);

    if (!targetId) {
      nextIds.push(draggedId);
    } else {
      const targetIndex = nextIds.indexOf(targetId);
      const boundedIndex =
        targetIndex < 0
          ? nextIds.length
          : pinnedSet.has(targetId)
            ? nextIds.filter((id) => pinnedSet.has(id)).length
            : targetIndex;
      nextIds.splice(boundedIndex, 0, draggedId);
    }

    const pinnedIds = nextIds.filter((id) => pinnedSet.has(id));
    const unpinnedIds = nextIds.filter((id) => !pinnedSet.has(id));

    commitWorkspace((next) => {
      next.openRequestIds = [...pinnedIds, ...unpinnedIds];
    });
  }

  function createCollection() {
    const name = window.prompt("Collection name", "New Collection")?.trim();
    if (!name) {
      return;
    }

    const collectionId = makeId("collection");
    const request = createRequestDraft(collectionId, {
      name: "New Request",
      url: "{{baseUrl}}/posts"
    });

    commitWorkspace((next) => {
      next.collections.push({
        id: collectionId,
        name,
        folders: [],
        requestIds: [request.id]
      });
      next.requests.push(request);
      next.activeCollectionId = collectionId;
      next.activeRequestId = request.id;
      next.openRequestIds.push(request.id);
    });

    ensureCollectionExpanded(collectionId);
    closeAllMenus();
  }

  function createEnvironment() {
    const name = window.prompt("Environment name", "New Environment")?.trim();
    if (!name) {
      return;
    }

    commitWorkspace((next) => {
      const environmentId = makeId("env");
      next.environments.push({
        id: environmentId,
        name,
        variables: [
          createKeyValueEntry({
            key: "baseUrl",
            value: "https://jsonplaceholder.typicode.com"
          })
        ]
      });
      next.activeEnvironmentId = environmentId;
    });
  }

  function duplicateEnvironment(environmentId: string) {
    const environment = workspace.environments.find((item) => item.id === environmentId);
    if (!environment) {
      return;
    }

    commitWorkspace((next) => {
      const duplicateId = makeId("env");
      const duplicate = {
        ...cloneRestValue(environment),
        id: duplicateId,
        name: `${environment.name} Copy`,
        variables: environment.variables.map((entry) =>
          createKeyValueEntry({
            key: entry.key,
            value: entry.value,
            enabled: entry.enabled
          })
        )
      };
      next.environments.push(duplicate);
      next.activeEnvironmentId = duplicateId;
    });
  }

  function deleteEnvironment(environmentId: string) {
    const environment = workspace.environments.find((item) => item.id === environmentId);
    if (!environment) {
      return;
    }

    if (workspace.environments.length <= 1) {
      window.alert("At least one environment is required.");
      return;
    }

    if (!window.confirm(`Delete environment "${environment.name}"?`)) {
      return;
    }

    commitWorkspace((next) => {
      next.environments = next.environments.filter((item) => item.id !== environmentId);
      if (next.activeEnvironmentId === environmentId) {
        next.activeEnvironmentId = next.environments[0]?.id ?? "";
      }
    });
  }

  function exportCollection(collectionId: string) {
    const collection = workspace.collections.find((item) => item.id === collectionId);
    if (!collection) {
      return;
    }

    const requestMapById = new Map(workspace.requests.map((request) => [request.id, request]));
    const exportPayload = {
      format: "devox-collection",
      version: 1,
      collection: {
        id: collection.id,
        name: collection.name
      },
      folders: collection.folders,
      requests: collection.requestIds
        .map((requestId) => requestMapById.get(requestId))
        .filter((request): request is RequestDraft => Boolean(request))
    };

    downloadJsonFile(`${sanitizeFileName(collection.name || "collection")}.json`, exportPayload);
    closeAllMenus();
  }

  function renameCollection(collectionId: string) {
    const collection = workspace.collections.find((item) => item.id === collectionId);
    if (!collection) {
      return;
    }

    const name = window.prompt("Collection name", collection.name)?.trim();
    if (!name) {
      return;
    }

    commitWorkspace((next) => {
      const target = next.collections.find((item) => item.id === collectionId);
      if (target) {
        target.name = name;
      }
    });
    closeAllMenus();
  }

  function addFolder(collectionId: string) {
    const name = window.prompt("Folder name", "New Folder")?.trim();
    if (!name) {
      return;
    }

    commitWorkspace((next) => {
      const collection = next.collections.find((item) => item.id === collectionId);
      if (collection) {
        collection.folders.push({
          id: makeId("folder"),
          name,
          requestIds: []
        });
      }
    });

    ensureCollectionExpanded(collectionId);
    closeAllMenus();
  }

  function deleteCollection(collectionId: string) {
    const collection = workspace.collections.find((item) => item.id === collectionId);
    if (!collection) {
      return;
    }

    if (workspace.collections.length <= 1) {
      window.alert("At least one collection is required.");
      return;
    }

    if (!window.confirm(`Delete collection "${collection.name}"?`)) {
      return;
    }

    commitWorkspace((next) => {
      const removingIds = new Set(
        next.requests
          .filter((request) => request.collectionId === collectionId)
          .map((request) => request.id)
      );

      next.collections = next.collections.filter((item) => item.id !== collectionId);
      next.requests = next.requests.filter((request) => !removingIds.has(request.id));
      next.history = next.history.filter((entry) => !removingIds.has(entry.requestId));
      next.openRequestIds = next.openRequestIds.filter((id) => !removingIds.has(id));
      next.pinnedRequestIds = next.pinnedRequestIds.filter((id) => !removingIds.has(id));

      const fallbackCollection = next.collections[0];
      next.activeCollectionId = fallbackCollection?.id ?? "";
      next.activeRequestId = fallbackCollection?.requestIds[0] ?? next.requests[0]?.id ?? "";
      if (next.activeRequestId && !next.openRequestIds.includes(next.activeRequestId)) {
        next.openRequestIds.push(next.activeRequestId);
      }
    });

    closeAllMenus();
    setResponseSummary(null);
    setResponseError(null);
  }

  function orderCollection(collectionId: string, direction: "top" | "up" | "down") {
    commitWorkspace((next) => {
      const orderedIds = reorderByDirection(
        next.collections.map((collection) => collection.id),
        collectionId,
        direction
      );
      next.collections = orderedIds
        .map((id) => next.collections.find((collection) => collection.id === id))
        .filter((collection): collection is Collection => Boolean(collection));
    });
    closeAllMenus();
  }

  function renameFolder(collectionId: string, folderId: string) {
    const folder = workspace.collections
      .find((item) => item.id === collectionId)
      ?.folders.find((item) => item.id === folderId);
    if (!folder) {
      return;
    }

    const name = window.prompt("Folder name", folder.name)?.trim();
    if (!name) {
      return;
    }

    commitWorkspace((next) => {
      const target = next.collections
        .find((item) => item.id === collectionId)
        ?.folders.find((item) => item.id === folderId);
      if (target) {
        target.name = name;
      }
    });
    closeAllMenus();
  }

  function duplicateFolder(collectionId: string, folderId: string) {
    commitWorkspace((next) => {
      const collection = next.collections.find((item) => item.id === collectionId);
      const folder = collection?.folders.find((item) => item.id === folderId);
      if (!collection || !folder) {
        return;
      }

      const duplicateFolderId = makeId("folder");
      const duplicatedRequests = folder.requestIds
        .map((requestId) => next.requests.find((request) => request.id === requestId))
        .filter((request): request is RequestDraft => Boolean(request))
        .map((request) =>
          createRequestDraft(collectionId, {
            ...cloneRestValue(request),
            id: makeId("request"),
            createdAt: new Date().toISOString(),
            folderId: duplicateFolderId,
            name: `${request.name} Copy`
          })
        );

      next.requests.push(...duplicatedRequests);

      const folderIndex = collection.folders.findIndex((item) => item.id === folderId);
      collection.folders.splice(folderIndex + 1, 0, {
        id: duplicateFolderId,
        name: `${folder.name} Copy`,
        requestIds: duplicatedRequests.map((request) => request.id)
      });

      const lastOriginalRequestId = folder.requestIds[folder.requestIds.length - 1];
      const insertAt =
        lastOriginalRequestId && collection.requestIds.includes(lastOriginalRequestId)
          ? collection.requestIds.indexOf(lastOriginalRequestId) + 1
          : collection.requestIds.length;
      collection.requestIds.splice(insertAt, 0, ...duplicatedRequests.map((request) => request.id));
    });

    ensureCollectionExpanded(collectionId);
    closeAllMenus();
  }

  function moveFolderToCollection(fromCollectionId: string, folderId: string, toCollectionId: string) {
    if (fromCollectionId === toCollectionId) {
      return;
    }

    commitWorkspace((next) => {
      const sourceCollection = next.collections.find((item) => item.id === fromCollectionId);
      const targetCollection = next.collections.find((item) => item.id === toCollectionId);
      if (!sourceCollection || !targetCollection) {
        return;
      }

      const folderIndex = sourceCollection.folders.findIndex((item) => item.id === folderId);
      if (folderIndex < 0) {
        return;
      }

      const [folder] = sourceCollection.folders.splice(folderIndex, 1);
      targetCollection.folders.push(folder);
      sourceCollection.requestIds = sourceCollection.requestIds.filter(
        (requestId) => !folder.requestIds.includes(requestId)
      );
      targetCollection.requestIds.push(
        ...folder.requestIds.filter((requestId) => !targetCollection.requestIds.includes(requestId))
      );

      next.requests.forEach((request) => {
        if (folder.requestIds.includes(request.id)) {
          request.collectionId = toCollectionId;
          request.folderId = folder.id;
        }
      });
    });

    ensureCollectionExpanded(toCollectionId);
    closeAllMenus();
  }

  function deleteFolder(collectionId: string, folderId: string) {
    const folder = workspace.collections
      .find((item) => item.id === collectionId)
      ?.folders.find((item) => item.id === folderId);
    if (!folder) {
      return;
    }

    if (!window.confirm(`Delete folder "${folder.name}" and all requests inside it?`)) {
      return;
    }

    commitWorkspace((next) => {
      const collection = next.collections.find((item) => item.id === collectionId);
      if (!collection) {
        return;
      }

      const removingIds = new Set(folder.requestIds);
      collection.folders = collection.folders.filter((item) => item.id !== folderId);
      collection.requestIds = collection.requestIds.filter((requestId) => !removingIds.has(requestId));
      next.requests = next.requests.filter((request) => !removingIds.has(request.id));
      next.history = next.history.filter((entry) => !removingIds.has(entry.requestId));
      next.openRequestIds = next.openRequestIds.filter((id) => !removingIds.has(id));
      next.pinnedRequestIds = next.pinnedRequestIds.filter((id) => !removingIds.has(id));

      if (removingIds.has(next.activeRequestId)) {
        next.activeRequestId = collection.requestIds[0] ?? next.requests[0]?.id ?? "";
      }
    });

    closeAllMenus();
    setResponseSummary(null);
    setResponseError(null);
  }

  function sortFolderRequests(
    collectionId: string,
    folderId: string,
    mode: "alpha-asc" | "alpha-desc" | "time"
  ) {
    commitWorkspace((next) => {
      const collection = next.collections.find((item) => item.id === collectionId);
      const folder = collection?.folders.find((item) => item.id === folderId);
      if (!collection || !folder) {
        return;
      }

      const requestIndex = new Map(next.requests.map((request) => [request.id, request]));
      folder.requestIds = folder.requestIds.slice().sort((leftId, rightId) => {
        const left = requestIndex.get(leftId);
        const right = requestIndex.get(rightId);
        if (!left || !right) {
          return 0;
        }
        if (mode === "alpha-asc") {
          return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
        }
        if (mode === "alpha-desc") {
          return right.name.localeCompare(left.name, undefined, { sensitivity: "base" });
        }
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      });
    });

    closeAllMenus();
  }

  function orderFolder(collectionId: string, folderId: string, direction: "top" | "up" | "down") {
    commitWorkspace((next) => {
      const collection = next.collections.find((item) => item.id === collectionId);
      if (!collection) {
        return;
      }

      const orderedIds = reorderByDirection(
        collection.folders.map((folder) => folder.id),
        folderId,
        direction
      );
      collection.folders = orderedIds
        .map((id) => collection.folders.find((folder) => folder.id === id))
        .filter((folder): folder is CollectionFolder => Boolean(folder));
    });
    closeAllMenus();
  }

  function renameRequest(requestId: string) {
    const request = requestMap().get(requestId);
    if (!request) {
      return;
    }

    const name = window.prompt("Request name", request.name)?.trim();
    if (!name) {
      return;
    }

    commitWorkspace((next) => {
      const target = next.requests.find((item) => item.id === requestId);
      if (target) {
        target.name = name;
      }
    });
    closeAllMenus();
  }

  async function copyRequestAsCurl(requestId: string) {
    const request = requestMap().get(requestId);
    if (!request) {
      return;
    }

    const curl = buildCurlCommand(request, activeEnvironment() ?? undefined);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(curl);
      } else {
        window.prompt("Copy cURL", curl);
      }
    } catch {
      window.prompt("Copy cURL", curl);
    }

    closeAllMenus();
  }

  function duplicateRequest(requestId: string) {
    const request = requestMap().get(requestId);
    if (!request) {
      return;
    }

    commitWorkspace((next) => {
      const target = next.requests.find((item) => item.id === requestId);
      const collection = next.collections.find((item) => item.id === request.collectionId);
      if (!target || !collection) {
        return;
      }

      const duplicate = createRequestDraft(request.collectionId, {
        ...cloneRestValue(target),
        id: makeId("request"),
        name: `${target.name} Copy`,
        createdAt: new Date().toISOString(),
        folderId: target.folderId ?? null
      });

      next.requests.push(duplicate);

      const collectionIndex = collection.requestIds.indexOf(requestId);
      collection.requestIds.splice(collectionIndex + 1, 0, duplicate.id);

      if (duplicate.folderId) {
        const folder = collection.folders.find((item) => item.id === duplicate.folderId);
        const folderIndex = folder?.requestIds.indexOf(requestId) ?? -1;
        if (folder && folderIndex >= 0) {
          folder.requestIds.splice(folderIndex + 1, 0, duplicate.id);
        }
      }

      next.activeRequestId = duplicate.id;
      next.activeCollectionId = duplicate.collectionId;
      next.openRequestIds.push(duplicate.id);
    });

    ensureCollectionExpanded(request.collectionId);
    closeAllMenus();
  }

  function moveRequest(requestId: string, target: { collectionId: string; folderId: string | null }) {
    const request = requestMap().get(requestId);
    if (!request) {
      return;
    }

    commitWorkspace((next) => {
      const sourceCollection = next.collections.find((item) => item.id === request.collectionId);
      const destinationCollection = next.collections.find((item) => item.id === target.collectionId);
      const sourceRequest = next.requests.find((item) => item.id === requestId);
      if (!sourceCollection || !destinationCollection || !sourceRequest) {
        return;
      }

      sourceCollection.requestIds = sourceCollection.requestIds.filter((id) => id !== requestId);
      sourceCollection.folders.forEach((folder) => {
        folder.requestIds = folder.requestIds.filter((id) => id !== requestId);
      });

      destinationCollection.requestIds.push(requestId);
      if (target.folderId) {
        const targetFolder = destinationCollection.folders.find((item) => item.id === target.folderId);
        targetFolder?.requestIds.push(requestId);
      }

      sourceRequest.collectionId = target.collectionId;
      sourceRequest.folderId = target.folderId;
      next.activeCollectionId = target.collectionId;
      next.activeRequestId = requestId;
    });

    ensureCollectionExpanded(target.collectionId);
    closeAllMenus();
  }

  function deleteRequest(requestId: string) {
    const request = requestMap().get(requestId);
    if (!request) {
      return;
    }

    if (!window.confirm(`Delete request "${request.name}"?`)) {
      return;
    }

    commitWorkspace((next) => {
      next.requests = next.requests.filter((item) => item.id !== requestId);
      next.history = next.history.filter((entry) => entry.requestId !== requestId);
      next.openRequestIds = next.openRequestIds.filter((id) => id !== requestId);
      next.pinnedRequestIds = next.pinnedRequestIds.filter((id) => id !== requestId);

      next.collections.forEach((collection) => {
        collection.requestIds = collection.requestIds.filter((id) => id !== requestId);
        collection.folders.forEach((folder) => {
          folder.requestIds = folder.requestIds.filter((id) => id !== requestId);
        });
      });

      if (next.activeRequestId === requestId) {
        next.activeRequestId = next.requests[0]?.id ?? "";
        const fallback = next.requests.find((item) => item.id === next.activeRequestId);
        if (fallback) {
          next.activeCollectionId = fallback.collectionId;
        }
      }
    });

    closeAllMenus();
    setResponseSummary(null);
    setResponseError(null);
  }

  function orderRequest(requestId: string, direction: "top" | "up" | "down") {
    const request = requestMap().get(requestId);
    if (!request) {
      return;
    }

    commitWorkspace((next) => {
      const collection = next.collections.find((item) => item.id === request.collectionId);
      if (!collection) {
        return;
      }

      if (request.folderId) {
        const folder = collection.folders.find((item) => item.id === request.folderId);
        if (folder) {
          folder.requestIds = reorderByDirection(folder.requestIds, requestId, direction);
        }
        return;
      }

      const folderIds = new Set(collection.folders.map((item) => item.id));
      const rootRequestIds = collection.requestIds.filter((id) => {
        const entry = next.requests.find((item) => item.id === id);
        return entry && (!entry.folderId || !folderIds.has(entry.folderId));
      });
      const orderedRootIds = reorderByDirection(rootRequestIds, requestId, direction);
      let rootIndex = 0;
      collection.requestIds = collection.requestIds.map((id) => {
        const entry = next.requests.find((item) => item.id === id);
        if (entry && (!entry.folderId || !folderIds.has(entry.folderId))) {
          const nextId = orderedRootIds[rootIndex];
          rootIndex += 1;
          return nextId;
        }
        return id;
      });
    });

    closeAllMenus();
  }

  function startCurlImport(collectionId: string, folderId: string | null = null) {
    setCurlImportCollectionId(collectionId);
    setCurlImportFolderId(folderId);
    setCurlInput("curl https://api.example.com/users");
    setCurlError(null);
    closeAllMenus();
  }

  function commitCurlImport() {
    const collectionId = curlImportCollectionId();
    if (!collectionId) {
      return;
    }

    try {
      const request = parseCurlCommand(collectionId, curlInput(), curlImportFolderId());
      addRequestToWorkspace(collectionId, request, curlImportFolderId());
      setCurlImportCollectionId(null);
      setCurlImportFolderId(null);
      setCurlInput("");
      setCurlError(null);
    } catch (error) {
      setCurlError(error instanceof Error ? error.message : "Failed to parse cURL command.");
    }
  }

  async function manualSaveWorkspace() {
    try {
      setSaveFeedback("saving");
      await saveRestWorkspace(snapshotWorkspace());
      setSaveFeedback("saved");
    } catch {
      setSaveFeedback("error");
    }
  }

  async function sendActiveRequest() {
    const request = activeRequest();
    if (!request) {
      return;
    }

    if (!canSendActiveRequest()) {
      setResponseSummary(null);
      setResponseError(
        `${request.kind === "websocket" ? "WebSocket" : "Socket.IO"} requests are not available in the REST runner yet.`
      );
      return;
    }

    setIsSending(true);
    setResponseError(null);

    try {
      const result = await executeRestRequest(request, activeEnvironment() ?? undefined);
      setResponseSummary(result);
      commitWorkspace((next) => {
        next.history = [createHistoryEntry(request, result), ...next.history].slice(0, 20);
      });
    } catch (error) {
      setResponseSummary(null);
      setResponseError(error instanceof Error ? error.message : "Request failed.");
      commitWorkspace((next) => {
        next.history = [createHistoryEntry(request, null), ...next.history].slice(0, 20);
      });
    } finally {
      setIsSending(false);
    }
  }

  function importCollectionFromFile() {
    importCollectionInputRef?.click();
    setShowCollectionCreateMenu(false);
  }

  async function handleImportCollectionFile(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as {
        format?: string;
        collection?: { name?: string };
        folders?: Array<Partial<CollectionFolder>>;
        requests?: Array<Partial<RequestDraft>>;
      };

      const collectionId = makeId("collection");
      const importedFolders =
        parsed.folders?.map((folder, index) => ({
          id: folder.id ?? makeId("folder"),
          name: folder.name?.trim() || `Folder ${index + 1}`,
          requestIds: []
        })) ?? [];
      const importedFolderIds = new Set(importedFolders.map((folder) => folder.id));
      const importedRequests =
        parsed.requests?.map((request, index) =>
          createRequestDraft(collectionId, {
            ...request,
            id: makeId("request"),
            createdAt: new Date().toISOString(),
            name: request.name ?? `Imported Request ${index + 1}`,
            kind: request.kind ?? "http",
            folderId: request.folderId && importedFolderIds.has(request.folderId) ? request.folderId : null
          })
        ) ?? [];

      const requests =
        importedRequests.length > 0
          ? importedRequests
          : [createRequestDraft(collectionId, { name: "Imported Request", url: "{{baseUrl}}/imported" })];

      requests.forEach((request) => {
        if (!request.folderId) {
          return;
        }
        const folder = importedFolders.find((entry) => entry.id === request.folderId);
        if (folder && !folder.requestIds.includes(request.id)) {
          folder.requestIds.push(request.id);
        }
      });

      commitWorkspace((next) => {
        next.collections.push({
          id: collectionId,
          name: parsed.collection?.name || file.name.replace(/\.json$/i, ""),
          folders: importedFolders,
          requestIds: requests.map((request) => request.id)
        });
        next.requests.push(...requests);
        next.activeCollectionId = collectionId;
        next.activeRequestId = requests[0].id;
        next.openRequestIds.push(requests[0].id);
      });

      ensureCollectionExpanded(collectionId);
    } catch {
      window.alert("Import collection is not valid JSON yet. Expected { collection, requests }.");
    } finally {
      target.value = "";
    }
  }

  function openRequestCreationMenu(collectionId: string, folderId: string | null = null, kind?: RequestKind) {
    if (kind === "curl") {
      startCurlImport(collectionId, folderId);
      return;
    }

    if (kind) {
      const request = createRequestForKind(collectionId, kind, folderId);
      addRequestToWorkspace(collectionId, request, folderId);
      closeAllMenus();
      return;
    }

    if (folderId) {
      setFolderAddMenuId((current) => (current === folderId ? null : folderId));
      setCollectionAddMenuId(null);
    } else {
      setCollectionAddMenuId((current) => (current === collectionId ? null : collectionId));
      setFolderAddMenuId(null);
    }

    setCollectionMenuId(null);
    setFolderMenuId(null);
    setRequestMenuId(null);
  }

  function renderCollectionCreateMenu() {
    return (
      <Show when={showCollectionCreateMenu()}>
        <div
          class="theme-panel-soft absolute right-0 top-9 z-10 min-w-[180px] border p-1"
          data-rest-menu-root
          style={{ "border-color": "var(--app-border)" }}
        >
          <button
            class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
            onClick={createCollection}
          >
            Add Collection
          </button>
          <button
            class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
            onClick={importCollectionFromFile}
          >
            Import Collection
          </button>
        </div>
      </Show>
    );
  }

  function renderRequestCreateMenu(collectionId: string, folderId: string | null = null) {
    return (
      <div
        class="theme-panel-soft absolute right-0 top-7 z-10 min-w-[170px] border p-1"
        data-rest-menu-root
        style={{ "border-color": "var(--app-border)" }}
      >
        <For each={requestCreateOptions}>
          {(option) => (
            <button
              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
              onClick={() => openRequestCreationMenu(collectionId, folderId, option.id)}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
    );
  }

  function isCollectionExpanded(collectionId: string) {
    return expandedCollectionIds().includes(collectionId) || collectionFilter().trim().length > 0;
  }

  function startMainPaneResize(event: MouseEvent) {
    event.preventDefault();
    const container = (event.currentTarget as HTMLElement | null)?.parentElement;
    if (!container) {
      return;
    }

    const bounds = container.getBoundingClientRect();
    setMainPaneResizing(true);

    const handlePointerMove = (moveEvent: MouseEvent) => {
      const relativeX = moveEvent.clientX - bounds.left;
      const nextSplit = clampMainPaneSplit((relativeX / bounds.width) * 100);
      setMainPaneSplit(nextSplit);
    };

    const handlePointerUp = () => {
      setMainPaneResizing(false);
      window.localStorage.setItem(mainPaneSplitStorageKey, String(mainPaneSplit()));
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp, { once: true });
  }

  onMount(() => {
    let disposed = false;

    const savedMainPaneSplit = window.localStorage.getItem(mainPaneSplitStorageKey);
    if (savedMainPaneSplit) {
      const parsed = Number(savedMainPaneSplit);
      if (!Number.isNaN(parsed)) {
        setMainPaneSplit(clampMainPaneSplit(parsed));
      }
    }

    loadRestWorkspace()
      .then((state) => {
        if (disposed) {
          return;
        }
        const normalized = normalizeRestWorkspace(state);
        setWorkspace(normalized);
        setExpandedCollectionIds(normalized.activeCollectionId ? [normalized.activeCollectionId] : []);
        setIsLoaded(true);
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        const seed = createDefaultRestWorkspace();
        setWorkspace(seed);
        setExpandedCollectionIds(seed.activeCollectionId ? [seed.activeCollectionId] : []);
        setIsLoaded(true);
      });

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-rest-menu-root]")) {
        return;
      }
      closeAllMenus();
    };

    document.addEventListener("pointerdown", handlePointerDown);

    onCleanup(() => {
      disposed = true;
      document.removeEventListener("pointerdown", handlePointerDown);
      if (persistTimer) {
        window.clearTimeout(persistTimer);
      }
      if (saveFeedbackTimer) {
        window.clearTimeout(saveFeedbackTimer);
      }
    });
  });

  createEffect(() => {
    const activeId = workspace.activeCollectionId;
    if (activeId) {
      ensureCollectionExpanded(activeId);
    }
  });

  return (
    <>
      <WorkspaceSidebarLayout
        sidebarOpen={props.sidebarOpen}
        sidebarWidth={props.sidebarWidth}
        sidebarResizing={props.sidebarResizing}
        onResizeStart={props.onSidebarResizeStart}
        rootClass="min-h-[calc(100vh-72px)]"
        contentClass="theme-workspace-pane grid min-h-0 content-start gap-0"
        contentStyle={{ "border-color": "var(--app-border)" }}
        sidebar={
          <div class="space-y-4">
            <section class="space-y-2">
              <div class="flex items-center gap-1 border-b pb-2" style={{ "border-color": "var(--app-border)" }}>
                <For each={sidebarTabs}>
                  {(tab) => (
                    <button
                      class={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                        sidebarPanel() === tab.id
                          ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
                          : "theme-text-soft"
                      }`}
                      onClick={() => {
                        setSidebarPanel(tab.id);
                        closeAllMenus();
                      }}
                    >
                      {tab.label}
                    </button>
                  )}
                </For>
              </div>

              <Show when={sidebarPanel() === "collections"}>
                <div class="space-y-2">
                  <div class="flex items-center justify-between gap-3">
                    <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">Collections</p>
                    <div class="relative" data-rest-menu-root>
                      <button
                        class="theme-control inline-flex h-6 w-6 items-center justify-center rounded-full text-sm leading-none"
                        title="Collection actions"
                        onClick={() => {
                          setShowCollectionCreateMenu((current) => !current);
                          setCollectionMenuId(null);
                          setCollectionAddMenuId(null);
                        }}
                      >
                        +
                      </button>
                      {renderCollectionCreateMenu()}
                    </div>
                  </div>

                  <input
                    class="theme-input h-8 w-full rounded-md px-2.5 py-1 text-sm"
                    placeholder="Filter collections, folders, requests"
                    value={collectionFilter()}
                    onInput={(event) => setCollectionFilter(event.currentTarget.value)}
                  />

                  <input
                    ref={(element) => {
                      importCollectionInputRef = element;
                    }}
                    accept="application/json"
                    class="hidden"
                    type="file"
                    onChange={handleImportCollectionFile}
                  />

                  <div class="grid gap-1">
                    <For each={filteredCollections()}>
                      {(entry) => {
                        const rootRequests = () => entry.rootRequests;
                        const folders = () => entry.folders;

                        return (
                          <div class="grid gap-1">
                            <div
                              class={`theme-sidebar-item flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 ${
                                workspace.activeCollectionId === entry.collection.id
                                  ? "theme-sidebar-item-active"
                                  : ""
                              }`}
                            >
                              <button
                                class="inline-flex h-5 w-5 items-center justify-center rounded-md text-[11px]"
                                title={isCollectionExpanded(entry.collection.id) ? "Collapse" : "Expand"}
                                onMouseDown={(event) => event.stopPropagation()}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={() => toggleCollectionExpanded(entry.collection.id)}
                              >
                                <span class={`transition ${isCollectionExpanded(entry.collection.id) ? "rotate-90" : ""}`}>
                                  ▸
                                </span>
                              </button>

                              <button
                                class="min-w-0 flex-1 overflow-hidden text-left"
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectCollection(entry.collection.id)}
                              >
                                <p class="theme-text truncate text-[13px] font-medium" title={entry.collection.name}>
                                  {entry.collection.name}
                                </p>
                              </button>

                              <div class="ml-1 flex shrink-0 items-center gap-1">
                                <button
                                  class="theme-chip shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                                  onMouseDown={(event) => event.stopPropagation()}
                                  onPointerDown={(event) => event.stopPropagation()}
                                >
                                  {entry.collection.requestIds.length}
                                </button>

                                <div class="relative shrink-0" data-rest-menu-root>
                                  <button
                                    class="theme-control inline-flex h-5 w-5 items-center justify-center rounded-md text-[11px]"
                                    title="Collection options"
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setCollectionMenuId((current) =>
                                        current === entry.collection.id ? null : entry.collection.id
                                      );
                                      setCollectionOrderMenuId(null);
                                      setCollectionAddMenuId(null);
                                      setShowCollectionCreateMenu(false);
                                    }}
                                  >
                                    ⋯
                                  </button>

                                  <Show when={collectionMenuId() === entry.collection.id}>
                                    <div
                                      class="theme-panel-soft absolute right-0 top-7 z-10 min-w-[160px] border p-1"
                                      data-rest-menu-root
                                      style={{ "border-color": "var(--app-border)" }}
                                    >
                                      <button
                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                        onClick={() => renameCollection(entry.collection.id)}
                                      >
                                        Rename
                                      </button>
                                      <button
                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                        onClick={() => addFolder(entry.collection.id)}
                                      >
                                        Add Folder
                                      </button>
                                      <button
                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                        onClick={() => exportCollection(entry.collection.id)}
                                      >
                                        Export
                                      </button>
                                      <div class="relative" data-rest-menu-root>
                                        <button
                                          class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setCollectionOrderMenuId((current) =>
                                              current === entry.collection.id ? null : entry.collection.id
                                            );
                                          }}
                                        >
                                          <span>Order</span>
                                          <span class="theme-text-soft text-[10px]">›</span>
                                        </button>

                                        <Show when={collectionOrderMenuId() === entry.collection.id}>
                                          <div
                                            class="theme-panel-soft absolute left-full top-0 ml-1 min-w-[132px] border p-1"
                                            data-rest-menu-root
                                            style={{ "border-color": "var(--app-border)" }}
                                          >
                                            <button
                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                              onClick={() => orderCollection(entry.collection.id, "top")}
                                            >
                                              Pin to Top
                                            </button>
                                            <button
                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                              onClick={() => orderCollection(entry.collection.id, "up")}
                                            >
                                              Move Up
                                            </button>
                                            <button
                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                              onClick={() => orderCollection(entry.collection.id, "down")}
                                            >
                                              Move Down
                                            </button>
                                          </div>
                                        </Show>
                                      </div>
                                      <div class="my-1 border-t" style={{ "border-color": "var(--app-border)" }} />
                                      <button
                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]"
                                        onClick={() => deleteCollection(entry.collection.id)}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </Show>
                                </div>

                                <div class="relative shrink-0" data-rest-menu-root>
                                  <button
                                    class="inline-flex h-5 w-5 items-center justify-center rounded-md text-xs"
                                    title="Add request"
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openRequestCreationMenu(entry.collection.id, null);
                                    }}
                                  >
                                    +
                                  </button>
                                  <Show when={collectionAddMenuId() === entry.collection.id}>
                                    {renderRequestCreateMenu(entry.collection.id, null)}
                                  </Show>
                                </div>
                              </div>
                            </div>

                            <Show when={isCollectionExpanded(entry.collection.id)}>
                              <div class="ml-2 grid gap-0.5">
                                <For each={rootRequests()}>
                                  {(request) => (
                                    <div
                                      class={`theme-sidebar-item flex min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                                        workspace.activeRequestId === request.id
                                          ? "theme-sidebar-item-active"
                                          : ""
                                      }`}
                                    >
                                      <button class={getRequestBadgeClass(request)} onClick={() => openRequestTab(request.id, request.collectionId)}>
                                        {getRequestKindLabel(request)}
                                      </button>
                                      <button class="min-w-0 flex-1 text-left" onClick={() => openRequestTab(request.id, request.collectionId)}>
                                        <p class="truncate text-[13px] font-medium" title={request.name}>{request.name}</p>
                                      </button>
                                      <div class="relative shrink-0" data-rest-menu-root>
                                        <button
                                          class="theme-control inline-flex h-5 w-5 items-center justify-center rounded-md text-[11px]"
                                          title="Request options"
                                          onMouseDown={(event) => event.stopPropagation()}
                                          onPointerDown={(event) => event.stopPropagation()}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setRequestMenuId((current) => current === request.id ? null : request.id);
                                            setRequestOrderMenuId(null);
                                            setRequestMoveMenuId(null);
                                          }}
                                        >
                                          ⋯
                                        </button>
                                        <Show when={requestMenuId() === request.id}>
                                          <div
                                            class="theme-panel-soft absolute right-0 top-7 z-10 min-w-[172px] border p-1"
                                            data-rest-menu-root
                                            style={{ "border-color": "var(--app-border)" }}
                                          >
                                            <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => void copyRequestAsCurl(request.id)}>
                                              Copy cURL
                                            </button>
                                            <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => renameRequest(request.id)}>
                                              Rename
                                            </button>
                                            <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => duplicateRequest(request.id)}>
                                              Duplicate
                                            </button>
                                            <div class="relative" data-rest-menu-root>
                                              <button
                                                class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  setRequestMoveMenuId((current) => current === request.id ? null : request.id);
                                                  setRequestOrderMenuId(null);
                                                }}
                                              >
                                                <span>Move to</span>
                                                <span class="theme-text-soft text-[10px]">›</span>
                                              </button>
                                              <Show when={requestMoveMenuId() === request.id}>
                                                <div
                                                  class="theme-panel-soft absolute left-full top-0 ml-1 min-w-[188px] border p-1"
                                                  data-rest-menu-root
                                                  style={{ "border-color": "var(--app-border)" }}
                                                >
                                                  <For each={workspace.collections}>
                                                    {(collection) => (
                                                      <>
                                                        <button
                                                          class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                          onClick={() => moveRequest(request.id, { collectionId: collection.id, folderId: null })}
                                                        >
                                                          {collection.name}
                                                        </button>
                                                        <For each={collection.folders}>
                                                          {(folder) => (
                                                            <button
                                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 pl-7 text-left text-sm"
                                                              onClick={() => moveRequest(request.id, { collectionId: collection.id, folderId: folder.id })}
                                                            >
                                                              {collection.name} / {folder.name}
                                                            </button>
                                                          )}
                                                        </For>
                                                      </>
                                                    )}
                                                  </For>
                                                </div>
                                              </Show>
                                            </div>
                                            <div class="relative" data-rest-menu-root>
                                              <button
                                                class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  setRequestOrderMenuId((current) => current === request.id ? null : request.id);
                                                  setRequestMoveMenuId(null);
                                                }}
                                              >
                                                <span>Order</span>
                                                <span class="theme-text-soft text-[10px]">›</span>
                                              </button>
                                              <Show when={requestOrderMenuId() === request.id}>
                                                <div
                                                  class="theme-panel-soft absolute left-full top-0 ml-1 min-w-[132px] border p-1"
                                                  data-rest-menu-root
                                                  style={{ "border-color": "var(--app-border)" }}
                                                >
                                                  <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => orderRequest(request.id, "top")}>
                                                    Pin to Top
                                                  </button>
                                                  <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => orderRequest(request.id, "up")}>
                                                    Move Up
                                                  </button>
                                                  <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => orderRequest(request.id, "down")}>
                                                    Move Down
                                                  </button>
                                                </div>
                                              </Show>
                                            </div>
                                            <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]" onClick={() => deleteRequest(request.id)}>
                                              Delete
                                            </button>
                                          </div>
                                        </Show>
                                      </div>
                                    </div>
                                  )}
                                </For>
                                <For each={folders()}>
                                  {(folderEntry) => (
                                    <div class="grid gap-1">
                                      <div class="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5">
                                        <span class="theme-chip rounded-full px-2 py-0.5 text-[11px] font-medium">Dir</span>
                                        <p class="min-w-0 flex-1 truncate text-[13px] font-medium" title={folderEntry.folder.name}>
                                          {folderEntry.folder.name}
                                        </p>
                                        <span class="theme-chip rounded-full px-2 py-0.5 text-[11px] font-medium">
                                          {folderEntry.requests.length}
                                        </span>
                                        <div class="relative shrink-0" data-rest-menu-root>
                                          <button
                                            class="inline-flex h-5 w-5 items-center justify-center rounded-md text-xs"
                                            title="Add request"
                                            onMouseDown={(event) => event.stopPropagation()}
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              openRequestCreationMenu(entry.collection.id, folderEntry.folder.id);
                                            }}
                                          >
                                            +
                                          </button>
                                          <Show when={folderAddMenuId() === folderEntry.folder.id}>
                                            {renderRequestCreateMenu(entry.collection.id, folderEntry.folder.id)}
                                          </Show>
                                        </div>
                                        <div class="relative shrink-0" data-rest-menu-root>
                                          <button
                                            class="theme-control inline-flex h-5 w-5 items-center justify-center rounded-md text-[11px]"
                                            title="Folder options"
                                            onMouseDown={(event) => event.stopPropagation()}
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              setFolderMenuId((current) => current === folderEntry.folder.id ? null : folderEntry.folder.id);
                                              setFolderOrderMenuId(null);
                                              setFolderMoveMenuId(null);
                                            }}
                                          >
                                            ⋯
                                          </button>
                                          <Show when={folderMenuId() === folderEntry.folder.id}>
                                            <div
                                              class="theme-panel-soft absolute right-0 top-7 z-10 min-w-[176px] border p-1"
                                              data-rest-menu-root
                                              style={{ "border-color": "var(--app-border)" }}
                                            >
                                              <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => renameFolder(entry.collection.id, folderEntry.folder.id)}>
                                                Rename
                                              </button>
                                              <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => duplicateFolder(entry.collection.id, folderEntry.folder.id)}>
                                                Duplicate
                                              </button>
                                              <div class="relative" data-rest-menu-root>
                                                <button
                                                  class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    setFolderMoveMenuId((current) => current === folderEntry.folder.id ? null : folderEntry.folder.id);
                                                    setFolderOrderMenuId(null);
                                                  }}
                                                >
                                                  <span>Move to</span>
                                                  <span class="theme-text-soft text-[10px]">›</span>
                                                </button>
                                                <Show when={folderMoveMenuId() === folderEntry.folder.id}>
                                                  <div
                                                    class="theme-panel-soft absolute left-full top-0 ml-1 min-w-[170px] border p-1"
                                                    data-rest-menu-root
                                                    style={{ "border-color": "var(--app-border)" }}
                                                  >
                                                    <For each={workspace.collections.filter((collection) => collection.id !== entry.collection.id)}>
                                                      {(collection) => (
                                                        <button
                                                          class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                          onClick={() => moveFolderToCollection(entry.collection.id, folderEntry.folder.id, collection.id)}
                                                        >
                                                          {collection.name}
                                                        </button>
                                                      )}
                                                    </For>
                                                  </div>
                                                </Show>
                                              </div>
                                              <div class="relative" data-rest-menu-root>
                                                <button
                                                  class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    setFolderOrderMenuId((current) => current === folderEntry.folder.id ? null : folderEntry.folder.id);
                                                    setFolderMoveMenuId(null);
                                                  }}
                                                >
                                                  <span>Order</span>
                                                  <span class="theme-text-soft text-[10px]">›</span>
                                                </button>
                                                <Show when={folderOrderMenuId() === folderEntry.folder.id}>
                                                  <div
                                                    class="theme-panel-soft absolute left-full top-0 ml-1 min-w-[132px] border p-1"
                                                    data-rest-menu-root
                                                    style={{ "border-color": "var(--app-border)" }}
                                                  >
                                                    <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => orderFolder(entry.collection.id, folderEntry.folder.id, "top")}>
                                                      Pin to Top
                                                    </button>
                                                    <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => orderFolder(entry.collection.id, folderEntry.folder.id, "up")}>
                                                      Move Up
                                                    </button>
                                                    <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => orderFolder(entry.collection.id, folderEntry.folder.id, "down")}>
                                                      Move Down
                                                    </button>
                                                  </div>
                                                </Show>
                                              </div>
                                              <div class="relative" data-rest-menu-root>
                                                <button
                                                  class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    setFolderOrderMenuId((current) => current === `sort:${folderEntry.folder.id}` ? null : `sort:${folderEntry.folder.id}`);
                                                    setFolderMoveMenuId(null);
                                                  }}
                                                >
                                                  <span>Sort</span>
                                                  <span class="theme-text-soft text-[10px]">›</span>
                                                </button>
                                                <Show when={folderOrderMenuId() === `sort:${folderEntry.folder.id}`}>
                                                  <div
                                                    class="theme-panel-soft absolute left-full top-0 ml-1 min-w-[156px] border p-1"
                                                    data-rest-menu-root
                                                    style={{ "border-color": "var(--app-border)" }}
                                                  >
                                                    <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => sortFolderRequests(entry.collection.id, folderEntry.folder.id, "alpha-asc")}>
                                                      A-Z
                                                    </button>
                                                    <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => sortFolderRequests(entry.collection.id, folderEntry.folder.id, "alpha-desc")}>
                                                      Z-A
                                                    </button>
                                                    <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => sortFolderRequests(entry.collection.id, folderEntry.folder.id, "time")}>
                                                      By Time (Newest)
                                                    </button>
                                                  </div>
                                                </Show>
                                              </div>
                                              <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]" onClick={() => deleteFolder(entry.collection.id, folderEntry.folder.id)}>
                                                Delete
                                              </button>
                                            </div>
                                          </Show>
                                        </div>
                                      </div>

                                      <div class="grid gap-1">
                                        <For each={folderEntry.requests}>
                                          {(request) => (
                                            <div
                                              class={`theme-sidebar-item flex min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                                                workspace.activeRequestId === request.id
                                                  ? "theme-sidebar-item-active"
                                                  : ""
                                              }`}
                                            >
                                              <button class={getRequestBadgeClass(request)} onClick={() => openRequestTab(request.id, request.collectionId)}>
                                                {getRequestKindLabel(request)}
                                              </button>
                                              <button class="min-w-0 flex-1 text-left" onClick={() => openRequestTab(request.id, request.collectionId)}>
                                                <p class="truncate text-[13px] font-medium" title={request.name}>{request.name}</p>
                                              </button>
                                              <div class="relative shrink-0" data-rest-menu-root>
                                                <button
                                                  class="theme-control inline-flex h-5 w-5 items-center justify-center rounded-md text-[11px]"
                                                  title="Request options"
                                                  onMouseDown={(event) => event.stopPropagation()}
                                                  onPointerDown={(event) => event.stopPropagation()}
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    setRequestMenuId((current) => current === request.id ? null : request.id);
                                                    setRequestOrderMenuId(null);
                                                    setRequestMoveMenuId(null);
                                                  }}
                                                >
                                                  ⋯
                                                </button>
                                                <Show when={requestMenuId() === request.id}>
                                                  <div
                                                    class="theme-panel-soft absolute right-0 top-7 z-10 min-w-[172px] border p-1"
                                                    data-rest-menu-root
                                                    style={{ "border-color": "var(--app-border)" }}
                                                  >
                                                    <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => void copyRequestAsCurl(request.id)}>
                                                      Copy cURL
                                                    </button>
                                                    <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => renameRequest(request.id)}>
                                                      Rename
                                                    </button>
                                                    <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => duplicateRequest(request.id)}>
                                                      Duplicate
                                                    </button>
                                                    <div class="relative" data-rest-menu-root>
                                                      <button
                                                        class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                                        onClick={(event) => {
                                                          event.stopPropagation();
                                                          setRequestMoveMenuId((current) => current === request.id ? null : request.id);
                                                          setRequestOrderMenuId(null);
                                                        }}
                                                      >
                                                        <span>Move to</span>
                                                        <span class="theme-text-soft text-[10px]">›</span>
                                                      </button>
                                                      <Show when={requestMoveMenuId() === request.id}>
                                                        <div
                                                          class="theme-panel-soft absolute left-full top-0 ml-1 min-w-[188px] border p-1"
                                                          data-rest-menu-root
                                                          style={{ "border-color": "var(--app-border)" }}
                                                        >
                                                          <For each={workspace.collections}>
                                                            {(collection) => (
                                                              <>
                                                                <button
                                                                  class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                                  onClick={() => moveRequest(request.id, { collectionId: collection.id, folderId: null })}
                                                                >
                                                                  {collection.name}
                                                                </button>
                                                                <For each={collection.folders}>
                                                                  {(folder) => (
                                                                    <button
                                                                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 pl-7 text-left text-sm"
                                                                      onClick={() => moveRequest(request.id, { collectionId: collection.id, folderId: folder.id })}
                                                                    >
                                                                      {collection.name} / {folder.name}
                                                                    </button>
                                                                  )}
                                                                </For>
                                                              </>
                                                            )}
                                                          </For>
                                                        </div>
                                                      </Show>
                                                    </div>
                                                    <div class="relative" data-rest-menu-root>
                                                      <button
                                                        class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                                        onClick={(event) => {
                                                          event.stopPropagation();
                                                          setRequestOrderMenuId((current) => current === request.id ? null : request.id);
                                                          setRequestMoveMenuId(null);
                                                        }}
                                                      >
                                                        <span>Order</span>
                                                        <span class="theme-text-soft text-[10px]">›</span>
                                                      </button>
                                                      <Show when={requestOrderMenuId() === request.id}>
                                                        <div
                                                          class="theme-panel-soft absolute left-full top-0 ml-1 min-w-[132px] border p-1"
                                                          data-rest-menu-root
                                                          style={{ "border-color": "var(--app-border)" }}
                                                        >
                                                          <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => orderRequest(request.id, "top")}>
                                                            Pin to Top
                                                          </button>
                                                          <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => orderRequest(request.id, "up")}>
                                                            Move Up
                                                          </button>
                                                          <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => orderRequest(request.id, "down")}>
                                                            Move Down
                                                          </button>
                                                        </div>
                                                      </Show>
                                                    </div>
                                                    <button class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]" onClick={() => deleteRequest(request.id)}>
                                                      Delete
                                                    </button>
                                                  </div>
                                                </Show>
                                              </div>
                                            </div>
                                          )}
                                        </For>
                                      </div>
                                    </div>
                                  )}
                                </For>
                                <Show when={rootRequests().length === 0 && folders().length === 0}>
                                  <div class="theme-text-soft px-2 py-1.5 text-xs">
                                    {collectionFilter().trim() ? "No matches" : "No requests yet"}
                                  </div>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                    <Show when={filteredCollections().length === 0}>
                      <div class="theme-text-soft px-2 py-2 text-xs">No matches</div>
                    </Show>
                  </div>
                </div>
              </Show>

              <Show when={sidebarPanel() === "environments"}>
                <div class="space-y-2">
                  <div class="flex items-center justify-between gap-3">
                    <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">Environments</p>
                    <button
                      class="theme-control inline-flex h-6 w-6 items-center justify-center rounded-full text-sm leading-none"
                      title="New environment"
                      onClick={createEnvironment}
                    >
                      +
                    </button>
                  </div>
                  <div class="grid gap-1">
                    <For each={workspace.environments}>
                      {(environment) => (
                        <button
                          class={`theme-sidebar-item flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                            workspace.activeEnvironmentId === environment.id
                              ? "theme-sidebar-item-active"
                              : ""
                          }`}
                          onClick={() =>
                            commitWorkspace((next) => {
                              next.activeEnvironmentId = environment.id;
                            })
                          }
                        >
                          <p class="theme-text text-sm font-semibold">{environment.name}</p>
                          <span class="theme-text-soft text-xs">{environment.variables.length}</span>
                        </button>
                      )}
                    </For>
                  </div>

                  <Show when={activeEnvironment()}>
                    {(environment) => (
                      <div class="mt-3 space-y-2 border-t pt-3" style={{ "border-color": "var(--app-border)" }}>
                        <div class="flex items-center justify-between gap-2">
                          <input
                            class="theme-input h-8 min-w-0 flex-1 rounded-md px-2.5 py-1 text-sm font-medium"
                            value={environment().name}
                            onInput={(event) =>
                              commitWorkspace((next) => {
                                const target = next.environments.find((item) => item.id === environment().id);
                                if (target) {
                                  target.name = event.currentTarget.value;
                                }
                              })
                            }
                          />
                          <button
                            class="theme-control inline-flex h-6 w-6 items-center justify-center rounded-full text-sm leading-none"
                            title="Duplicate environment"
                            onClick={() => duplicateEnvironment(environment().id)}
                          >
                            ⎘
                          </button>
                          <button
                            class="theme-control inline-flex h-6 w-6 items-center justify-center rounded-full text-sm leading-none text-[#ff3b30]"
                            title="Delete environment"
                            onClick={() => deleteEnvironment(environment().id)}
                          >
                            <MacCloseIcon />
                          </button>
                        </div>

                        <div class="flex items-center justify-between gap-2">
                          <p class="theme-text-soft text-[11px] font-semibold uppercase tracking-[0.16em]">
                            Variables
                          </p>
                          <button
                            class="inline-flex h-6 w-6 items-center justify-center rounded-full transition"
                            title="Add variable"
                            onClick={() =>
                              commitWorkspace((next) => {
                                const target = next.environments.find((item) => item.id === environment().id);
                                if (target) {
                                  target.variables = [...target.variables, createKeyValueEntry()];
                                }
                              })
                            }
                          >
                            <MacAddIcon />
                          </button>
                        </div>

                        <KeyValueTableEditor
                          rows={environment().variables}
                          valuePlaceholder="https://api.example.com"
                          onUpdate={(id, key, value) =>
                            commitWorkspace((next) => {
                              const target = next.environments.find((item) => item.id === environment().id);
                              if (target) {
                                target.variables = target.variables.map((entry) =>
                                  entry.id === id ? { ...entry, [key]: value } : entry
                                );
                              }
                            })
                          }
                          onToggle={(id) =>
                            commitWorkspace((next) => {
                              const target = next.environments.find((item) => item.id === environment().id);
                              if (target) {
                                target.variables = target.variables.map((entry) =>
                                  entry.id === id ? { ...entry, enabled: !entry.enabled } : entry
                                );
                              }
                            })
                          }
                          onRemove={(id) =>
                            commitWorkspace((next) => {
                              const target = next.environments.find((item) => item.id === environment().id);
                              if (target) {
                                target.variables = target.variables.filter((entry) => entry.id !== id);
                              }
                            })
                          }
                        />
                      </div>
                    )}
                  </Show>
                </div>
              </Show>

              <Show when={sidebarPanel() === "history"}>
                <div class="space-y-2">
                  <div class="flex items-center justify-between gap-3">
                    <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">History</p>
                  </div>
                  <div class="grid gap-1">
                    <For each={workspace.history}>
                      {(entry) => (
                        <button
                          class="theme-sidebar-item flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left"
                          onClick={() => openRequestTab(entry.requestId)}
                        >
                          <span class={`theme-method-badge shrink-0 ${getMethodClass(entry.method)}`}>
                            {entry.method}
                          </span>
                          <p class="min-w-0 flex-1 truncate text-[13px] font-medium">{entry.requestName}</p>
                          <span class="theme-text-soft text-xs">{entry.status ? `${entry.status}` : "ERR"}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </section>
          </div>
        }
      >
        <div class="border-b px-3 py-1.5" style={{ "border-color": "var(--app-border)" }}>
          <div class="grid gap-1.5">
            <div class="flex items-center justify-between gap-2 overflow-visible">
              <div
                class="relative z-10 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
                onDragOver={(event) => {
                  event.preventDefault();
                  setTabDropTargetId(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const draggedId = draggedTabId();
                  if (draggedId) {
                    reorderRequestTabs(draggedId, null);
                  }
                  setDraggedTabId(null);
                  setTabDropTargetId(null);
                }}
              >
                <For each={orderedOpenRequestIds()}>
                  {(requestId) => {
                    const request = createMemo(() => requestMap().get(requestId) ?? null);
                    const isPinned = createMemo(() => workspace.pinnedRequestIds.includes(requestId));

                    return (
                      <Show when={request()}>
                        <div
                          class={`group inline-flex max-w-[320px] shrink-0 items-center gap-1 rounded-md border px-2 py-1 transition ${
                            workspace.activeRequestId === requestId
                              ? "border-transparent bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
                              : "theme-control"
                          } ${
                            tabDropTargetId() === requestId && draggedTabId() !== requestId
                              ? "ring-1 ring-[var(--app-accent)]"
                              : ""
                          } ${
                            draggedTabId() === requestId ? "opacity-60" : ""
                          }`}
                          draggable={!isPinned()}
                          onDragStart={(event) => {
                            if (isPinned()) {
                              event.preventDefault();
                              return;
                            }
                            setDraggedTabId(requestId);
                            event.dataTransfer?.setData("text/plain", requestId);
                            if (event.dataTransfer) {
                              event.dataTransfer.effectAllowed = "move";
                            }
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            setTabDropTargetId(requestId);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const draggedId = draggedTabId();
                            if (draggedId) {
                              reorderRequestTabs(draggedId, requestId);
                            }
                            setDraggedTabId(null);
                            setTabDropTargetId(null);
                          }}
                          onDragEnd={() => {
                            setDraggedTabId(null);
                            setTabDropTargetId(null);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setRequestTabMenuState({
                              id: requestId,
                              x: event.clientX,
                              y: event.clientY
                            });
                          }}
                        >
                          <button class="inline-flex items-center gap-1" onClick={() => openRequestTab(requestId, request()!.collectionId)}>
                            <span class={getRequestBadgeClass(request()!)}>{getRequestKindLabel(request()!)}</span>
                            <span class="truncate text-sm font-medium">{request()!.name}</span>
                          </button>

                          <Show when={isPinned()}>
                            <span class="inline-flex h-5 w-5 items-center justify-center text-[var(--app-accent)]">
                              <PinIcon />
                            </span>
                          </Show>

                          <Show when={!isPinned()}>
                            <button
                              class={`inline-flex h-5 w-5 items-center justify-center transition-opacity ${
                                workspace.activeRequestId === requestId
                                  ? "opacity-100"
                                  : "opacity-0 group-hover:opacity-100"
                              }`}
                              onClick={(event) => {
                                event.stopPropagation();
                                closeRequestTab(requestId);
                              }}
                            >
                              <MacCloseIcon />
                            </button>
                          </Show>
                        </div>
                      </Show>
                    );
                  }}
                </For>

                <Show when={requestTabMenuState() && currentTabMenuRequest()}>
                  <div
                    class="theme-panel-soft fixed z-[90] w-max border p-1"
                    data-rest-menu-root
                    style={{
                      "border-color": "var(--app-border)",
                      left: `${requestTabMenuState()!.x}px`,
                      top: `${requestTabMenuState()!.y}px`
                    }}
                  >
                    <button
                      class="theme-sidebar-item w-full rounded-lg px-3 py-2 text-left text-sm"
                      onClick={() => {
                        togglePinnedRequestTab(currentTabMenuRequest()!.id);
                        setRequestTabMenuState(null);
                      }}
                    >
                      {workspace.pinnedRequestIds.includes(currentTabMenuRequest()!.id) ? "UnPin" : "Pin"}
                    </button>
                    <button class="theme-sidebar-item w-full rounded-lg px-3 py-2 text-left text-sm" onClick={() => closeOtherTabs(currentTabMenuRequest()!.id)}>
                      Close Others
                    </button>
                    <button class="theme-sidebar-item w-full rounded-lg px-3 py-2 text-left text-sm" onClick={closeAllTabs}>
                      Close All
                    </button>
                    <button class="theme-sidebar-item w-full rounded-lg px-3 py-2 text-left text-sm" onClick={() => closeTabsToDirection(currentTabMenuRequest()!.id, "right")}>
                      Close Right
                    </button>
                    <button class="theme-sidebar-item w-full rounded-lg px-3 py-2 text-left text-sm" onClick={() => closeTabsToDirection(currentTabMenuRequest()!.id, "left")}>
                      Close Left
                    </button>
                  </div>
                </Show>
              </div>

              <button
                class="theme-control shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition"
                onClick={() => {
                  const collectionId = activeCollection()?.id ?? workspace.collections[0]?.id;
                  if (!collectionId) {
                    return;
                  }
                  const request = createRequestForKind(collectionId, "http");
                  addRequestToWorkspace(collectionId, request, null);
                }}
              >
                + Request
              </button>
            </div>

            <Show when={activeRequest()}>
              {(request) => (
                <div class="flex flex-wrap items-center gap-2">
                  <input
                    class="theme-input h-8 min-w-[180px] rounded-md px-2.5 py-1 text-sm"
                    value={request().name}
                    onInput={(event) => updateActiveRequest((current) => {
                      current.name = event.currentTarget.value;
                    })}
                  />
                  <select
                    class="theme-input h-8 rounded-md px-2.5 py-1 text-sm font-semibold"
                    value={request().method}
                    disabled={!canSendActiveRequest()}
                    onInput={(event) => updateActiveRequest((current) => {
                      current.method = event.currentTarget.value as RequestMethod;
                    })}
                  >
                    <For each={requestMethods}>
                      {(method) => <option value={method}>{method}</option>}
                    </For>
                  </select>
                  <input
                    class="theme-input h-8 min-w-[280px] flex-1 rounded-md px-2.5 py-1 text-sm transition"
                    value={request().url}
                    onInput={(event) => updateActiveRequest((current) => {
                      current.url = event.currentTarget.value;
                    })}
                  />
                  <select
                    class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                    value={workspace.activeEnvironmentId}
                    onInput={(event) => commitWorkspace((next) => {
                      next.activeEnvironmentId = event.currentTarget.value;
                    })}
                  >
                    <For each={workspace.environments}>
                      {(environment) => <option value={environment.id}>{environment.name}</option>}
                    </For>
                  </select>
                  <div class="flex items-center gap-2">
                    <button
                      class={`h-8 rounded-md px-3 py-1 text-sm font-medium transition ${
                        saveState() === "saved"
                          ? "bg-[#34c759] text-white"
                          : saveState() === "error"
                            ? "bg-[#ff3b30] text-white"
                            : "theme-control"
                      }`}
                      disabled={saveState() === "saving"}
                      onClick={() => void manualSaveWorkspace()}
                    >
                      {saveState() === "saving"
                        ? "Saving..."
                        : saveState() === "saved"
                          ? "Saved"
                          : saveState() === "error"
                            ? "Save failed"
                            : "Save"}
                    </button>
                  </div>
                  <button
                    class="theme-button-primary h-8 rounded-md px-4 py-1 text-sm font-semibold transition"
                    disabled={isSending() || !canSendActiveRequest()}
                    onClick={() => void sendActiveRequest()}
                  >
                    {!canSendActiveRequest() ? "Coming Soon" : isSending() ? "Sending..." : "Send"}
                  </button>
                </div>
              )}
            </Show>
          </div>
        </div>

        <div
          class="grid min-h-0 flex-1"
          style={{
            "grid-template-columns": `minmax(0, ${mainPaneSplit()}fr) 10px minmax(360px, ${100 - mainPaneSplit()}fr)`
          }}
        >
          <div class="flex min-h-0 flex-col border-r" style={{ "border-color": "var(--app-border)" }}>
            <div class="shrink-0 border-b px-3 py-2" style={{ "border-color": "var(--app-border)" }}>
              <Show when={!canSendActiveRequest() && activeRequest()}>
                {(request) => (
                  <div class="mb-3 rounded-lg border px-3 py-2.5 text-sm" style={{ "border-color": "var(--app-border)", background: "var(--app-panel-soft)" }}>
                    <span class="theme-text">
                      {request().kind === "websocket" ? "WebSocket" : "Socket.IO"} workspace will be added next.
                    </span>
                  </div>
                )}
              </Show>

              <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-1.5">
                  <EditorToggle active={topEditorTab() === "headers"} label="Headers" onClick={() => setTopEditorTab("headers")} />
                  <EditorToggle active={topEditorTab() === "auth"} label="Auth" onClick={() => setTopEditorTab("auth")} />
                </div>
                <Show when={topEditorTab() === "headers"}>
                  <button
                    class="inline-flex h-6 w-6 items-center justify-center rounded-full transition"
                    title="Add header"
                    onClick={() => updateActiveRequest((current) => {
                      current.headers = [...current.headers, createKeyValueEntry()];
                    })}
                  >
                    <MacAddIcon />
                  </button>
                </Show>
              </div>

              <div class="max-h-[34dvh] overflow-auto">
                <Show when={activeRequest()}>
                  {(request) => (
                    <Switch>
                      <Match when={topEditorTab() === "headers"}>
                        <KeyValueTableEditor
                          rows={request().headers}
                          valuePlaceholder="application/json"
                          onUpdate={(id, key, value) => updateActiveRequest((current) => {
                            current.headers = current.headers.map((entry) =>
                              entry.id === id ? { ...entry, [key]: value } : entry
                            );
                          })}
                          onToggle={(id) => updateActiveRequest((current) => {
                            current.headers = current.headers.map((entry) =>
                              entry.id === id ? { ...entry, enabled: !entry.enabled } : entry
                            );
                          })}
                          onRemove={(id) => updateActiveRequest((current) => {
                            current.headers = current.headers.filter((entry) => entry.id !== id);
                          })}
                          onAdd={() => updateActiveRequest((current) => {
                            current.headers = [...current.headers, createKeyValueEntry()];
                          })}
                        />
                      </Match>

                      <Match when={topEditorTab() === "auth"}>
                        <div class="flex flex-wrap content-start gap-3">
                          <label class="theme-text-muted grid min-w-[220px] flex-1 gap-1.5 text-sm">
                            <span class="theme-text font-medium">Auth Type</span>
                            <select
                              class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                              value={request().auth.type}
                              onInput={(event) => updateActiveRequest((current) => {
                                const nextType = event.currentTarget.value;
                                if (nextType === "bearer") {
                                  current.auth = { type: "bearer", token: "" };
                                } else if (nextType === "basic") {
                                  current.auth = { type: "basic", username: "", password: "" };
                                } else if (nextType === "api-key") {
                                  current.auth = { type: "api-key", key: "x-api-key", value: "", addTo: "header" };
                                } else {
                                  current.auth = { type: "none" };
                                }
                              })}
                            >
                              <option value="none">None</option>
                              <option value="bearer">Bearer Token</option>
                              <option value="basic">Basic Auth</option>
                              <option value="api-key">API Key</option>
                            </select>
                          </label>

                          <Show when={request().auth.type === "none"}>
                            <div class="theme-text-soft flex min-h-[72px] min-w-[220px] flex-1 items-center rounded-md border px-3 text-sm" style={{ "border-color": "var(--app-border)", background: "var(--app-panel-soft)" }}>
                              No authentication will be attached to this request.
                            </div>
                          </Show>

                          <Show when={request().auth.type === "bearer"}>
                            <label class="theme-text-muted grid min-w-[220px] flex-1 gap-1.5 text-sm">
                              <span class="theme-text font-medium">Token</span>
                              <input
                                class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                value={request().auth.type === "bearer" ? request().auth.token : ""}
                                onInput={(event) => updateActiveRequest((current) => {
                                  if (current.auth.type === "bearer") {
                                    current.auth = { ...current.auth, token: event.currentTarget.value };
                                  }
                                })}
                              />
                            </label>
                          </Show>

                          <Show when={request().auth.type === "basic"}>
                            <>
                              <label class="theme-text-muted grid min-w-[220px] flex-1 gap-1.5 text-sm">
                                <span class="theme-text font-medium">Username</span>
                                <input
                                  class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                  value={request().auth.type === "basic" ? request().auth.username : ""}
                                  onInput={(event) => updateActiveRequest((current) => {
                                    if (current.auth.type === "basic") {
                                      current.auth = { ...current.auth, username: event.currentTarget.value };
                                    }
                                  })}
                                />
                              </label>
                              <label class="theme-text-muted grid min-w-[220px] flex-1 gap-1.5 text-sm">
                                <span class="theme-text font-medium">Password</span>
                                <input
                                  class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                  type="password"
                                  value={request().auth.type === "basic" ? request().auth.password : ""}
                                  onInput={(event) => updateActiveRequest((current) => {
                                    if (current.auth.type === "basic") {
                                      current.auth = { ...current.auth, password: event.currentTarget.value };
                                    }
                                  })}
                                />
                              </label>
                            </>
                          </Show>

                          <Show when={request().auth.type === "api-key"}>
                            <>
                              <label class="theme-text-muted grid min-w-[200px] flex-1 gap-1.5 text-sm">
                                <span class="theme-text font-medium">Key</span>
                                <input
                                  class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                  value={request().auth.type === "api-key" ? request().auth.key : ""}
                                  onInput={(event) => updateActiveRequest((current) => {
                                    if (current.auth.type === "api-key") {
                                      current.auth = { ...current.auth, key: event.currentTarget.value };
                                    }
                                  })}
                                />
                              </label>
                              <label class="theme-text-muted grid min-w-[200px] flex-1 gap-1.5 text-sm">
                                <span class="theme-text font-medium">Value</span>
                                <input
                                  class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                  value={request().auth.type === "api-key" ? request().auth.value : ""}
                                  onInput={(event) => updateActiveRequest((current) => {
                                    if (current.auth.type === "api-key") {
                                      current.auth = { ...current.auth, value: event.currentTarget.value };
                                    }
                                  })}
                                />
                              </label>
                              <label class="theme-text-muted grid min-w-[160px] gap-1.5 text-sm">
                                <span class="theme-text font-medium">Add To</span>
                                <select
                                  class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                  value={request().auth.type === "api-key" ? request().auth.addTo : "header"}
                                  onInput={(event) => updateActiveRequest((current) => {
                                    if (current.auth.type === "api-key") {
                                      current.auth = {
                                        ...current.auth,
                                        addTo: event.currentTarget.value as "header" | "query"
                                      };
                                    }
                                  })}
                                >
                                  <option value="header">Header</option>
                                  <option value="query">Query</option>
                                </select>
                              </label>
                            </>
                          </Show>
                        </div>
                      </Match>
                    </Switch>
                  )}
                </Show>
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-auto px-3 py-2">
              <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-1.5">
                  <EditorToggle active={bottomEditorTab() === "body"} label="Body" onClick={() => setBottomEditorTab("body")} />
                  <EditorToggle active={bottomEditorTab() === "params"} label="Params" onClick={() => setBottomEditorTab("params")} />
                </div>
                <Show when={bottomEditorTab() === "params"}>
                  <button
                    class="inline-flex h-6 w-6 items-center justify-center rounded-full transition"
                    title="Add param"
                    onClick={() => updateActiveRequest((current) => {
                      current.query = [...current.query, createKeyValueEntry()];
                    })}
                  >
                    <MacAddIcon />
                  </button>
                </Show>
              </div>

              <div class="min-h-0">
                <Show when={activeRequest()}>
                  {(request) => (
                    <Switch>
                      <Match when={bottomEditorTab() === "params"}>
                        <KeyValueTableEditor
                          rows={request().query}
                          valuePlaceholder="{{variable}}"
                          onUpdate={(id, key, value) => updateActiveRequest((current) => {
                            current.query = current.query.map((entry) =>
                              entry.id === id ? { ...entry, [key]: value } : entry
                            );
                          })}
                          onToggle={(id) => updateActiveRequest((current) => {
                            current.query = current.query.map((entry) =>
                              entry.id === id ? { ...entry, enabled: !entry.enabled } : entry
                            );
                          })}
                          onRemove={(id) => updateActiveRequest((current) => {
                            current.query = current.query.filter((entry) => entry.id !== id);
                          })}
                          onAdd={() => updateActiveRequest((current) => {
                            current.query = [...current.query, createKeyValueEntry()];
                          })}
                        />
                      </Match>

                      <Match when={bottomEditorTab() === "body"}>
                        <div class="flex flex-col items-start gap-3">
                          <div class="flex flex-wrap items-center justify-between gap-3">
                            <div class="flex flex-wrap items-center gap-2">
                              <select
                                class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                value={request().body.type}
                                onInput={(event) => {
                                  const nextType = event.currentTarget.value as RequestBody["type"];
                                  updateActiveRequest((current) => {
                                    switch (nextType) {
                                      case "json":
                                        current.body = { type: "json", value: "{\n  \n}" };
                                        break;
                                      case "raw":
                                        current.body = { type: "raw", value: "", contentType: "text/plain" };
                                        break;
                                      case "form-urlencoded":
                                        current.body = { type: "form-urlencoded", entries: [createKeyValueEntry()] };
                                        break;
                                      default:
                                        current.body = { type: "none" };
                                    }
                                  });
                                }}
                              >
                                <option value="none">None</option>
                                <option value="json">JSON</option>
                                <option value="raw">Raw</option>
                                <option value="form-urlencoded">Form Urlencoded</option>
                              </select>

                              <Show when={request().body.type === "json"}>
                                <button
                                  class="theme-control h-8 rounded-md px-3 py-1 text-sm font-medium"
                                  onClick={() => updateActiveRequest((current) => {
                                    if (current.body.type === "json") {
                                      current.body = {
                                        ...current.body,
                                        value: tryFormatJson(current.body.value)
                                      };
                                    }
                                  })}
                                >
                                  Format JSON
                                </button>
                              </Show>
                            </div>
                            <Show when={request().body.type === "form-urlencoded"}>
                              <button
                                class="inline-flex h-6 w-6 items-center justify-center rounded-full transition"
                                title="Add body row"
                                onClick={() => updateActiveRequest((current) => {
                                  if (current.body.type === "form-urlencoded") {
                                    current.body = {
                                      ...current.body,
                                      entries: [...current.body.entries, createKeyValueEntry()]
                                    };
                                  }
                                })}
                              >
                                <MacAddIcon />
                              </button>
                            </Show>
                          </div>

                          <Show when={request().body.type === "raw"}>
                            <label class="theme-text-muted grid w-full max-w-[260px] gap-1.5 text-sm">
                              <span class="theme-text font-medium">Content-Type</span>
                              <input
                                class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                value={request().body.type === "raw" ? request().body.contentType : ""}
                                onInput={(event) => updateActiveRequest((current) => {
                                  if (current.body.type === "raw") {
                                    current.body = {
                                      ...current.body,
                                      contentType: event.currentTarget.value
                                    };
                                  }
                                })}
                              />
                            </label>
                          </Show>

                          <Show when={request().body.type === "json" || request().body.type === "raw"}>
                            <textarea
                              class="theme-input min-h-[220px] w-full rounded-lg px-2.5 py-2 font-mono text-sm leading-6 transition"
                              value={request().body.type === "json" || request().body.type === "raw" ? request().body.value : ""}
                              onInput={(event) => updateActiveRequest((current) => {
                                if (current.body.type === "json" || current.body.type === "raw") {
                                  current.body = { ...current.body, value: event.currentTarget.value };
                                }
                              })}
                            />
                          </Show>

                          <Show when={request().body.type === "form-urlencoded"}>
                            <KeyValueTableEditor
                              rows={request().body.type === "form-urlencoded" ? request().body.entries : []}
                              onUpdate={(id, key, value) => updateActiveRequest((current) => {
                                if (current.body.type === "form-urlencoded") {
                                  current.body = {
                                    ...current.body,
                                    entries: current.body.entries.map((entry) =>
                                      entry.id === id ? { ...entry, [key]: value } : entry
                                    )
                                  };
                                }
                              })}
                              onToggle={(id) => updateActiveRequest((current) => {
                                if (current.body.type === "form-urlencoded") {
                                  current.body = {
                                    ...current.body,
                                    entries: current.body.entries.map((entry) =>
                                      entry.id === id ? { ...entry, enabled: !entry.enabled } : entry
                                    )
                                  };
                                }
                              })}
                              onRemove={(id) => updateActiveRequest((current) => {
                                if (current.body.type === "form-urlencoded") {
                                  current.body = {
                                    ...current.body,
                                    entries: current.body.entries.filter((entry) => entry.id !== id)
                                  };
                                }
                              })}
                            />
                          </Show>
                        </div>
                      </Match>
                    </Switch>
                  )}
                </Show>
              </div>
            </div>
          </div>

          <div
            class="relative cursor-col-resize select-none"
            aria-hidden="true"
            onMouseDown={startMainPaneResize}
          >
            <div
              class={`absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 transition ${
                mainPaneResizing() ? "bg-[var(--app-accent)]" : ""
              }`}
              style={{
                background: mainPaneResizing()
                  ? "var(--app-accent)"
                  : "color-mix(in srgb, var(--app-accent) 28%, var(--app-border))"
              }}
            />
          </div>

          <div
            class="flex min-h-0 flex-col px-3 py-2"
            style={{ "min-height": "calc(100dvh - 128px)" }}
          >
            <Show when={responseError()}>
              <div class="mb-3 border px-4 py-3 text-sm theme-warn" style={{ "border-color": "var(--app-border)" }}>
                {responseError()}
              </div>
            </Show>

            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-1.5">
                <EditorToggle active={responseTab() === "body"} label="Body" onClick={() => setResponseTab("body")} />
                <EditorToggle active={responseTab() === "headers"} label="Headers" onClick={() => setResponseTab("headers")} />
              </div>
              <Show when={responseSummary()}>
                {(summary) => (
                  <div class="theme-text-soft flex flex-wrap items-center gap-2 text-sm">
                    <span class={`font-semibold ${getResponseStatusClass(summary().status)}`}>
                      {summary().status} {summary().statusText}
                    </span>
                    <span>|</span>
                    <span>{summary().timeMs} ms</span>
                    <span>|</span>
                    <span>{formatBytes(summary().sizeBytes)}</span>
                  </div>
                )}
              </Show>
            </div>

            <div class="min-h-0 flex-1">
            <Switch>
              <Match when={responseTab() === "body"}>
                <div class="theme-code flex h-full min-h-[240px] flex-col border" style={{ "border-color": "var(--app-border)" }}>
                  <pre class="theme-text-muted h-full flex-1 overflow-x-auto px-3 py-3 font-mono text-sm leading-7">
                    <code>{responseSummary()?.body ?? "Send a request to inspect the response body."}</code>
                  </pre>
                </div>
              </Match>
              <Match when={responseTab() === "headers"}>
                <div class="min-h-[240px]">
                  <KeyValueTableEditor rows={responseSummary()?.headers ?? []} readOnly />
                </div>
              </Match>
            </Switch>
            </div>
          </div>
        </div>
      </WorkspaceSidebarLayout>

      <Show when={curlImportCollectionId()}>
        <div class="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(15,23,42,0.28)] px-4">
          <div class="theme-panel-strong z-50 w-full max-w-2xl rounded-2xl border p-5" style={{ "border-color": "var(--app-border)" }}>
            <div class="mb-4 flex items-start justify-between gap-4">
              <div class="space-y-1">
                <p class="theme-eyebrow text-[10px] font-semibold uppercase tracking-[0.18em]">Import</p>
                <h3 class="theme-text text-lg font-semibold">Parse cURL Into Request</h3>
                <p class="theme-text-soft text-sm">Paste a cURL command and generate a new request in the selected collection.</p>
              </div>
              <button
                class="theme-control inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm"
                onClick={() => {
                  setCurlImportCollectionId(null);
                  setCurlImportFolderId(null);
                  setCurlError(null);
                }}
              >
                ×
              </button>
            </div>

            <div class="space-y-3">
              <textarea
                class="theme-input min-h-[220px] w-full rounded-xl px-4 py-3 font-mono text-sm leading-6"
                value={curlInput()}
                onInput={(event) => setCurlInput(event.currentTarget.value)}
              />

              <Show when={curlError()}>
                <div class="rounded-xl border border-[rgba(255,59,48,0.18)] bg-[rgba(255,59,48,0.08)] px-3 py-2 text-sm text-[#ff3b30]">
                  {curlError()}
                </div>
              </Show>

              <div class="flex items-center justify-end gap-2">
                <button
                  class="theme-control rounded-lg px-3 py-2 text-sm font-medium"
                  onClick={() => {
                    setCurlImportCollectionId(null);
                    setCurlImportFolderId(null);
                    setCurlError(null);
                  }}
                >
                  Cancel
                </button>
                <button class="theme-button-primary rounded-lg px-4 py-2 text-sm font-semibold" onClick={commitCurlImport}>
                  Parse & Create
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}
