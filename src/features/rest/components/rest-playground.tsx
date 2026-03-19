import type { JSX } from "solid-js";
import {
  For,
  Index,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { AppButton } from "../../../components/app-button";
import { TabsBar } from "../../../components/tabs-bar";
import {
  ControlDot,
  EditorToggle,
  FormatJsonIcon,
  PinIcon,
} from "../../../components/ui-primitives";
import { WorkspaceSidebarLayout } from "../../../components/workspace-sidebar-layout";
import { arrayMove, makeId, reorderByDirection } from "../../../lib/utils";
import {
  isHtmlContentType,
  isJsonContentType,
  JsonHighlightedCode,
  JsonPreviewNode,
} from "./rest-json-view";
import { FormDataTableEditor, KeyValueTableEditor } from "./rest-table-editors";
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
  RestWorkspaceState,
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
  saveRestWorkspace,
} from "../service";

type SidebarPanelId = "collections" | "environments" | "history";
type EditorTabId = "params" | "headers" | "body" | "auth";
type ResponseTabId = "body" | "headers";
type SaveState = "idle" | "saving" | "saved" | "error";
type BottomEditorTabId = "body" | "script";

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
  { id: "auth", label: "Auth" },
];

const sidebarTabs: Array<{ id: SidebarPanelId; label: string }> = [
  { id: "collections", label: "Collections" },
  { id: "environments", label: "ENV" },
  { id: "history", label: "HIS" },
];

const preRequestScriptHeightStorageKey = "devx-script-height-pre-request";
const postResponseScriptHeightStorageKey = "devx-script-height-post-response";

const preRequestScriptExample = `// Runs before sending the request.
// You can prepare headers, query params, or request metadata here.

const traceId = crypto.randomUUID();
request.setHeader("X-Trace-Id", traceId);
request.setHeader("X-Sent-At", new Date().toISOString());
request.setQuery("debug", "true");

// You can also read environment variables.
const baseUrl = env.get("baseUrl");
console.log("Sending request to:", baseUrl);`;

const postResponseScriptExample = `// Runs after the response is received.
// Use it to extract values and save them back into the active environment.

const data = response.json();

if (data?.token) {
  env.set("accessToken", data.token);
}

env.set("lastStatus", String(response.status));
env.set("lastRequestAt", new Date().toISOString());

console.log("Stored response data into the active environment.");`;

const requestCreateOptions: Array<{ id: RequestKind; label: string }> = [
  { id: "http", label: "HTTP Request" },
  { id: "curl", label: "cURL" },
  { id: "websocket", label: "WebSocket" },
  { id: "graphql", label: "GraphQL" },
  { id: "socketio", label: "Socket.IO" },
];

const commonHeaderKeys = [
  "Accept",
  "Accept-Encoding",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Connection",
  "Content-Type",
  "Cookie",
  "If-Modified-Since",
  "If-None-Match",
  "Origin",
  "Pragma",
  "Referer",
  "User-Agent",
  "X-API-Key",
  "X-Requested-With",
];

const commonHeaderValueMap: Record<string, string[]> = {
  accept: [
    "application/json",
    "application/json; charset=utf-8",
    "text/plain",
    "text/html",
    "*/*",
  ],
  "accept-encoding": ["gzip, deflate, br", "gzip, deflate", "identity"],
  "accept-language": ["en-US,en;q=0.9", "zh-CN,zh;q=0.9", "en;q=0.8"],
  authorization: ["Bearer ", "Basic "],
  "cache-control": ["no-cache", "no-store", "max-age=0"],
  connection: ["keep-alive", "close"],
  "content-type": [
    "application/json",
    "application/json; charset=utf-8",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
    "text/plain",
    "application/octet-stream",
  ],
  pragma: ["no-cache"],
  "x-requested-with": ["XMLHttpRequest"],
  "x-api-key": ["{{apiKey}}"],
};

const requestMethods: RequestMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
];

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
  folderId: string | null = null,
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
          createKeyValueEntry({
            key: "Content-Type",
            value: "application/json",
          }),
        ],
        body: {
          type: "json",
          value: JSON.stringify(
            {
              query: "query Example {\n  __typename\n}",
            },
            null,
            2,
          ),
        },
      });
    case "websocket":
      return createRequestDraft(collectionId, {
        folderId,
        kind: "websocket",
        name: "WebSocket Request",
        url: "wss://example.com/socket",
        headers: [],
        body: { type: "none" },
      });
    case "socketio":
      return createRequestDraft(collectionId, {
        folderId,
        kind: "socketio",
        name: "Socket.IO Request",
        url: "https://example.com/socket.io/?EIO=4&transport=websocket",
        headers: [],
        body: { type: "none" },
      });
    case "curl":
      return createRequestDraft(collectionId, {
        folderId,
        kind: "curl",
        name: "Imported cURL",
        url: "{{baseUrl}}/users",
      });
    case "http":
    default:
      return createRequestDraft(collectionId, {
        folderId,
        name: "New Request",
        url: "{{baseUrl}}/posts",
      });
  }
}

function decodeShellToken(token: string) {
  return token.replace(/\\ /g, " ");
}

function decodeAnsiCString(input: string) {
  let output = "";

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char !== "\\") {
      output += char;
      continue;
    }

    const next = input[index + 1] ?? "";
    switch (next) {
      case "n":
        output += "\n";
        index += 1;
        break;
      case "r":
        output += "\r";
        index += 1;
        break;
      case "t":
        output += "\t";
        index += 1;
        break;
      case "b":
        output += "\b";
        index += 1;
        break;
      case "f":
        output += "\f";
        index += 1;
        break;
      case "v":
        output += "\v";
        index += 1;
        break;
      case "\\":
      case "'":
      case '"':
        output += next;
        index += 1;
        break;
      case "u": {
        const hex = input.slice(index + 2, index + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          output += String.fromCharCode(Number.parseInt(hex, 16));
          index += 5;
        } else {
          output += "u";
          index += 1;
        }
        break;
      }
      case "x": {
        const hex = input.slice(index + 2, index + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          output += String.fromCharCode(Number.parseInt(hex, 16));
          index += 3;
        } else {
          output += "x";
          index += 1;
        }
        break;
      }
      default:
        output += next || "\\";
        if (next) {
          index += 1;
        }
        break;
    }
  }

  return output;
}

function splitShellArgs(input: string) {
  const normalizedInput = input.trim().replace(/\\\r?\n/g, " ");
  const tokens: string[] = [];
  let buffer = "";
  let mode: "normal" | "single" | "double" | "ansi" = "normal";

  const pushBuffer = () => {
    if (!buffer) {
      return;
    }
    tokens.push(buffer);
    buffer = "";
  };

  for (let index = 0; index < normalizedInput.length; index += 1) {
    const char = normalizedInput[index];
    const next = normalizedInput[index + 1] ?? "";

    if (mode === "single") {
      if (char === "'") {
        mode = "normal";
      } else {
        buffer += char;
      }
      continue;
    }

    if (mode === "double") {
      if (char === '"') {
        mode = "normal";
        continue;
      }

      if (char === "\\") {
        if (next === '"' || next === "\\" || next === "$" || next === "`") {
          buffer += next;
          index += 1;
        } else if (next === "\n" || next === "\r") {
          // Ignore escaped newlines inside copied multi-line commands.
        } else {
          buffer += next || "\\";
          if (next) {
            index += 1;
          }
        }
        continue;
      }

      buffer += char;
      continue;
    }

    if (mode === "ansi") {
      if (char === "'") {
        mode = "normal";
      } else if (char === "\\") {
        const escapeStart = index;
        index += 1;
        while (index < normalizedInput.length) {
          const escapeProbe = normalizedInput[index];
          if (escapeProbe === "u") {
            const escaped = normalizedInput.slice(escapeStart, index + 5);
            buffer += decodeAnsiCString(escaped);
            index += 4;
            break;
          }
          if (escapeProbe === "x") {
            const escaped = normalizedInput.slice(escapeStart, index + 3);
            buffer += decodeAnsiCString(escaped);
            index += 2;
            break;
          }

          const escaped = normalizedInput.slice(escapeStart, index + 1);
          buffer += decodeAnsiCString(escaped);
          break;
        }
      } else {
        buffer += char;
      }
      continue;
    }

    if (/\s/.test(char)) {
      pushBuffer();
      continue;
    }

    if (char === "$" && next === "'") {
      mode = "ansi";
      index += 1;
      continue;
    }

    if (char === "'") {
      mode = "single";
      continue;
    }

    if (char === '"') {
      mode = "double";
      continue;
    }

    if (char === "\\") {
      if (next === "\n" || next === "\r") {
        continue;
      }
      buffer += next || "\\";
      if (next) {
        index += 1;
      }
      continue;
    }

    buffer += char;
  }

  pushBuffer();
  return tokens.map(decodeShellToken);
}

function buildCurlCommand(request: RequestDraft, environment?: Environment) {
  const url = new URL(resolveTemplate(request.url, environment));

  request.query
    .filter((entry) => entry.enabled && entry.key.trim())
    .forEach((entry) => {
      url.searchParams.append(
        resolveTemplate(entry.key, environment),
        resolveTemplate(entry.value, environment),
      );
    });

  const parts = ["curl", "-X", request.method, `'${url.toString()}'`];

  request.headers
    .filter((entry) => entry.enabled && entry.key.trim())
    .forEach((entry) => {
      parts.push(
        "-H",
        `'${resolveTemplate(entry.key, environment)}: ${resolveTemplate(entry.value, environment)}'`,
      );
    });

  switch (request.auth.type) {
    case "bearer":
      parts.push(
        "-H",
        `'Authorization: Bearer ${resolveTemplate(request.auth.token, environment)}'`,
      );
      break;
    case "basic":
      parts.push(
        "-u",
        `'${resolveTemplate(request.auth.username, environment)}:${resolveTemplate(request.auth.password, environment)}'`,
      );
      break;
    case "api-key":
      if (request.auth.addTo === "header" && request.auth.key.trim()) {
        parts.push(
          "-H",
          `'${resolveTemplate(request.auth.key, environment)}: ${resolveTemplate(
            request.auth.value,
            environment,
          )}'`,
        );
      }
      break;
    default:
      break;
  }

  switch (request.body.type) {
    case "json":
      parts.push("-H", "'Content-Type: application/json'");
      parts.push(
        "--data-raw",
        `'${resolveTemplate(request.body.value, environment)}'`,
      );
      break;
    case "form-data":
      request.body.entries
        .filter((entry) => entry.enabled && entry.key.trim())
        .forEach((entry) => {
          parts.push(
            "-F",
            entry.valueType === "file"
              ? `'${resolveTemplate(entry.key, environment)}=@${entry.fileName || "upload.bin"}'`
              : `'${resolveTemplate(entry.key, environment)}=${resolveTemplate(entry.value, environment)}'`,
          );
        });
      break;
    case "raw":
      parts.push(
        "-H",
        `'Content-Type: ${resolveTemplate(request.body.contentType, environment) || "text/plain"}'`,
      );
      parts.push(
        "--data-raw",
        `'${resolveTemplate(request.body.value, environment)}'`,
      );
      break;
    case "form-urlencoded":
      request.body.entries
        .filter((entry) => entry.enabled && entry.key.trim())
        .forEach((entry) => {
          parts.push(
            "--data-urlencode",
            `'${resolveTemplate(entry.key, environment)}=${resolveTemplate(entry.value, environment)}'`,
          );
        });
      break;
    case "binary":
      parts.push("-H", "'Content-Type: application/octet-stream'");
      parts.push(
        "--data-binary",
        `'${resolveTemplate(request.body.value, environment)}'`,
      );
      break;
    default:
      break;
  }

  return parts.join(" ");
}

function parseCurlCommand(
  collectionId: string,
  input: string,
  folderId: string | null = null,
) {
  const tokens = splitShellArgs(input);

  if (tokens.length === 0 || !/(^|[\\/])curl(?:\.exe)?$/i.test(tokens[0])) {
    throw new Error("Please paste a valid cURL command.");
  }

  let method: RequestMethod = "GET";
  let url = "";
  let rawBody = "";
  let contentType = "";
  let basicUsername = "";
  let basicPassword = "";
  let useGetForData = false;
  const queryEntries: KeyValueEntry[] = [];
  const headers: KeyValueEntry[] = [];
  const formDataEntries: KeyValueEntry[] = [];
  const urlEncodedEntries: KeyValueEntry[] = [];

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    switch (token) {
      case "-X":
      case "--request": {
        const next = tokens[index + 1]?.toUpperCase() as
          | RequestMethod
          | undefined;
        if (next && requestMethods.includes(next)) {
          method = next;
          index += 1;
        }
        break;
      }
      case "--url": {
        const next = tokens[index + 1];
        if (next) {
          url = next;
          index += 1;
        }
        break;
      }
      case "-G":
      case "--get":
        useGetForData = true;
        method = "GET";
        break;
      case "-L":
      case "--location":
      case "--location-trusted":
      case "--compressed":
      case "--globoff":
      case "-s":
      case "--silent":
      case "--insecure":
      case "-k":
      case "--verbose":
      case "-v":
      case "-i":
      case "--include":
        break;
      case "-H":
      case "--header": {
        const value = tokens[index + 1];
        if (value) {
          const separatorIndex = value.indexOf(":");
          if (separatorIndex >= 0) {
            headers.push(
              createKeyValueEntry({
                key: value.slice(0, separatorIndex).trim(),
                value: value.slice(separatorIndex + 1).trim(),
              }),
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
              value: value.slice(separatorIndex + 1),
            }),
          );
        }
        if (method === "GET") {
          method = "POST";
        }
        index += 1;
        break;
      }
      case "-F":
      case "--form": {
        const value = tokens[index + 1] ?? "";
        const separatorIndex = value.indexOf("=");
        if (separatorIndex >= 0) {
          const nextKey = value.slice(0, separatorIndex);
          const nextValue = value.slice(separatorIndex + 1);
          const isFile = nextValue.startsWith("@");
          formDataEntries.push(
            createKeyValueEntry({
              key: nextKey,
              value: isFile ? nextValue.slice(1) : nextValue,
              valueType: isFile ? "file" : "text",
              fileName: isFile ? nextValue.slice(1).split(/[;>]/, 1)[0] : "",
              fileContent: "",
              fileContentType: "",
            }),
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
        basicUsername =
          separatorIndex >= 0 ? value.slice(0, separatorIndex) : value;
        basicPassword =
          separatorIndex >= 0 ? value.slice(separatorIndex + 1) : "";
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

  const contentTypeHeader = headers.find(
    (header) => header.key.toLowerCase() === "content-type",
  );
  contentType = contentTypeHeader?.value ?? "";

  if (useGetForData && urlEncodedEntries.length > 0) {
    urlEncodedEntries.forEach((entry) => {
      queryEntries.push(
        createKeyValueEntry({
          key: entry.key,
          value: entry.value,
        }),
      );
    });
  }

  let body: RequestBody = { type: "none" };
  if (formDataEntries.length > 0) {
    body = {
      type: "form-data",
      entries: formDataEntries,
    };
  } else if (urlEncodedEntries.length > 0 && !useGetForData) {
    body = {
      type: "form-urlencoded",
      entries: urlEncodedEntries,
    };
  } else if (rawBody) {
    body = contentType.includes("application/json")
      ? {
          type: "json",
          value: rawBody,
        }
      : contentType.includes("application/octet-stream")
        ? {
            type: "binary",
            value: rawBody,
          }
        : {
            type: "raw",
            value: rawBody,
            contentType: contentType || "text/plain",
          };
  }

  let auth: RequestDraft["auth"] = { type: "none" };
  const authHeaderIndex = headers.findIndex(
    (header) => header.key.toLowerCase() === "authorization",
  );

  if (basicUsername || basicPassword) {
    auth = { type: "basic", username: basicUsername, password: basicPassword };
  } else if (authHeaderIndex >= 0) {
    const authValue = headers[authHeaderIndex].value.trim();
    const bearerMatch = authValue.match(/^Bearer\s+(.+)$/i);
    const basicMatch = authValue.match(/^Basic\s+(.+)$/i);

    if (bearerMatch) {
      auth = { type: "bearer", token: bearerMatch[1] };
      headers.splice(authHeaderIndex, 1);
    } else if (basicMatch) {
      try {
        const decoded = atob(basicMatch[1]);
        const separatorIndex = decoded.indexOf(":");
        auth = {
          type: "basic",
          username:
            separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded,
          password:
            separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "",
        };
        headers.splice(authHeaderIndex, 1);
      } catch {
        auth = { type: "none" };
      }
    }
  }

  return createRequestDraft(collectionId, {
    folderId,
    kind: "http",
    method,
    name: "Imported Request",
    url,
    query: queryEntries,
    headers,
    body,
    auth,
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
    type: "application/json",
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

export function RestPlayground(props: RestPlaygroundProps) {
  const [workspace, setWorkspace] = createStore<RestWorkspaceState>(
    createDefaultRestWorkspace(),
  );
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [sidebarPanel, setSidebarPanel] =
    createSignal<SidebarPanelId>("collections");
  const [editorTab, setEditorTab] = createSignal<EditorTabId>("params");
  const [topEditorTab, setTopEditorTab] = createSignal<"headers" | "auth">(
    "headers",
  );
  const [bottomEditorTab, setBottomEditorTab] =
    createSignal<BottomEditorTabId>("body");
  const [responseTab, setResponseTab] = createSignal<ResponseTabId>("body");
  const [responseBodyView, setResponseBodyView] = createSignal<
    "raw" | "preview"
  >("raw");
  const [mainPaneSplit, setMainPaneSplit] = createSignal(40);
  const [mainPaneResizing, setMainPaneResizing] = createSignal(false);
  const [preRequestScriptHeight, setPreRequestScriptHeight] = createSignal(280);
  const [postResponseScriptHeight, setPostResponseScriptHeight] =
    createSignal(280);
  const [expandedCollectionIds, setExpandedCollectionIds] = createSignal<
    string[]
  >([]);
  const [expandedFolderIds, setExpandedFolderIds] = createSignal<string[]>([]);
  const [collectionFilter, setCollectionFilter] = createSignal("");
  const [responseSummary, setResponseSummary] =
    createSignal<ResponseSummary | null>(null);
  const [responseError, setResponseError] = createSignal<string | null>(null);
  const [isSending, setIsSending] = createSignal(false);
  const [saveState, setSaveState] = createSignal<SaveState>("idle");

  const [showCollectionCreateMenu, setShowCollectionCreateMenu] =
    createSignal(false);
  const [collectionMenuId, setCollectionMenuId] = createSignal<string | null>(
    null,
  );
  const [collectionOrderMenuId, setCollectionOrderMenuId] = createSignal<
    string | null
  >(null);
  const [collectionAddMenuId, setCollectionAddMenuId] = createSignal<
    string | null
  >(null);

  const [folderMenuId, setFolderMenuId] = createSignal<string | null>(null);
  const [folderOrderMenuId, setFolderOrderMenuId] = createSignal<string | null>(
    null,
  );
  const [folderMoveMenuId, setFolderMoveMenuId] = createSignal<string | null>(
    null,
  );
  const [folderAddMenuId, setFolderAddMenuId] = createSignal<string | null>(
    null,
  );

  const [requestMenuId, setRequestMenuId] = createSignal<string | null>(null);
  const [requestOrderMenuId, setRequestOrderMenuId] = createSignal<
    string | null
  >(null);
  const [requestMoveMenuId, setRequestMoveMenuId] = createSignal<string | null>(
    null,
  );

  const [requestTabMenuState, setRequestTabMenuState] =
    createSignal<RequestTabMenuState | null>(null);
  const [draggedTabId, setDraggedTabId] = createSignal<string | null>(null);
  const [tabDropTargetId, setTabDropTargetId] = createSignal<string | null>(
    null,
  );

  const [curlImportCollectionId, setCurlImportCollectionId] = createSignal<
    string | null
  >(null);
  const [curlImportFolderId, setCurlImportFolderId] = createSignal<
    string | null
  >(null);
  const [curlInput, setCurlInput] = createSignal("");
  const [curlError, setCurlError] = createSignal<string | null>(null);

  let importCollectionInputRef: HTMLInputElement | undefined;
  let persistTimer: number | undefined;
  let saveFeedbackTimer: number | undefined;

  const mainPaneSplitStorageKey = "devx-api-main-pane-split";
  const preRequestScriptHeightStorageKey = "devx-script-height-pre-request";
  const postResponseScriptHeightStorageKey = "devx-script-height-post-response";

  const requestMap = createMemo(
    () => new Map(workspace.requests.map((request) => [request.id, request])),
  );
  const activeRequest = createMemo(
    () => requestMap().get(workspace.activeRequestId) ?? null,
  );
  const activeCollection = createMemo(
    () =>
      workspace.collections.find(
        (collection) => collection.id === workspace.activeCollectionId,
      ) ??
      workspace.collections[0] ??
      null,
  );
  const activeEnvironment = createMemo(
    () =>
      workspace.environments.find(
        (environment) => environment.id === workspace.activeEnvironmentId,
      ) ??
      workspace.environments[0] ??
      null,
  );

  const orderedOpenRequestIds = createMemo(() => {
    const validRequestIds = new Set(
      workspace.requests.map((request) => request.id),
    );
    const openRequestIds = workspace.openRequestIds.filter((id) =>
      validRequestIds.has(id),
    );
    const pinnedRequestIds = new Set(
      workspace.pinnedRequestIds.filter((id) => validRequestIds.has(id)),
    );

    return [
      ...openRequestIds.filter((id) => pinnedRequestIds.has(id)),
      ...openRequestIds.filter((id) => !pinnedRequestIds.has(id)),
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
            .filter((request): request is RequestDraft => Boolean(request)),
        }));
        const folderIds = new Set(
          collection.folders.map((folder) => folder.id),
        );
        const rootRequests = collection.requestIds
          .map((requestId) => requestMap().get(requestId))
          .filter((request): request is RequestDraft => {
            if (!request) {
              return false;
            }
            return !request.folderId || !folderIds.has(request.folderId);
          });

        if (!filter) {
          return { collection, folders, rootRequests };
        }

        const collectionMatches = collection.name
          .toLowerCase()
          .includes(filter);
        if (collectionMatches) {
          return { collection, folders, rootRequests };
        }

        const matchingFolders = folders
          .map((entry) => {
            const folderMatches = entry.folder.name
              .toLowerCase()
              .includes(filter);
            const requests = folderMatches
              ? entry.requests
              : entry.requests.filter((request) =>
                  request.name.toLowerCase().includes(filter),
                );

            if (!folderMatches && requests.length === 0) {
              return null;
            }

            return {
              folder: entry.folder,
              requests,
            };
          })
          .filter(
            (
              entry,
            ): entry is {
              folder: CollectionFolder;
              requests: RequestDraft[];
            } => Boolean(entry),
          );

        const matchingRootRequests = rootRequests.filter((request) =>
          request.name.toLowerCase().includes(filter),
        );

        if (matchingFolders.length === 0 && matchingRootRequests.length === 0) {
          return null;
        }

        return {
          collection,
          folders: matchingFolders,
          rootRequests: matchingRootRequests,
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          collection: Collection;
          folders: Array<{
            folder: CollectionFolder;
            requests: RequestDraft[];
          }>;
          rootRequests: RequestDraft[];
        } => Boolean(entry),
      );
  });

  const currentTabMenuRequest = createMemo(() =>
    requestTabMenuState()
      ? (requestMap().get(requestTabMenuState()!.id) ?? null)
      : null,
  );
  const requestTabItems = createMemo(() =>
    orderedOpenRequestIds()
      .map((requestId) => {
        const request = requestMap().get(requestId);
        if (!request) {
          return null;
        }

        return {
          id: requestId,
          name: request.name,
          badgeLabel: getRequestKindLabel(request),
          badgeClass: getRequestBadgeClass(request),
          active: workspace.activeRequestId === requestId,
          pinned: workspace.pinnedRequestIds.includes(requestId),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
  );

  const canSendActiveRequest = createMemo(() => {
    const request = activeRequest();
    return Boolean(
      request && request.kind !== "websocket" && request.kind !== "socketio",
    );
  });

  const activeRequestResolvedUrl = createMemo(() => {
    const request = activeRequest();
    if (!request) {
      return "";
    }

    return resolveTemplate(request.url, activeEnvironment() ?? undefined);
  });

  const responsePreviewKind = createMemo<"json" | "html" | null>(() => {
    const summary = responseSummary();
    if (!summary) {
      return null;
    }
    if (isJsonContentType(summary.contentType)) {
      return "json";
    }
    if (isHtmlContentType(summary.contentType)) {
      return "html";
    }
    return null;
  });

  const responsePreviewJson = createMemo<unknown | null>(() => {
    const summary = responseSummary();
    if (!summary || responsePreviewKind() !== "json") {
      return null;
    }

    try {
      return JSON.parse(summary.body);
    } catch {
      return null;
    }
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

  function clampScriptEditorHeight(value: number) {
    return Math.min(960, Math.max(280, Math.round(value)));
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

  function commitWorkspace(
    mutator: (next: RestWorkspaceState) => void,
    options?: { persist?: boolean },
  ) {
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
      current.includes(collectionId) ? current : [...current, collectionId],
    );
  }

  function ensureFolderExpanded(folderId: string | null | undefined) {
    if (!folderId) {
      return;
    }

    setExpandedFolderIds((current) =>
      current.includes(folderId) ? current : [...current, folderId],
    );
  }

  function toggleCollectionExpanded(collectionId: string) {
    setExpandedCollectionIds((current) =>
      current.includes(collectionId)
        ? current.filter((id) => id !== collectionId)
        : [...current, collectionId],
    );
  }

  function toggleFolderExpanded(folderId: string) {
    setExpandedFolderIds((current) =>
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId],
    );
  }

  function isFolderExpanded(folderId: string) {
    return (
      expandedFolderIds().includes(folderId) ||
      collectionFilter().trim().length > 0
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
    ensureFolderExpanded(request.folderId);
    setResponseSummary(null);
    setResponseError(null);
  }

  function selectCollection(collectionId: string) {
    commitWorkspace((next) => {
      next.activeCollectionId = collectionId;
      const collection = next.collections.find(
        (item) => item.id === collectionId,
      );
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

  function addRequestToWorkspace(
    collectionId: string,
    request: RequestDraft,
    folderId: string | null,
  ) {
    commitWorkspace((next) => {
      const collection = next.collections.find(
        (item) => item.id === collectionId,
      );
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
    ensureFolderExpanded(folderId);
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
      next.openRequestIds = next.openRequestIds.filter(
        (id) => id !== requestId,
      );
      next.pinnedRequestIds = next.pinnedRequestIds.filter(
        (id) => id !== requestId,
      );

      if (next.activeRequestId === requestId) {
        const fallbackId =
          currentOpenIds[currentIndex + 1] ??
          currentOpenIds[currentIndex - 1] ??
          "";
        next.activeRequestId = fallbackId;
        const fallbackRequest = next.requests.find(
          (request) => request.id === fallbackId,
        );
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
        next.pinnedRequestIds = next.pinnedRequestIds.filter(
          (id) => id !== requestId,
        );
      } else {
        next.pinnedRequestIds = [
          requestId,
          ...next.pinnedRequestIds.filter((id) => id !== requestId),
        ];
        if (!next.openRequestIds.includes(requestId)) {
          next.openRequestIds.push(requestId);
        }
      }
    });
  }

  function closeOtherTabs(requestId: string) {
    commitWorkspace((next) => {
      const pinned = new Set(next.pinnedRequestIds);
      next.openRequestIds = next.openRequestIds.filter(
        (id) => id === requestId || pinned.has(id),
      );
      next.activeRequestId = requestId;
    });
    setRequestTabMenuState(null);
  }

  function closeAllTabs() {
    commitWorkspace((next) => {
      const pinned = next.pinnedRequestIds.filter((id) =>
        next.requests.some((request) => request.id === id),
      );
      next.openRequestIds = pinned;
      if (next.openRequestIds.length > 0) {
        next.activeRequestId = next.openRequestIds[0];
        const active = next.requests.find(
          (request) => request.id === next.activeRequestId,
        );
        if (active) {
          next.activeCollectionId = active.collectionId;
        }
      } else {
        next.activeRequestId = "";
      }
    });

    setRequestTabMenuState(null);
  }

  function closeTabsToDirection(
    requestId: string,
    direction: "left" | "right",
  ) {
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
        return direction === "left"
          ? index > currentIndex
          : index < currentIndex;
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
      url: "{{baseUrl}}/posts",
    });

    commitWorkspace((next) => {
      next.collections.push({
        id: collectionId,
        name,
        folders: [],
        requestIds: [request.id],
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
    commitWorkspace((next) => {
      const environmentId = makeId("env");
      const baseName = "New Environment";
      const existingNames = new Set(
        next.environments.map((environment) => environment.name),
      );
      let name = baseName;
      let suffix = 2;

      while (existingNames.has(name)) {
        name = `${baseName} ${suffix}`;
        suffix += 1;
      }

      next.environments.push({
        id: environmentId,
        name,
        variables: [
          createKeyValueEntry({
            key: "baseUrl",
            value: "https://jsonplaceholder.typicode.com",
          }),
        ],
      });
      next.activeEnvironmentId = environmentId;
    });
  }

  function duplicateEnvironment(environmentId: string) {
    const environment = workspace.environments.find(
      (item) => item.id === environmentId,
    );
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
            enabled: entry.enabled,
          }),
        ),
      };
      next.environments.push(duplicate);
      next.activeEnvironmentId = duplicateId;
    });
  }

  function deleteEnvironment(environmentId: string) {
    const environment = workspace.environments.find(
      (item) => item.id === environmentId,
    );
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
      next.environments = next.environments.filter(
        (item) => item.id !== environmentId,
      );
      if (next.activeEnvironmentId === environmentId) {
        next.activeEnvironmentId = next.environments[0]?.id ?? "";
      }
    });
  }

  function exportCollection(collectionId: string) {
    const collection = workspace.collections.find(
      (item) => item.id === collectionId,
    );
    if (!collection) {
      return;
    }

    const requestMapById = new Map(
      workspace.requests.map((request) => [request.id, request]),
    );
    const exportPayload = {
      format: "devx-collection",
      version: 1,
      collection: {
        id: collection.id,
        name: collection.name,
      },
      folders: collection.folders,
      requests: collection.requestIds
        .map((requestId) => requestMapById.get(requestId))
        .filter((request): request is RequestDraft => Boolean(request)),
    };

    downloadJsonFile(
      `${sanitizeFileName(collection.name || "collection")}.json`,
      exportPayload,
    );
    closeAllMenus();
  }

  function renameCollection(collectionId: string) {
    const collection = workspace.collections.find(
      (item) => item.id === collectionId,
    );
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
      const collection = next.collections.find(
        (item) => item.id === collectionId,
      );
      if (collection) {
        collection.folders.push({
          id: makeId("folder"),
          name,
          requestIds: [],
        });
      }
    });

    ensureCollectionExpanded(collectionId);
    closeAllMenus();
  }

  function deleteCollection(collectionId: string) {
    const collection = workspace.collections.find(
      (item) => item.id === collectionId,
    );
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
          .map((request) => request.id),
      );

      next.collections = next.collections.filter(
        (item) => item.id !== collectionId,
      );
      next.requests = next.requests.filter(
        (request) => !removingIds.has(request.id),
      );
      next.history = next.history.filter(
        (entry) => !removingIds.has(entry.requestId),
      );
      next.openRequestIds = next.openRequestIds.filter(
        (id) => !removingIds.has(id),
      );
      next.pinnedRequestIds = next.pinnedRequestIds.filter(
        (id) => !removingIds.has(id),
      );
      if (next.lastResponse && removingIds.has(next.lastResponse.requestId)) {
        next.lastResponse = null;
      }

      const fallbackCollection = next.collections[0];
      next.activeCollectionId = fallbackCollection?.id ?? "";
      next.activeRequestId =
        fallbackCollection?.requestIds[0] ?? next.requests[0]?.id ?? "";
      if (
        next.activeRequestId &&
        !next.openRequestIds.includes(next.activeRequestId)
      ) {
        next.openRequestIds.push(next.activeRequestId);
      }
    });

    closeAllMenus();
    setResponseSummary(null);
    setResponseError(null);
  }

  function orderCollection(
    collectionId: string,
    direction: "top" | "up" | "down",
  ) {
    commitWorkspace((next) => {
      const orderedIds = reorderByDirection(
        next.collections.map((collection) => collection.id),
        collectionId,
        direction,
      );
      next.collections = orderedIds
        .map((id) =>
          next.collections.find((collection) => collection.id === id),
        )
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
      const collection = next.collections.find(
        (item) => item.id === collectionId,
      );
      const folder = collection?.folders.find((item) => item.id === folderId);
      if (!collection || !folder) {
        return;
      }

      const duplicateFolderId = makeId("folder");
      const duplicatedRequests = folder.requestIds
        .map((requestId) =>
          next.requests.find((request) => request.id === requestId),
        )
        .filter((request): request is RequestDraft => Boolean(request))
        .map((request) =>
          createRequestDraft(collectionId, {
            ...cloneRestValue(request),
            id: makeId("request"),
            createdAt: new Date().toISOString(),
            folderId: duplicateFolderId,
            name: `${request.name} Copy`,
          }),
        );

      next.requests.push(...duplicatedRequests);

      const folderIndex = collection.folders.findIndex(
        (item) => item.id === folderId,
      );
      collection.folders.splice(folderIndex + 1, 0, {
        id: duplicateFolderId,
        name: `${folder.name} Copy`,
        requestIds: duplicatedRequests.map((request) => request.id),
      });

      const lastOriginalRequestId =
        folder.requestIds[folder.requestIds.length - 1];
      const insertAt =
        lastOriginalRequestId &&
        collection.requestIds.includes(lastOriginalRequestId)
          ? collection.requestIds.indexOf(lastOriginalRequestId) + 1
          : collection.requestIds.length;
      collection.requestIds.splice(
        insertAt,
        0,
        ...duplicatedRequests.map((request) => request.id),
      );
    });

    ensureCollectionExpanded(collectionId);
    closeAllMenus();
  }

  function moveFolderToCollection(
    fromCollectionId: string,
    folderId: string,
    toCollectionId: string,
  ) {
    if (fromCollectionId === toCollectionId) {
      return;
    }

    commitWorkspace((next) => {
      const sourceCollection = next.collections.find(
        (item) => item.id === fromCollectionId,
      );
      const targetCollection = next.collections.find(
        (item) => item.id === toCollectionId,
      );
      if (!sourceCollection || !targetCollection) {
        return;
      }

      const folderIndex = sourceCollection.folders.findIndex(
        (item) => item.id === folderId,
      );
      if (folderIndex < 0) {
        return;
      }

      const [folder] = sourceCollection.folders.splice(folderIndex, 1);
      targetCollection.folders.push(folder);
      sourceCollection.requestIds = sourceCollection.requestIds.filter(
        (requestId) => !folder.requestIds.includes(requestId),
      );
      targetCollection.requestIds.push(
        ...folder.requestIds.filter(
          (requestId) => !targetCollection.requestIds.includes(requestId),
        ),
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

    if (
      !window.confirm(
        `Delete folder "${folder.name}" and all requests inside it?`,
      )
    ) {
      return;
    }

    commitWorkspace((next) => {
      const collection = next.collections.find(
        (item) => item.id === collectionId,
      );
      if (!collection) {
        return;
      }

      const removingIds = new Set(folder.requestIds);
      collection.folders = collection.folders.filter(
        (item) => item.id !== folderId,
      );
      collection.requestIds = collection.requestIds.filter(
        (requestId) => !removingIds.has(requestId),
      );
      next.requests = next.requests.filter(
        (request) => !removingIds.has(request.id),
      );
      next.history = next.history.filter(
        (entry) => !removingIds.has(entry.requestId),
      );
      next.openRequestIds = next.openRequestIds.filter(
        (id) => !removingIds.has(id),
      );
      next.pinnedRequestIds = next.pinnedRequestIds.filter(
        (id) => !removingIds.has(id),
      );
      if (next.lastResponse && removingIds.has(next.lastResponse.requestId)) {
        next.lastResponse = null;
      }

      if (removingIds.has(next.activeRequestId)) {
        next.activeRequestId =
          collection.requestIds[0] ?? next.requests[0]?.id ?? "";
      }
    });

    closeAllMenus();
    setResponseSummary(null);
    setResponseError(null);
  }

  function sortFolderRequests(
    collectionId: string,
    folderId: string,
    mode: "alpha-asc" | "alpha-desc" | "time",
  ) {
    commitWorkspace((next) => {
      const collection = next.collections.find(
        (item) => item.id === collectionId,
      );
      const folder = collection?.folders.find((item) => item.id === folderId);
      if (!collection || !folder) {
        return;
      }

      const requestIndex = new Map(
        next.requests.map((request) => [request.id, request]),
      );
      folder.requestIds = folder.requestIds.slice().sort((leftId, rightId) => {
        const left = requestIndex.get(leftId);
        const right = requestIndex.get(rightId);
        if (!left || !right) {
          return 0;
        }
        if (mode === "alpha-asc") {
          return left.name.localeCompare(right.name, undefined, {
            sensitivity: "base",
          });
        }
        if (mode === "alpha-desc") {
          return right.name.localeCompare(left.name, undefined, {
            sensitivity: "base",
          });
        }
        return (
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime()
        );
      });
    });

    closeAllMenus();
  }

  function orderFolder(
    collectionId: string,
    folderId: string,
    direction: "top" | "up" | "down",
  ) {
    commitWorkspace((next) => {
      const collection = next.collections.find(
        (item) => item.id === collectionId,
      );
      if (!collection) {
        return;
      }

      const orderedIds = reorderByDirection(
        collection.folders.map((folder) => folder.id),
        folderId,
        direction,
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
      const collection = next.collections.find(
        (item) => item.id === request.collectionId,
      );
      if (!target || !collection) {
        return;
      }

      const duplicate = createRequestDraft(request.collectionId, {
        ...cloneRestValue(target),
        id: makeId("request"),
        name: `${target.name} Copy`,
        createdAt: new Date().toISOString(),
        folderId: target.folderId ?? null,
      });

      next.requests.push(duplicate);

      const collectionIndex = collection.requestIds.indexOf(requestId);
      collection.requestIds.splice(collectionIndex + 1, 0, duplicate.id);

      if (duplicate.folderId) {
        const folder = collection.folders.find(
          (item) => item.id === duplicate.folderId,
        );
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

  function moveRequest(
    requestId: string,
    target: { collectionId: string; folderId: string | null },
  ) {
    const request = requestMap().get(requestId);
    if (!request) {
      return;
    }

    commitWorkspace((next) => {
      const sourceCollection = next.collections.find(
        (item) => item.id === request.collectionId,
      );
      const destinationCollection = next.collections.find(
        (item) => item.id === target.collectionId,
      );
      const sourceRequest = next.requests.find((item) => item.id === requestId);
      if (!sourceCollection || !destinationCollection || !sourceRequest) {
        return;
      }

      sourceCollection.requestIds = sourceCollection.requestIds.filter(
        (id) => id !== requestId,
      );
      sourceCollection.folders.forEach((folder) => {
        folder.requestIds = folder.requestIds.filter((id) => id !== requestId);
      });

      destinationCollection.requestIds.push(requestId);
      if (target.folderId) {
        const targetFolder = destinationCollection.folders.find(
          (item) => item.id === target.folderId,
        );
        targetFolder?.requestIds.push(requestId);
      }

      sourceRequest.collectionId = target.collectionId;
      sourceRequest.folderId = target.folderId;
      next.activeCollectionId = target.collectionId;
      next.activeRequestId = requestId;
    });

    ensureCollectionExpanded(target.collectionId);
    ensureFolderExpanded(target.folderId);
    closeAllMenus();
  }

  function getRequestMoveTargetLabel(
    collection: Collection,
    folderId: string | null,
  ) {
    if (!folderId) {
      return `${collection.name} / Root`;
    }

    const folder = collection.folders.find((item) => item.id === folderId);
    return folder
      ? `${collection.name} / ${folder.name}`
      : `${collection.name} / Root`;
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
      next.history = next.history.filter(
        (entry) => entry.requestId !== requestId,
      );
      next.openRequestIds = next.openRequestIds.filter(
        (id) => id !== requestId,
      );
      next.pinnedRequestIds = next.pinnedRequestIds.filter(
        (id) => id !== requestId,
      );
      if (next.lastResponse?.requestId === requestId) {
        next.lastResponse = null;
      }

      next.collections.forEach((collection) => {
        collection.requestIds = collection.requestIds.filter(
          (id) => id !== requestId,
        );
        collection.folders.forEach((folder) => {
          folder.requestIds = folder.requestIds.filter(
            (id) => id !== requestId,
          );
        });
      });

      if (next.activeRequestId === requestId) {
        next.activeRequestId = next.requests[0]?.id ?? "";
        const fallback = next.requests.find(
          (item) => item.id === next.activeRequestId,
        );
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
      const collection = next.collections.find(
        (item) => item.id === request.collectionId,
      );
      if (!collection) {
        return;
      }

      if (request.folderId) {
        const folder = collection.folders.find(
          (item) => item.id === request.folderId,
        );
        if (folder) {
          folder.requestIds = reorderByDirection(
            folder.requestIds,
            requestId,
            direction,
          );
        }
        return;
      }

      const folderIds = new Set(collection.folders.map((item) => item.id));
      const rootRequestIds = collection.requestIds.filter((id) => {
        const entry = next.requests.find((item) => item.id === id);
        return entry && (!entry.folderId || !folderIds.has(entry.folderId));
      });
      const orderedRootIds = reorderByDirection(
        rootRequestIds,
        requestId,
        direction,
      );
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

  function startCurlImport(
    collectionId: string,
    folderId: string | null = null,
  ) {
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
      const request = parseCurlCommand(
        collectionId,
        curlInput(),
        curlImportFolderId(),
      );
      addRequestToWorkspace(collectionId, request, curlImportFolderId());
      setCurlImportCollectionId(null);
      setCurlImportFolderId(null);
      setCurlInput("");
      setCurlError(null);
    } catch (error) {
      setCurlError(
        error instanceof Error
          ? error.message
          : "Failed to parse cURL command.",
      );
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
        `${request.kind === "websocket" ? "WebSocket" : "Socket.IO"} requests are not available in the REST runner yet.`,
      );
      return;
    }

    setIsSending(true);
    setResponseError(null);

    try {
      const result = await executeRestRequest(
        request,
        activeEnvironment() ?? undefined,
      );
      setResponseSummary(result);
      commitWorkspace((next) => {
        next.lastResponse = {
          requestId: request.id,
          response: cloneRestValue(result),
        };
        next.history = [
          createHistoryEntry(request, result),
          ...next.history,
        ].slice(0, 20);
      });
    } catch (error) {
      setResponseSummary(null);
      setResponseError(
        error instanceof Error ? error.message : "Request failed.",
      );
      commitWorkspace((next) => {
        next.lastResponse = null;
        next.history = [
          createHistoryEntry(request, null),
          ...next.history,
        ].slice(0, 20);
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
      const importedFolders: CollectionFolder[] =
        parsed.folders?.map((folder, index) => ({
          id: folder.id ?? makeId("folder"),
          name: folder.name?.trim() || `Folder ${index + 1}`,
          requestIds: [],
        })) ?? [];
      const importedFolderIds = new Set(
        importedFolders.map((folder) => folder.id),
      );
      const importedRequests =
        parsed.requests?.map((request, index) =>
          createRequestDraft(collectionId, {
            ...request,
            id: makeId("request"),
            createdAt: new Date().toISOString(),
            name: request.name ?? `Imported Request ${index + 1}`,
            kind: request.kind ?? "http",
            folderId:
              request.folderId && importedFolderIds.has(request.folderId)
                ? request.folderId
                : null,
          }),
        ) ?? [];

      const requests =
        importedRequests.length > 0
          ? importedRequests
          : [
              createRequestDraft(collectionId, {
                name: "Imported Request",
                url: "{{baseUrl}}/imported",
              }),
            ];

      requests.forEach((request) => {
        if (!request.folderId) {
          return;
        }
        const folder = importedFolders.find(
          (entry) => entry.id === request.folderId,
        );
        if (folder && !folder.requestIds.includes(request.id)) {
          folder.requestIds.push(request.id);
        }
      });

      commitWorkspace((next) => {
        next.collections.push({
          id: collectionId,
          name: parsed.collection?.name || file.name.replace(/\.json$/i, ""),
          folders: importedFolders,
          requestIds: requests.map((request) => request.id),
        });
        next.requests.push(...requests);
        next.activeCollectionId = collectionId;
        next.activeRequestId = requests[0].id;
        next.openRequestIds.push(requests[0].id);
      });

      ensureCollectionExpanded(collectionId);
    } catch {
      window.alert(
        "Import collection is not valid JSON yet. Expected { collection, requests }.",
      );
    } finally {
      target.value = "";
    }
  }

  function openRequestCreationMenu(
    collectionId: string,
    folderId: string | null = null,
    kind?: RequestKind,
  ) {
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
      setCollectionAddMenuId((current) =>
        current === collectionId ? null : collectionId,
      );
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
          class="theme-panel-soft theme-menu-popover absolute right-0 top-9 z-10 min-w-[180px] border p-1"
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

  function renderRequestCreateMenu(
    collectionId: string,
    folderId: string | null = null,
  ) {
    return (
      <div
        class="theme-panel-soft theme-menu-popover absolute right-0 top-7 z-10 min-w-[170px] border p-1"
        data-rest-menu-root
        style={{ "border-color": "var(--app-border)" }}
      >
        <For each={requestCreateOptions}>
          {(option) => (
            <button
              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
              onClick={() =>
                openRequestCreationMenu(collectionId, folderId, option.id)
              }
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
    );
  }

  function isCollectionExpanded(collectionId: string) {
    return (
      expandedCollectionIds().includes(collectionId) ||
      collectionFilter().trim().length > 0
    );
  }

  function startMainPaneResize(event: MouseEvent) {
    event.preventDefault();
    const container = (event.currentTarget as HTMLElement | null)
      ?.parentElement;
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
      window.localStorage.setItem(
        mainPaneSplitStorageKey,
        String(mainPaneSplit()),
      );
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp, { once: true });
  }

  function persistScriptEditorHeight(
    event: MouseEvent | FocusEvent,
    storageKey: string,
    setter: (value: number) => void,
  ) {
    const nextHeight = clampScriptEditorHeight(
      (event.currentTarget as HTMLTextAreaElement).offsetHeight,
    );
    setter(nextHeight);
    window.localStorage.setItem(storageKey, String(nextHeight));
  }

  onMount(() => {
    let disposed = false;

    const savedMainPaneSplit = window.localStorage.getItem(
      mainPaneSplitStorageKey,
    );
    if (savedMainPaneSplit) {
      const parsed = Number(savedMainPaneSplit);
      if (!Number.isNaN(parsed)) {
        setMainPaneSplit(clampMainPaneSplit(parsed));
      }
    }

    const savedPreRequestHeight = window.localStorage.getItem(
      preRequestScriptHeightStorageKey,
    );
    if (savedPreRequestHeight) {
      const parsed = Number(savedPreRequestHeight);
      if (!Number.isNaN(parsed)) {
        setPreRequestScriptHeight(clampScriptEditorHeight(parsed));
      }
    }

    const savedPostResponseHeight = window.localStorage.getItem(
      postResponseScriptHeightStorageKey,
    );
    if (savedPostResponseHeight) {
      const parsed = Number(savedPostResponseHeight);
      if (!Number.isNaN(parsed)) {
        setPostResponseScriptHeight(clampScriptEditorHeight(parsed));
      }
    }

    loadRestWorkspace()
      .then((state) => {
        if (disposed) {
          return;
        }
        const normalized = normalizeRestWorkspace(state);
        setWorkspace(normalized);
        setExpandedCollectionIds(
          normalized.activeCollectionId ? [normalized.activeCollectionId] : [],
        );
        setResponseSummary(normalized.lastResponse?.response ?? null);
        setResponseError(null);
        setIsLoaded(true);
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        const seed = createDefaultRestWorkspace();
        setWorkspace(seed);
        setExpandedCollectionIds(
          seed.activeCollectionId ? [seed.activeCollectionId] : [],
        );
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

  createEffect(() => {
    if (responsePreviewKind() === null) {
      setResponseBodyView("raw");
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
              <div
                class="flex items-center gap-1 border-b pb-2"
                style={{ "border-color": "var(--app-border)" }}
              >
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
                    <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">
                      Collections
                    </p>
                    <div class="relative" data-rest-menu-root>
                      <button
                        class="traffic-dot-button inline-flex h-6 w-6 items-center justify-center rounded-full p-0 leading-none transition"
                        title="Collection actions"
                        onClick={() => {
                          setShowCollectionCreateMenu((current) => !current);
                          setCollectionMenuId(null);
                          setCollectionAddMenuId(null);
                        }}
                      >
                        <ControlDot variant="add" />
                      </button>
                      {renderCollectionCreateMenu()}
                    </div>
                  </div>

                  <input
                    class="theme-input h-8 w-full rounded-md px-2.5 py-1 text-sm"
                    placeholder="Filter collections, folders, requests"
                    value={collectionFilter()}
                    onInput={(event) =>
                      setCollectionFilter(event.currentTarget.value)
                    }
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
                              class={`theme-sidebar-item group flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 ${
                                workspace.activeCollectionId ===
                                entry.collection.id
                                  ? "theme-sidebar-item-active"
                                  : ""
                              }`}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                selectCollection(entry.collection.id);
                                setCollectionMenuId(entry.collection.id);
                                setCollectionOrderMenuId(null);
                                setCollectionAddMenuId(null);
                                setShowCollectionCreateMenu(false);
                              }}
                            >
                              <button
                                class="inline-flex h-5 w-5 items-center justify-center rounded-md text-[11px]"
                                title={
                                  isCollectionExpanded(entry.collection.id)
                                    ? "Collapse"
                                    : "Expand"
                                }
                                onMouseDown={(event) => event.stopPropagation()}
                                onPointerDown={(event) =>
                                  event.stopPropagation()
                                }
                                onClick={() =>
                                  toggleCollectionExpanded(entry.collection.id)
                                }
                              >
                                <svg
                                  class={`h-3.5 w-3.5 transition-transform ${
                                    isCollectionExpanded(entry.collection.id)
                                      ? "rotate-90"
                                      : ""
                                  }`}
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                  aria-hidden="true"
                                >
                                  <path
                                    d="M6 4.5L9.5 8L6 11.5"
                                    stroke="currentColor"
                                    stroke-width="1.6"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                  />
                                </svg>
                              </button>

                              <button
                                class="min-w-0 flex-1 overflow-hidden text-left"
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() =>
                                  selectCollection(entry.collection.id)
                                }
                              >
                                <div class="inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle">
                                  <p
                                    class="theme-text max-w-full truncate text-[13px] font-medium"
                                    title={entry.collection.name}
                                  >
                                    {entry.collection.name}
                                  </p>
                                  <span class="theme-chip shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
                                    {entry.collection.requestIds.length}
                                  </span>
                                </div>
                              </button>

                              <div
                                class={`ml-1 flex shrink-0 items-center gap-1 transition-opacity ${
                                  collectionMenuId() === entry.collection.id ||
                                  collectionAddMenuId() === entry.collection.id
                                    ? "opacity-100"
                                    : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                                }`}
                              >
                                <div
                                  class="relative shrink-0"
                                  data-rest-menu-root
                                >
                                  <button
                                    class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0 text-[11px]"
                                    title="Collection options"
                                    onMouseDown={(event) =>
                                      event.stopPropagation()
                                    }
                                    onPointerDown={(event) =>
                                      event.stopPropagation()
                                    }
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setCollectionMenuId((current) =>
                                        current === entry.collection.id
                                          ? null
                                          : entry.collection.id,
                                      );
                                      setCollectionOrderMenuId(null);
                                      setCollectionAddMenuId(null);
                                      setShowCollectionCreateMenu(false);
                                    }}
                                  >
                                    <ControlDot variant="menu" />
                                  </button>

                                  <Show
                                    when={
                                      collectionMenuId() === entry.collection.id
                                    }
                                  >
                                    <div
                                      class="theme-panel-soft theme-menu-popover absolute right-0 top-7 z-10 min-w-[160px] border p-1"
                                      data-rest-menu-root
                                      style={{
                                        "border-color": "var(--app-border)",
                                      }}
                                    >
                                      <button
                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                        onClick={() =>
                                          renameCollection(entry.collection.id)
                                        }
                                      >
                                        Rename
                                      </button>
                                      <button
                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                        onClick={() =>
                                          addFolder(entry.collection.id)
                                        }
                                      >
                                        Add Folder
                                      </button>
                                      <button
                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                        onClick={() =>
                                          exportCollection(entry.collection.id)
                                        }
                                      >
                                        Export
                                      </button>
                                      <button
                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                        onClick={() =>
                                          orderCollection(
                                            entry.collection.id,
                                            "up",
                                          )
                                        }
                                      >
                                        Move Up
                                      </button>
                                      <button
                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                        onClick={() =>
                                          orderCollection(
                                            entry.collection.id,
                                            "down",
                                          )
                                        }
                                      >
                                        Move Down
                                      </button>
                                      <div class="relative" data-rest-menu-root>
                                        <button
                                          class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setCollectionOrderMenuId(
                                              (current) =>
                                                current === entry.collection.id
                                                  ? null
                                                  : entry.collection.id,
                                            );
                                          }}
                                        >
                                          <span>Order</span>
                                          <span class="theme-text-soft text-[10px]">
                                            ›
                                          </span>
                                        </button>

                                        <Show
                                          when={
                                            collectionOrderMenuId() ===
                                            entry.collection.id
                                          }
                                        >
                                          <div
                                            class="theme-panel-soft theme-menu-popover absolute left-full top-0 ml-1 min-w-[132px] border p-1"
                                            data-rest-menu-root
                                            style={{
                                              "border-color":
                                                "var(--app-border)",
                                            }}
                                          >
                                            <button
                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                              onClick={() =>
                                                orderCollection(
                                                  entry.collection.id,
                                                  "top",
                                                )
                                              }
                                            >
                                              Pin to Top
                                            </button>
                                            <button
                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                              onClick={() =>
                                                orderCollection(
                                                  entry.collection.id,
                                                  "up",
                                                )
                                              }
                                            >
                                              Move Up
                                            </button>
                                            <button
                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                              onClick={() =>
                                                orderCollection(
                                                  entry.collection.id,
                                                  "down",
                                                )
                                              }
                                            >
                                              Move Down
                                            </button>
                                          </div>
                                        </Show>
                                      </div>
                                      <div
                                        class="my-1 border-t"
                                        style={{
                                          "border-color": "var(--app-border)",
                                        }}
                                      />
                                      <button
                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]"
                                        onClick={() =>
                                          deleteCollection(entry.collection.id)
                                        }
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </Show>
                                </div>

                                <div
                                  class="relative shrink-0"
                                  data-rest-menu-root
                                >
                                  <button
                                    class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0 text-xs"
                                    title="Add request"
                                    onMouseDown={(event) =>
                                      event.stopPropagation()
                                    }
                                    onPointerDown={(event) =>
                                      event.stopPropagation()
                                    }
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openRequestCreationMenu(
                                        entry.collection.id,
                                        null,
                                      );
                                    }}
                                  >
                                    <ControlDot variant="add" />
                                  </button>
                                  <Show
                                    when={
                                      collectionAddMenuId() ===
                                      entry.collection.id
                                    }
                                  >
                                    {renderRequestCreateMenu(
                                      entry.collection.id,
                                      null,
                                    )}
                                  </Show>
                                </div>
                              </div>
                            </div>

                            <Show
                              when={isCollectionExpanded(entry.collection.id)}
                            >
                              <div class="ml-2 grid gap-0.5">
                                <For each={rootRequests()}>
                                  {(request) => (
                                    <div
                                      class={`theme-sidebar-item group flex min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                                        workspace.activeRequestId === request.id
                                          ? "theme-sidebar-item-active"
                                          : ""
                                      }`}
                                      onContextMenu={(event) => {
                                        event.preventDefault();
                                        openRequestTab(
                                          request.id,
                                          request.collectionId,
                                        );
                                        setRequestMenuId(request.id);
                                        setRequestOrderMenuId(null);
                                        setRequestMoveMenuId(null);
                                      }}
                                    >
                                      <button
                                        class={getRequestBadgeClass(request)}
                                        onClick={() =>
                                          openRequestTab(
                                            request.id,
                                            request.collectionId,
                                          )
                                        }
                                      >
                                        {getRequestKindLabel(request)}
                                      </button>
                                      <button
                                        class="min-w-0 flex-1 text-left"
                                        onClick={() =>
                                          openRequestTab(
                                            request.id,
                                            request.collectionId,
                                          )
                                        }
                                      >
                                        <p
                                          class="truncate text-[13px] font-medium"
                                          title={request.name}
                                        >
                                          {request.name}
                                        </p>
                                      </button>
                                      <div
                                        class={`relative shrink-0 transition-opacity ${
                                          requestMenuId() === request.id
                                            ? "opacity-100"
                                            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                                        }`}
                                        data-rest-menu-root
                                      >
                                        <button
                                          class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0 text-[11px]"
                                          title="Request options"
                                          onMouseDown={(event) =>
                                            event.stopPropagation()
                                          }
                                          onPointerDown={(event) =>
                                            event.stopPropagation()
                                          }
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setRequestMenuId((current) =>
                                              current === request.id
                                                ? null
                                                : request.id,
                                            );
                                            setRequestOrderMenuId(null);
                                            setRequestMoveMenuId(null);
                                          }}
                                        >
                                          <ControlDot variant="menu" />
                                        </button>
                                        <Show
                                          when={requestMenuId() === request.id}
                                        >
                                          <div
                                            class="theme-panel-soft theme-menu-popover absolute right-0 top-7 z-10 min-w-[172px] border p-1"
                                            data-rest-menu-root
                                            style={{
                                              "border-color":
                                                "var(--app-border)",
                                            }}
                                          >
                                            <button
                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                              onClick={() =>
                                                void copyRequestAsCurl(
                                                  request.id,
                                                )
                                              }
                                            >
                                              Copy cURL
                                            </button>
                                            <button
                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                              onClick={() =>
                                                renameRequest(request.id)
                                              }
                                            >
                                              Rename
                                            </button>
                                            <button
                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                              onClick={() =>
                                                duplicateRequest(request.id)
                                              }
                                            >
                                              Duplicate
                                            </button>
                                            <button
                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                              onClick={() =>
                                                orderRequest(request.id, "up")
                                              }
                                            >
                                              Move Up
                                            </button>
                                            <button
                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                              onClick={() =>
                                                orderRequest(request.id, "down")
                                              }
                                            >
                                              Move Down
                                            </button>
                                            <div
                                              class="relative"
                                              data-rest-menu-root
                                            >
                                              <button
                                                class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  setRequestMoveMenuId(
                                                    (current) =>
                                                      current === request.id
                                                        ? null
                                                        : request.id,
                                                  );
                                                  setRequestOrderMenuId(null);
                                                }}
                                              >
                                                <span>Move to</span>
                                                <span class="theme-text-soft text-[10px]">
                                                  ›
                                                </span>
                                              </button>
                                              <Show
                                                when={
                                                  requestMoveMenuId() ===
                                                  request.id
                                                }
                                              >
                                                <div
                                                  class="theme-panel-soft theme-menu-popover absolute left-full top-0 ml-1 min-w-[188px] border p-1"
                                                  data-rest-menu-root
                                                  style={{
                                                    "border-color":
                                                      "var(--app-border)",
                                                  }}
                                                >
                                                  <For
                                                    each={workspace.collections}
                                                  >
                                                    {(collection) => (
                                                      <>
                                                        <button
                                                          class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                          onClick={() =>
                                                            moveRequest(
                                                              request.id,
                                                              {
                                                                collectionId:
                                                                  collection.id,
                                                                folderId: null,
                                                              },
                                                            )
                                                          }
                                                        >
                                                          {getRequestMoveTargetLabel(
                                                            collection,
                                                            null,
                                                          )}
                                                        </button>
                                                        <For
                                                          each={
                                                            collection.folders
                                                          }
                                                        >
                                                          {(folder) => (
                                                            <button
                                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 pl-7 text-left text-sm"
                                                              onClick={() =>
                                                                moveRequest(
                                                                  request.id,
                                                                  {
                                                                    collectionId:
                                                                      collection.id,
                                                                    folderId:
                                                                      folder.id,
                                                                  },
                                                                )
                                                              }
                                                            >
                                                              {getRequestMoveTargetLabel(
                                                                collection,
                                                                folder.id,
                                                              )}
                                                            </button>
                                                          )}
                                                        </For>
                                                      </>
                                                    )}
                                                  </For>
                                                </div>
                                              </Show>
                                            </div>
                                            <div
                                              class="relative"
                                              data-rest-menu-root
                                            >
                                              <button
                                                class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  setRequestOrderMenuId(
                                                    (current) =>
                                                      current === request.id
                                                        ? null
                                                        : request.id,
                                                  );
                                                  setRequestMoveMenuId(null);
                                                }}
                                              >
                                                <span>Order</span>
                                                <span class="theme-text-soft text-[10px]">
                                                  ›
                                                </span>
                                              </button>
                                              <Show
                                                when={
                                                  requestOrderMenuId() ===
                                                  request.id
                                                }
                                              >
                                                <div
                                                  class="theme-panel-soft theme-menu-popover absolute left-full top-0 ml-1 min-w-[132px] border p-1"
                                                  data-rest-menu-root
                                                  style={{
                                                    "border-color":
                                                      "var(--app-border)",
                                                  }}
                                                >
                                                  <button
                                                    class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                    onClick={() =>
                                                      orderRequest(
                                                        request.id,
                                                        "top",
                                                      )
                                                    }
                                                  >
                                                    Pin to Top
                                                  </button>
                                                  <button
                                                    class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                    onClick={() =>
                                                      orderRequest(
                                                        request.id,
                                                        "up",
                                                      )
                                                    }
                                                  >
                                                    Move Up
                                                  </button>
                                                  <button
                                                    class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                    onClick={() =>
                                                      orderRequest(
                                                        request.id,
                                                        "down",
                                                      )
                                                    }
                                                  >
                                                    Move Down
                                                  </button>
                                                </div>
                                              </Show>
                                            </div>
                                            <button
                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]"
                                              onClick={() =>
                                                deleteRequest(request.id)
                                              }
                                            >
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
                                      <div
                                        class="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5"
                                        onContextMenu={(event) => {
                                          event.preventDefault();
                                          setFolderMenuId(
                                            folderEntry.folder.id,
                                          );
                                          setFolderOrderMenuId(null);
                                          setFolderMoveMenuId(null);
                                          setFolderAddMenuId(null);
                                        }}
                                      >
                                        <button
                                          class="inline-flex h-5 w-5 items-center justify-center rounded-md text-[11px]"
                                          title={
                                            isFolderExpanded(
                                              folderEntry.folder.id,
                                            )
                                              ? "Collapse"
                                              : "Expand"
                                          }
                                          onMouseDown={(event) =>
                                            event.stopPropagation()
                                          }
                                          onPointerDown={(event) =>
                                            event.stopPropagation()
                                          }
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            toggleFolderExpanded(
                                              folderEntry.folder.id,
                                            );
                                          }}
                                        >
                                          <svg
                                            class={`h-3.5 w-3.5 transition-transform ${
                                              isFolderExpanded(
                                                folderEntry.folder.id,
                                              )
                                                ? "rotate-90"
                                                : ""
                                            }`}
                                            viewBox="0 0 16 16"
                                            fill="none"
                                            xmlns="http://www.w3.org/2000/svg"
                                            aria-hidden="true"
                                          >
                                            <path
                                              d="M6 4.5L9.5 8L6 11.5"
                                              stroke="currentColor"
                                              stroke-width="1.6"
                                              stroke-linecap="round"
                                              stroke-linejoin="round"
                                            />
                                          </svg>
                                        </button>
                                        <button
                                          class="min-w-0 flex-1 text-left"
                                          title={folderEntry.folder.name}
                                          onMouseDown={(event) =>
                                            event.stopPropagation()
                                          }
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            toggleFolderExpanded(
                                              folderEntry.folder.id,
                                            );
                                          }}
                                        >
                                          <div class="inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle">
                                            <p class="max-w-full truncate text-[13px] font-medium">
                                              {folderEntry.folder.name}
                                            </p>
                                            <span class="theme-chip shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
                                              {folderEntry.requests.length}
                                            </span>
                                          </div>
                                        </button>
                                        <div
                                          class={`relative shrink-0 transition-opacity ${
                                            folderMenuId() ===
                                              folderEntry.folder.id ||
                                            folderAddMenuId() ===
                                              folderEntry.folder.id
                                              ? "opacity-100"
                                              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                                          }`}
                                          data-rest-menu-root
                                        >
                                          <button
                                            class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0 text-[11px]"
                                            title="Folder options"
                                            onMouseDown={(event) =>
                                              event.stopPropagation()
                                            }
                                            onPointerDown={(event) =>
                                              event.stopPropagation()
                                            }
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              setFolderMenuId((current) =>
                                                current ===
                                                folderEntry.folder.id
                                                  ? null
                                                  : folderEntry.folder.id,
                                              );
                                              setFolderOrderMenuId(null);
                                              setFolderMoveMenuId(null);
                                            }}
                                          >
                                            <ControlDot variant="menu" />
                                          </button>
                                          <Show
                                            when={
                                              folderMenuId() ===
                                              folderEntry.folder.id
                                            }
                                          >
                                            <div
                                              class="theme-panel-soft theme-menu-popover absolute right-0 top-7 z-10 min-w-[176px] border p-1"
                                              data-rest-menu-root
                                              style={{
                                                "border-color":
                                                  "var(--app-border)",
                                              }}
                                            >
                                              <button
                                                class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                onClick={() =>
                                                  renameFolder(
                                                    entry.collection.id,
                                                    folderEntry.folder.id,
                                                  )
                                                }
                                              >
                                                Rename
                                              </button>
                                              <button
                                                class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                onClick={() =>
                                                  duplicateFolder(
                                                    entry.collection.id,
                                                    folderEntry.folder.id,
                                                  )
                                                }
                                              >
                                                Duplicate
                                              </button>
                                              <button
                                                class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                onClick={() =>
                                                  orderFolder(
                                                    entry.collection.id,
                                                    folderEntry.folder.id,
                                                    "up",
                                                  )
                                                }
                                              >
                                                Move Up
                                              </button>
                                              <button
                                                class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                onClick={() =>
                                                  orderFolder(
                                                    entry.collection.id,
                                                    folderEntry.folder.id,
                                                    "down",
                                                  )
                                                }
                                              >
                                                Move Down
                                              </button>
                                              <div
                                                class="relative"
                                                data-rest-menu-root
                                              >
                                                <button
                                                  class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    setFolderMoveMenuId(
                                                      (current) =>
                                                        current ===
                                                        folderEntry.folder.id
                                                          ? null
                                                          : folderEntry.folder
                                                              .id,
                                                    );
                                                    setFolderOrderMenuId(null);
                                                  }}
                                                >
                                                  <span>Move to</span>
                                                  <span class="theme-text-soft text-[10px]">
                                                    ›
                                                  </span>
                                                </button>
                                                <Show
                                                  when={
                                                    folderMoveMenuId() ===
                                                    folderEntry.folder.id
                                                  }
                                                >
                                                  <div
                                                    class="theme-panel-soft theme-menu-popover absolute left-full top-0 ml-1 min-w-[170px] border p-1"
                                                    data-rest-menu-root
                                                    style={{
                                                      "border-color":
                                                        "var(--app-border)",
                                                    }}
                                                  >
                                                    <For
                                                      each={workspace.collections.filter(
                                                        (collection) =>
                                                          collection.id !==
                                                          entry.collection.id,
                                                      )}
                                                    >
                                                      {(collection) => (
                                                        <button
                                                          class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                          onClick={() =>
                                                            moveFolderToCollection(
                                                              entry.collection
                                                                .id,
                                                              folderEntry.folder
                                                                .id,
                                                              collection.id,
                                                            )
                                                          }
                                                        >
                                                          {collection.name}
                                                        </button>
                                                      )}
                                                    </For>
                                                  </div>
                                                </Show>
                                              </div>
                                              <div
                                                class="relative"
                                                data-rest-menu-root
                                              >
                                                <button
                                                  class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    setFolderOrderMenuId(
                                                      (current) =>
                                                        current ===
                                                        folderEntry.folder.id
                                                          ? null
                                                          : folderEntry.folder
                                                              .id,
                                                    );
                                                    setFolderMoveMenuId(null);
                                                  }}
                                                >
                                                  <span>Order</span>
                                                  <span class="theme-text-soft text-[10px]">
                                                    ›
                                                  </span>
                                                </button>
                                                <Show
                                                  when={
                                                    folderOrderMenuId() ===
                                                    folderEntry.folder.id
                                                  }
                                                >
                                                  <div
                                                    class="theme-panel-soft theme-menu-popover absolute left-full top-0 ml-1 min-w-[132px] border p-1"
                                                    data-rest-menu-root
                                                    style={{
                                                      "border-color":
                                                        "var(--app-border)",
                                                    }}
                                                  >
                                                    <button
                                                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                      onClick={() =>
                                                        orderFolder(
                                                          entry.collection.id,
                                                          folderEntry.folder.id,
                                                          "top",
                                                        )
                                                      }
                                                    >
                                                      Pin to Top
                                                    </button>
                                                    <button
                                                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                      onClick={() =>
                                                        orderFolder(
                                                          entry.collection.id,
                                                          folderEntry.folder.id,
                                                          "up",
                                                        )
                                                      }
                                                    >
                                                      Move Up
                                                    </button>
                                                    <button
                                                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                      onClick={() =>
                                                        orderFolder(
                                                          entry.collection.id,
                                                          folderEntry.folder.id,
                                                          "down",
                                                        )
                                                      }
                                                    >
                                                      Move Down
                                                    </button>
                                                  </div>
                                                </Show>
                                              </div>
                                              <div
                                                class="relative"
                                                data-rest-menu-root
                                              >
                                                <button
                                                  class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    setFolderOrderMenuId(
                                                      (current) =>
                                                        current ===
                                                        `sort:${folderEntry.folder.id}`
                                                          ? null
                                                          : `sort:${folderEntry.folder.id}`,
                                                    );
                                                    setFolderMoveMenuId(null);
                                                  }}
                                                >
                                                  <span>Sort</span>
                                                  <span class="theme-text-soft text-[10px]">
                                                    ›
                                                  </span>
                                                </button>
                                                <Show
                                                  when={
                                                    folderOrderMenuId() ===
                                                    `sort:${folderEntry.folder.id}`
                                                  }
                                                >
                                                  <div
                                                    class="theme-panel-soft theme-menu-popover absolute left-full top-0 ml-1 min-w-[156px] border p-1"
                                                    data-rest-menu-root
                                                    style={{
                                                      "border-color":
                                                        "var(--app-border)",
                                                    }}
                                                  >
                                                    <button
                                                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                      onClick={() =>
                                                        sortFolderRequests(
                                                          entry.collection.id,
                                                          folderEntry.folder.id,
                                                          "alpha-asc",
                                                        )
                                                      }
                                                    >
                                                      A-Z
                                                    </button>
                                                    <button
                                                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                      onClick={() =>
                                                        sortFolderRequests(
                                                          entry.collection.id,
                                                          folderEntry.folder.id,
                                                          "alpha-desc",
                                                        )
                                                      }
                                                    >
                                                      Z-A
                                                    </button>
                                                    <button
                                                      class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                      onClick={() =>
                                                        sortFolderRequests(
                                                          entry.collection.id,
                                                          folderEntry.folder.id,
                                                          "time",
                                                        )
                                                      }
                                                    >
                                                      By Time (Newest)
                                                    </button>
                                                  </div>
                                                </Show>
                                              </div>
                                              <button
                                                class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]"
                                                onClick={() =>
                                                  deleteFolder(
                                                    entry.collection.id,
                                                    folderEntry.folder.id,
                                                  )
                                                }
                                              >
                                                Delete
                                              </button>
                                            </div>
                                          </Show>
                                        </div>
                                        <div
                                          class={`relative shrink-0 transition-opacity ${
                                            folderMenuId() ===
                                              folderEntry.folder.id ||
                                            folderAddMenuId() ===
                                              folderEntry.folder.id
                                              ? "opacity-100"
                                              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                                          }`}
                                          data-rest-menu-root
                                        >
                                          <button
                                            class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0 text-xs"
                                            title="Add request"
                                            onMouseDown={(event) =>
                                              event.stopPropagation()
                                            }
                                            onPointerDown={(event) =>
                                              event.stopPropagation()
                                            }
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              openRequestCreationMenu(
                                                entry.collection.id,
                                                folderEntry.folder.id,
                                              );
                                            }}
                                          >
                                            <ControlDot variant="add" />
                                          </button>
                                          <Show
                                            when={
                                              folderAddMenuId() ===
                                              folderEntry.folder.id
                                            }
                                          >
                                            {renderRequestCreateMenu(
                                              entry.collection.id,
                                              folderEntry.folder.id,
                                            )}
                                          </Show>
                                        </div>
                                      </div>

                                      <Show
                                        when={isFolderExpanded(
                                          folderEntry.folder.id,
                                        )}
                                      >
                                        <div class="grid gap-1">
                                          <For each={folderEntry.requests}>
                                            {(request) => (
                                              <div
                                                class={`theme-sidebar-item group flex min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                                                  workspace.activeRequestId ===
                                                  request.id
                                                    ? "theme-sidebar-item-active"
                                                    : ""
                                                }`}
                                                onContextMenu={(event) => {
                                                  event.preventDefault();
                                                  openRequestTab(
                                                    request.id,
                                                    request.collectionId,
                                                  );
                                                  setRequestMenuId(request.id);
                                                  setRequestOrderMenuId(null);
                                                  setRequestMoveMenuId(null);
                                                }}
                                              >
                                                <button
                                                  class={getRequestBadgeClass(
                                                    request,
                                                  )}
                                                  onClick={() =>
                                                    openRequestTab(
                                                      request.id,
                                                      request.collectionId,
                                                    )
                                                  }
                                                >
                                                  {getRequestKindLabel(request)}
                                                </button>
                                                <button
                                                  class="min-w-0 flex-1 text-left"
                                                  onClick={() =>
                                                    openRequestTab(
                                                      request.id,
                                                      request.collectionId,
                                                    )
                                                  }
                                                >
                                                  <p
                                                    class="truncate text-[13px] font-medium"
                                                    title={request.name}
                                                  >
                                                    {request.name}
                                                  </p>
                                                </button>
                                                <div
                                                  class={`relative shrink-0 transition-opacity ${
                                                    requestMenuId() ===
                                                    request.id
                                                      ? "opacity-100"
                                                      : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                                                  }`}
                                                  data-rest-menu-root
                                                >
                                                  <button
                                                    class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0 text-[11px]"
                                                    title="Request options"
                                                    onMouseDown={(event) =>
                                                      event.stopPropagation()
                                                    }
                                                    onPointerDown={(event) =>
                                                      event.stopPropagation()
                                                    }
                                                    onClick={(event) => {
                                                      event.stopPropagation();
                                                      setRequestMenuId(
                                                        (current) =>
                                                          current === request.id
                                                            ? null
                                                            : request.id,
                                                      );
                                                      setRequestOrderMenuId(
                                                        null,
                                                      );
                                                      setRequestMoveMenuId(
                                                        null,
                                                      );
                                                    }}
                                                  >
                                                    <ControlDot variant="menu" />
                                                  </button>
                                                  <Show
                                                    when={
                                                      requestMenuId() ===
                                                      request.id
                                                    }
                                                  >
                                                    <div
                                                      class="theme-panel-soft theme-menu-popover absolute right-0 top-7 z-10 min-w-[172px] border p-1"
                                                      data-rest-menu-root
                                                      style={{
                                                        "border-color":
                                                          "var(--app-border)",
                                                      }}
                                                    >
                                                      <button
                                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                        onClick={() =>
                                                          void copyRequestAsCurl(
                                                            request.id,
                                                          )
                                                        }
                                                      >
                                                        Copy cURL
                                                      </button>
                                                      <button
                                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                        onClick={() =>
                                                          renameRequest(
                                                            request.id,
                                                          )
                                                        }
                                                      >
                                                        Rename
                                                      </button>
                                                      <button
                                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                        onClick={() =>
                                                          duplicateRequest(
                                                            request.id,
                                                          )
                                                        }
                                                      >
                                                        Duplicate
                                                      </button>
                                                      <button
                                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                        onClick={() =>
                                                          orderRequest(
                                                            request.id,
                                                            "up",
                                                          )
                                                        }
                                                      >
                                                        Move Up
                                                      </button>
                                                      <button
                                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                        onClick={() =>
                                                          orderRequest(
                                                            request.id,
                                                            "down",
                                                          )
                                                        }
                                                      >
                                                        Move Down
                                                      </button>
                                                      <div
                                                        class="relative"
                                                        data-rest-menu-root
                                                      >
                                                        <button
                                                          class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                                          onClick={(event) => {
                                                            event.stopPropagation();
                                                            setRequestMoveMenuId(
                                                              (current) =>
                                                                current ===
                                                                request.id
                                                                  ? null
                                                                  : request.id,
                                                            );
                                                            setRequestOrderMenuId(
                                                              null,
                                                            );
                                                          }}
                                                        >
                                                          <span>Move to</span>
                                                          <span class="theme-text-soft text-[10px]">
                                                            ›
                                                          </span>
                                                        </button>
                                                        <Show
                                                          when={
                                                            requestMoveMenuId() ===
                                                            request.id
                                                          }
                                                        >
                                                          <div
                                                            class="theme-panel-soft theme-menu-popover absolute left-full top-0 ml-1 min-w-[188px] border p-1"
                                                            data-rest-menu-root
                                                            style={{
                                                              "border-color":
                                                                "var(--app-border)",
                                                            }}
                                                          >
                                                            <For
                                                              each={
                                                                workspace.collections
                                                              }
                                                            >
                                                              {(collection) => (
                                                                <>
                                                                  <button
                                                                    class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                                    onClick={() =>
                                                                      moveRequest(
                                                                        request.id,
                                                                        {
                                                                          collectionId:
                                                                            collection.id,
                                                                          folderId:
                                                                            null,
                                                                        },
                                                                      )
                                                                    }
                                                                  >
                                                                    {getRequestMoveTargetLabel(
                                                                      collection,
                                                                      null,
                                                                    )}
                                                                  </button>
                                                                  <For
                                                                    each={
                                                                      collection.folders
                                                                    }
                                                                  >
                                                                    {(
                                                                      folder,
                                                                    ) => (
                                                                      <button
                                                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 pl-7 text-left text-sm"
                                                                        onClick={() =>
                                                                          moveRequest(
                                                                            request.id,
                                                                            {
                                                                              collectionId:
                                                                                collection.id,
                                                                              folderId:
                                                                                folder.id,
                                                                            },
                                                                          )
                                                                        }
                                                                      >
                                                                        {getRequestMoveTargetLabel(
                                                                          collection,
                                                                          folder.id,
                                                                        )}
                                                                      </button>
                                                                    )}
                                                                  </For>
                                                                </>
                                                              )}
                                                            </For>
                                                          </div>
                                                        </Show>
                                                      </div>
                                                      <div
                                                        class="relative"
                                                        data-rest-menu-root
                                                      >
                                                        <button
                                                          class="theme-sidebar-item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                                                          onClick={(event) => {
                                                            event.stopPropagation();
                                                            setRequestOrderMenuId(
                                                              (current) =>
                                                                current ===
                                                                request.id
                                                                  ? null
                                                                  : request.id,
                                                            );
                                                            setRequestMoveMenuId(
                                                              null,
                                                            );
                                                          }}
                                                        >
                                                          <span>Order</span>
                                                          <span class="theme-text-soft text-[10px]">
                                                            ›
                                                          </span>
                                                        </button>
                                                        <Show
                                                          when={
                                                            requestOrderMenuId() ===
                                                            request.id
                                                          }
                                                        >
                                                          <div
                                                            class="theme-panel-soft theme-menu-popover absolute left-full top-0 ml-1 min-w-[132px] border p-1"
                                                            data-rest-menu-root
                                                            style={{
                                                              "border-color":
                                                                "var(--app-border)",
                                                            }}
                                                          >
                                                            <button
                                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                              onClick={() =>
                                                                orderRequest(
                                                                  request.id,
                                                                  "top",
                                                                )
                                                              }
                                                            >
                                                              Pin to Top
                                                            </button>
                                                            <button
                                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                              onClick={() =>
                                                                orderRequest(
                                                                  request.id,
                                                                  "up",
                                                                )
                                                              }
                                                            >
                                                              Move Up
                                                            </button>
                                                            <button
                                                              class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm"
                                                              onClick={() =>
                                                                orderRequest(
                                                                  request.id,
                                                                  "down",
                                                                )
                                                              }
                                                            >
                                                              Move Down
                                                            </button>
                                                          </div>
                                                        </Show>
                                                      </div>
                                                      <button
                                                        class="theme-sidebar-item w-full rounded-xl px-3 py-2 text-left text-sm text-[#ff3b30]"
                                                        onClick={() =>
                                                          deleteRequest(
                                                            request.id,
                                                          )
                                                        }
                                                      >
                                                        Delete
                                                      </button>
                                                    </div>
                                                  </Show>
                                                </div>
                                              </div>
                                            )}
                                          </For>
                                        </div>
                                      </Show>
                                    </div>
                                  )}
                                </For>
                                <Show
                                  when={
                                    rootRequests().length === 0 &&
                                    folders().length === 0
                                  }
                                >
                                  <div class="theme-text-soft px-2 py-1.5 text-xs">
                                    {collectionFilter().trim()
                                      ? "No matches"
                                      : "No requests yet"}
                                  </div>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                    <Show when={filteredCollections().length === 0}>
                      <div class="theme-text-soft px-2 py-2 text-xs">
                        No matches
                      </div>
                    </Show>
                  </div>
                </div>
              </Show>

              <Show when={sidebarPanel() === "environments"}>
                <div class="space-y-2">
                  <div class="flex items-center justify-between gap-3">
                    <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">
                      Environments
                    </p>
                    <button
                      class="traffic-dot-button inline-flex h-6 w-6 items-center justify-center rounded-full p-0 leading-none transition"
                      title="New environment"
                      onClick={createEnvironment}
                    >
                      <ControlDot variant="add" />
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
                          <p class="theme-text text-sm font-semibold">
                            {environment.name}
                          </p>
                          <span class="theme-text-soft text-xs">
                            {environment.variables.length}
                          </span>
                        </button>
                      )}
                    </For>
                  </div>

                  <Show when={activeEnvironment()}>
                    {(environment) => (
                      <div
                        class="mt-3 space-y-2 border-t pt-3"
                        style={{ "border-color": "var(--app-border)" }}
                      >
                        <div class="flex items-center justify-between gap-2">
                          <input
                            class="theme-input h-8 min-w-0 flex-1 rounded-md px-2.5 py-1 text-sm font-medium"
                            value={environment().name}
                            onInput={(event) =>
                              commitWorkspace((next) => {
                                const target = next.environments.find(
                                  (item) => item.id === environment().id,
                                );
                                if (target) {
                                  target.name = event.currentTarget.value;
                                }
                              })
                            }
                          />
                          <button
                            class="theme-control inline-flex h-6 w-6 items-center justify-center rounded-full text-sm leading-none"
                            title="Duplicate environment"
                            onClick={() =>
                              duplicateEnvironment(environment().id)
                            }
                          >
                            ⎘
                          </button>
                          <button
                            class="inline-flex h-6 w-6 items-center justify-center rounded-full text-sm leading-none text-[#ff3b30] transition hover:bg-[rgba(255,59,48,0.12)]"
                            title="Delete environment"
                            onClick={() => deleteEnvironment(environment().id)}
                          >
                            <ControlDot variant="delete" />
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
                                const target = next.environments.find(
                                  (item) => item.id === environment().id,
                                );
                                if (target) {
                                  target.variables = [
                                    ...target.variables,
                                    createKeyValueEntry(),
                                  ];
                                }
                              })
                            }
                          >
                            <ControlDot variant="add" />
                          </button>
                        </div>

                        <KeyValueTableEditor
                          rows={environment().variables}
                          resizeStorageKey="devx-kv-environment-variables"
                          valuePlaceholder="https://api.example.com"
                          onUpdate={(id, key, value) =>
                            commitWorkspace((next) => {
                              const target = next.environments.find(
                                (item) => item.id === environment().id,
                              );
                              if (target) {
                                target.variables = target.variables.map(
                                  (entry) =>
                                    entry.id === id
                                      ? { ...entry, [key]: value }
                                      : entry,
                                );
                              }
                            })
                          }
                          onToggle={(id) =>
                            commitWorkspace((next) => {
                              const target = next.environments.find(
                                (item) => item.id === environment().id,
                              );
                              if (target) {
                                target.variables = target.variables.map(
                                  (entry) =>
                                    entry.id === id
                                      ? { ...entry, enabled: !entry.enabled }
                                      : entry,
                                );
                              }
                            })
                          }
                          onRemove={(id) =>
                            commitWorkspace((next) => {
                              const target = next.environments.find(
                                (item) => item.id === environment().id,
                              );
                              if (target) {
                                target.variables = target.variables.filter(
                                  (entry) => entry.id !== id,
                                );
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
                    <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">
                      History
                    </p>
                  </div>
                  <div class="grid gap-1">
                    <For each={workspace.history}>
                      {(entry) => (
                        <button
                          class="theme-sidebar-item flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left"
                          onClick={() => openRequestTab(entry.requestId)}
                        >
                          <span
                            class={`theme-method-badge shrink-0 ${getMethodClass(entry.method)}`}
                          >
                            {entry.method}
                          </span>
                          <p class="min-w-0 flex-1 truncate text-[13px] font-medium">
                            {entry.requestName}
                          </p>
                          <span class="theme-text-soft text-xs">
                            {entry.status ? `${entry.status}` : "ERR"}
                          </span>
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
        <Show
          when={requestTabItems().length > 0}
          fallback={<div class="flex-1 min-h-0" />}
        >
          <div class="border-b" style={{ "border-color": "var(--app-border)" }}>
            <div class="grid gap-1.5">
              <div class="overflow-visible">
                <TabsBar
                  items={requestTabItems()}
                  draggedId={draggedTabId()}
                  dropTargetId={tabDropTargetId()}
                  renderCloseIcon={() => <ControlDot variant="delete" />}
                  renderPinIcon={() => <PinIcon />}
                  onTabOpen={(requestId) => {
                    const request = requestMap().get(requestId);
                    if (request) {
                      openRequestTab(requestId, request.collectionId);
                    }
                  }}
                  onTabClose={(requestId) => closeRequestTab(requestId)}
                  onTabContextMenu={(requestId, event) => {
                    setRequestTabMenuState({
                      id: requestId,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onDragStart={(requestId, event) => {
                    setDraggedTabId(requestId);
                    event.dataTransfer?.setData("text/plain", requestId);
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = "move";
                    }
                  }}
                  onDragEnd={() => {
                    setDraggedTabId(null);
                    setTabDropTargetId(null);
                  }}
                  onTabDragOver={(requestId, event) => {
                    event.preventDefault();
                    setTabDropTargetId(requestId);
                  }}
                  onTabDrop={(requestId, event) => {
                    event.preventDefault();
                    const draggedId = draggedTabId();
                    if (draggedId) {
                      reorderRequestTabs(draggedId, requestId);
                    }
                    setDraggedTabId(null);
                    setTabDropTargetId(null);
                  }}
                  onStripDragOver={(event) => {
                    event.preventDefault();
                    setTabDropTargetId(null);
                  }}
                  onStripDrop={(event) => {
                    event.preventDefault();
                    const draggedId = draggedTabId();
                    if (draggedId) {
                      reorderRequestTabs(draggedId, null);
                    }
                    setDraggedTabId(null);
                    setTabDropTargetId(null);
                  }}
                />
              </div>

              <Show when={activeRequest()}>
                {(request) => (
                  <div class="flex flex-wrap items-center gap-2 px-3 pb-1.5">
                    <input
                      class="theme-input h-8 min-w-[180px] rounded-md px-2.5 py-1 text-sm"
                      value={request().name}
                      onInput={(event) =>
                        updateActiveRequest((current) => {
                          current.name = event.currentTarget.value;
                        })
                      }
                    />
                    <select
                      class="theme-input h-8 rounded-md px-2.5 py-1 text-sm font-semibold"
                      value={request().method}
                      disabled={!canSendActiveRequest()}
                      onInput={(event) =>
                        updateActiveRequest((current) => {
                          current.method = event.currentTarget
                            .value as RequestMethod;
                        })
                      }
                    >
                      <For each={requestMethods}>
                        {(method) => <option value={method}>{method}</option>}
                      </For>
                    </select>
                    <input
                      class="theme-input h-8 min-w-[280px] flex-1 rounded-md px-2.5 py-1 text-sm transition"
                      value={request().url}
                      onInput={(event) =>
                        updateActiveRequest((current) => {
                          current.url = event.currentTarget.value;
                        })
                      }
                    />
                    <select
                      class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                      value={workspace.activeEnvironmentId}
                      onInput={(event) =>
                        commitWorkspace((next) => {
                          next.activeEnvironmentId = event.currentTarget.value;
                        })
                      }
                    >
                      <For each={workspace.environments}>
                        {(environment) => (
                          <option value={environment.id}>
                            {environment.name}
                          </option>
                        )}
                      </For>
                    </select>
                    <div class="flex items-center gap-2">
                      <AppButton
                        variant={
                          saveState() === "saved"
                            ? "success"
                            : saveState() === "error"
                              ? "danger"
                              : "default"
                        }
                        size="sm"
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
                      </AppButton>
                    </div>
                    <AppButton
                      variant="primary"
                      size="sm"
                      disabled={isSending() || !canSendActiveRequest()}
                      onClick={() => void sendActiveRequest()}
                    >
                      {!canSendActiveRequest()
                        ? "Coming Soon"
                        : isSending()
                          ? "Sending..."
                          : "Send"}
                    </AppButton>
                  </div>
                )}
              </Show>
            </div>
          </div>
        </Show>

        <Show when={requestTabItems().length > 0}>
          <div
            class="grid min-h-0 flex-1"
            style={{
              "grid-template-columns": `minmax(0, ${mainPaneSplit()}fr) 10px minmax(360px, ${100 - mainPaneSplit()}fr)`,
            }}
          >
            <div
              class="flex min-h-0 flex-col overflow-auto border-r"
              style={{ "border-color": "var(--app-border)" }}
            >
              <div
                class="shrink-0 border-b px-3 py-2"
                style={{ "border-color": "var(--app-border)" }}
              >
                <Show when={!canSendActiveRequest() && activeRequest()}>
                  {(request) => (
                    <div
                      class="mb-3 rounded-lg border px-3 py-2.5 text-sm"
                      style={{
                        "border-color": "var(--app-border)",
                        background: "var(--app-panel-soft)",
                      }}
                    >
                      <span class="theme-text">
                        {request().kind === "websocket"
                          ? "WebSocket"
                          : "Socket.IO"}{" "}
                        workspace will be added next.
                      </span>
                    </div>
                  )}
                </Show>

                <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <EditorToggle
                      active={topEditorTab() === "headers"}
                      label="Headers"
                      onClick={() => setTopEditorTab("headers")}
                    />
                    <EditorToggle
                      active={topEditorTab() === "auth"}
                      label="Auth"
                      onClick={() => setTopEditorTab("auth")}
                    />
                  </div>
                  <Show when={topEditorTab() === "headers"}>
                    <button
                      class="inline-flex h-6 w-6 items-center justify-center rounded-full transition"
                      title="Add header"
                      onClick={() =>
                        updateActiveRequest((current) => {
                          current.headers = [
                            ...current.headers,
                            createKeyValueEntry(),
                          ];
                        })
                      }
                    >
                      <ControlDot variant="add" />
                    </button>
                  </Show>
                </div>

                <div
                  class={
                    topEditorTab() === "headers"
                      ? "relative overflow-visible"
                      : ""
                  }
                >
                  <Show when={activeRequest()}>
                    {(request) => (
                      <Switch>
                        <Match when={topEditorTab() === "headers"}>
                          <KeyValueTableEditor
                            rows={request().headers}
                            resizeStorageKey="devx-kv-request-headers"
                            valuePlaceholder=""
                            keySuggestions={commonHeaderKeys}
                            getValueSuggestions={(row) =>
                              commonHeaderValueMap[
                                row.key.trim().toLowerCase()
                              ] ?? [
                                "application/json",
                                "application/json; charset=utf-8",
                                "text/plain",
                              ]
                            }
                            onUpdate={(id, key, value) =>
                              updateActiveRequest((current) => {
                                current.headers = current.headers.map(
                                  (entry) =>
                                    entry.id === id
                                      ? { ...entry, [key]: value }
                                      : entry,
                                );
                              })
                            }
                            onToggle={(id) =>
                              updateActiveRequest((current) => {
                                current.headers = current.headers.map(
                                  (entry) =>
                                    entry.id === id
                                      ? { ...entry, enabled: !entry.enabled }
                                      : entry,
                                );
                              })
                            }
                            onRemove={(id) =>
                              updateActiveRequest((current) => {
                                current.headers = current.headers.filter(
                                  (entry) => entry.id !== id,
                                );
                              })
                            }
                            onAdd={() =>
                              updateActiveRequest((current) => {
                                current.headers = [
                                  ...current.headers,
                                  createKeyValueEntry(),
                                ];
                              })
                            }
                          />
                        </Match>

                        <Match when={topEditorTab() === "auth"}>
                          <div class="flex flex-wrap content-start gap-3">
                            <label class="theme-text-muted grid min-w-[220px] flex-1 gap-1.5 text-sm">
                              <span class="theme-text font-medium">
                                Auth Type
                              </span>
                              <select
                                class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                value={request().auth.type}
                                onInput={(event) =>
                                  updateActiveRequest((current) => {
                                    const nextType = event.currentTarget.value;
                                    if (nextType === "bearer") {
                                      current.auth = {
                                        type: "bearer",
                                        token: "",
                                      };
                                    } else if (nextType === "basic") {
                                      current.auth = {
                                        type: "basic",
                                        username: "",
                                        password: "",
                                      };
                                    } else if (nextType === "api-key") {
                                      current.auth = {
                                        type: "api-key",
                                        key: "x-api-key",
                                        value: "",
                                        addTo: "header",
                                      };
                                    } else {
                                      current.auth = { type: "none" };
                                    }
                                  })
                                }
                              >
                                <option value="none">None</option>
                                <option value="bearer">Bearer Token</option>
                                <option value="basic">Basic Auth</option>
                                <option value="api-key">API Key</option>
                              </select>
                            </label>

                            <Show when={request().auth.type === "none"}>
                              <div
                                class="theme-text-soft flex min-h-[72px] min-w-[220px] flex-1 items-center rounded-md border px-3 text-sm"
                                style={{
                                  "border-color": "var(--app-border)",
                                  background: "var(--app-panel-soft)",
                                }}
                              >
                                No authentication will be attached to this
                                request.
                              </div>
                            </Show>

                            <Show when={request().auth.type === "bearer"}>
                              <label class="theme-text-muted grid min-w-[220px] flex-1 gap-1.5 text-sm">
                                <span class="theme-text font-medium">
                                  Token
                                </span>
                                <input
                                  class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                  value={
                                      (() => {
                                        const auth = request().auth;
                                        return auth.type === "bearer"
                                          ? auth.token
                                          : "";
                                      })()
                                    }
                                  onInput={(event) =>
                                    updateActiveRequest((current) => {
                                      if (current.auth.type === "bearer") {
                                        current.auth = {
                                          ...current.auth,
                                          token: event.currentTarget.value,
                                        };
                                      }
                                    })
                                  }
                                />
                              </label>
                            </Show>

                            <Show when={request().auth.type === "basic"}>
                              <>
                                <label class="theme-text-muted grid min-w-[220px] flex-1 gap-1.5 text-sm">
                                  <span class="theme-text font-medium">
                                    Username
                                  </span>
                                  <input
                                    class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                    value={
                                      (() => {
                                        const auth = request().auth;
                                        return auth.type === "basic"
                                          ? auth.username
                                          : "";
                                      })()
                                    }
                                    onInput={(event) =>
                                      updateActiveRequest((current) => {
                                        if (current.auth.type === "basic") {
                                          current.auth = {
                                            ...current.auth,
                                            username: event.currentTarget.value,
                                          };
                                        }
                                      })
                                    }
                                  />
                                </label>
                                <label class="theme-text-muted grid min-w-[220px] flex-1 gap-1.5 text-sm">
                                  <span class="theme-text font-medium">
                                    Password
                                  </span>
                                  <input
                                    class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                    type="password"
                                    value={
                                      (() => {
                                        const auth = request().auth;
                                        return auth.type === "basic"
                                          ? auth.password
                                          : "";
                                      })()
                                    }
                                    onInput={(event) =>
                                      updateActiveRequest((current) => {
                                        if (current.auth.type === "basic") {
                                          current.auth = {
                                            ...current.auth,
                                            password: event.currentTarget.value,
                                          };
                                        }
                                      })
                                    }
                                  />
                                </label>
                              </>
                            </Show>

                            <Show when={request().auth.type === "api-key"}>
                              <>
                                <label class="theme-text-muted grid min-w-[200px] flex-1 gap-1.5 text-sm">
                                  <span class="theme-text font-medium">
                                    Key
                                  </span>
                                  <input
                                    class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                    value={
                                      (() => {
                                        const auth = request().auth;
                                        return auth.type === "api-key"
                                          ? auth.key
                                          : "";
                                      })()
                                    }
                                    onInput={(event) =>
                                      updateActiveRequest((current) => {
                                        if (current.auth.type === "api-key") {
                                          current.auth = {
                                            ...current.auth,
                                            key: event.currentTarget.value,
                                          };
                                        }
                                      })
                                    }
                                  />
                                </label>
                                <label class="theme-text-muted grid min-w-[200px] flex-1 gap-1.5 text-sm">
                                  <span class="theme-text font-medium">
                                    Value
                                  </span>
                                  <input
                                    class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                    value={
                                      (() => {
                                        const auth = request().auth;
                                        return auth.type === "api-key"
                                          ? auth.value
                                          : "";
                                      })()
                                    }
                                    onInput={(event) =>
                                      updateActiveRequest((current) => {
                                        if (current.auth.type === "api-key") {
                                          current.auth = {
                                            ...current.auth,
                                            value: event.currentTarget.value,
                                          };
                                        }
                                      })
                                    }
                                  />
                                </label>
                                <label class="theme-text-muted grid min-w-[160px] gap-1.5 text-sm">
                                  <span class="theme-text font-medium">
                                    Add To
                                  </span>
                                  <select
                                    class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                    value={
                                      (() => {
                                        const auth = request().auth;
                                        return auth.type === "api-key"
                                          ? auth.addTo
                                          : "header";
                                      })()
                                    }
                                    onInput={(event) =>
                                      updateActiveRequest((current) => {
                                        if (current.auth.type === "api-key") {
                                          current.auth = {
                                            ...current.auth,
                                            addTo: event.currentTarget.value as
                                              | "header"
                                              | "query",
                                          };
                                        }
                                      })
                                    }
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

              <div class="shrink-0 px-3 py-2">
                <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <EditorToggle
                      active={bottomEditorTab() === "body"}
                      label="Body"
                      onClick={() => setBottomEditorTab("body")}
                    />
                    <EditorToggle
                      active={bottomEditorTab() === "script"}
                      label="Script"
                      onClick={() => setBottomEditorTab("script")}
                    />
                  </div>
                  <Show when={bottomEditorTab() === "script"}>
                    <button
                      class="inline-flex h-6 w-6 items-center justify-center rounded-full transition"
                      title="Insert pre-request example"
                      onClick={() =>
                        updateActiveRequest((current) => {
                          current.scripts.preRequest = preRequestScriptExample;
                        })
                      }
                    >
                      <ControlDot variant="add" />
                    </button>
                  </Show>
                </div>

                <div>
                  <Show when={activeRequest()}>
                    {(request) => (
                      <Switch>
                        <Match when={bottomEditorTab() === "body"}>
                          <div class="flex w-full flex-col gap-3">
                            <div class="flex flex-wrap items-center justify-between gap-3">
                              <div class="flex flex-wrap items-center gap-2">
                                <select
                                  class="theme-input h-8 rounded-md px-2.5 py-1 text-sm"
                                  value={request().body.type}
                                  onInput={(event) => {
                                    const nextType = event.currentTarget
                                      .value as RequestBody["type"];
                                    updateActiveRequest((current) => {
                                      switch (nextType) {
                                        case "json":
                                          current.body = {
                                            type: "json",
                                            value: "{\n  \n}",
                                          };
                                          break;
                                        case "form-data":
                                          current.body = {
                                            type: "form-data",
                                            entries: [createKeyValueEntry()],
                                          };
                                          break;
                                        case "form-urlencoded":
                                          current.body = {
                                            type: "form-urlencoded",
                                            entries: [createKeyValueEntry()],
                                          };
                                          break;
                                        case "raw":
                                          current.body = {
                                            type: "raw",
                                            value: "",
                                            contentType: "text/plain",
                                          };
                                          break;
                                        case "binary":
                                          current.body = {
                                            type: "binary",
                                            value: "",
                                          };
                                          break;
                                        default:
                                          current.body = { type: "none" };
                                      }
                                    });
                                  }}
                                >
                                  <option value="none">None</option>
                                  <option value="json">JSON</option>
                                  <option value="form-data">Form Data</option>
                                  <option value="form-urlencoded">
                                    x-www-form-urlencoded
                                  </option>
                                  <option value="raw">Raw</option>
                                  <option value="binary">Binary</option>
                                </select>

                                <Show when={request().body.type === "json"}>
                                  <button
                                    class="theme-control inline-flex h-8 w-8 items-center justify-center rounded-md"
                                    title="Format JSON"
                                    onClick={() =>
                                      updateActiveRequest((current) => {
                                        if (current.body.type === "json") {
                                          current.body = {
                                            ...current.body,
                                            value: tryFormatJson(
                                              current.body.value,
                                            ),
                                          };
                                        }
                                      })
                                    }
                                  >
                                    <FormatJsonIcon />
                                  </button>
                                </Show>
                              </div>
                              <Show
                                when={
                                  request().body.type === "form-data" ||
                                  request().body.type === "form-urlencoded"
                                }
                              >
                                <button
                                  class="inline-flex h-6 w-6 items-center justify-center rounded-full transition"
                                  title="Add body row"
                                  onClick={() =>
                                    updateActiveRequest((current) => {
                                      if (
                                        current.body.type === "form-data" ||
                                        current.body.type === "form-urlencoded"
                                      ) {
                                        current.body = {
                                          ...current.body,
                                          entries: [
                                            ...current.body.entries,
                                            createKeyValueEntry(),
                                          ],
                                        };
                                      }
                                    })
                                  }
                                >
                                  <ControlDot variant="add" />
                                </button>
                              </Show>
                            </div>

                            <Show
                              when={
                                request().body.type === "json" ||
                                request().body.type === "raw"
                              }
                            >
                              <textarea
                                class="theme-input w-full rounded-[18px] px-3 py-2.5 font-mono text-sm leading-6 transition"
                                style={{ "min-height": "calc(100dvh - 320px)" }}
                                value={
                                  (() => {
                                    const body = request().body;
                                    return body.type === "json" ||
                                      body.type === "raw"
                                      ? body.value
                                      : "";
                                  })()
                                }
                                onInput={(event) =>
                                  updateActiveRequest((current) => {
                                    if (
                                      current.body.type === "json" ||
                                      current.body.type === "raw"
                                    ) {
                                      current.body = {
                                        ...current.body,
                                        value: event.currentTarget.value,
                                      };
                                    }
                                  })
                                }
                              />
                            </Show>

                            <Show when={request().body.type === "binary"}>
                              <textarea
                                class="theme-input w-full rounded-[18px] px-3 py-2.5 font-mono text-sm leading-6 transition"
                                style={{ "min-height": "calc(100dvh - 320px)" }}
                                placeholder="Paste base64 payload"
                                value={
                                  (() => {
                                    const body = request().body;
                                    return body.type === "binary"
                                      ? body.value
                                      : "";
                                  })()
                                }
                                onInput={(event) =>
                                  updateActiveRequest((current) => {
                                    if (current.body.type === "binary") {
                                      current.body = {
                                        ...current.body,
                                        value: event.currentTarget.value,
                                      };
                                    }
                                  })
                                }
                              />
                            </Show>

                            <Show when={request().body.type === "form-data"}>
                              <FormDataTableEditor
                                rows={
                                  (() => {
                                    const body = request().body;
                                    return body.type === "form-data"
                                      ? body.entries
                                      : [];
                                  })()
                                }
                                resizeStorageKey="devx-kv-body-form-data"
                                onUpdate={(id, patch) =>
                                  updateActiveRequest((current) => {
                                    if (current.body.type === "form-data") {
                                      current.body = {
                                        ...current.body,
                                        entries: current.body.entries.map(
                                          (entry) =>
                                            entry.id === id
                                              ? { ...entry, ...patch }
                                              : entry,
                                        ),
                                      };
                                    }
                                  })
                                }
                                onToggle={(id) =>
                                  updateActiveRequest((current) => {
                                    if (current.body.type === "form-data") {
                                      current.body = {
                                        ...current.body,
                                        entries: current.body.entries.map(
                                          (entry) =>
                                            entry.id === id
                                              ? {
                                                  ...entry,
                                                  enabled: !entry.enabled,
                                                }
                                              : entry,
                                        ),
                                      };
                                    }
                                  })
                                }
                                onRemove={(id) =>
                                  updateActiveRequest((current) => {
                                    if (current.body.type === "form-data") {
                                      current.body = {
                                        ...current.body,
                                        entries: current.body.entries.filter(
                                          (entry) => entry.id !== id,
                                        ),
                                      };
                                    }
                                  })
                                }
                              />
                            </Show>

                            <Show
                              when={request().body.type === "form-urlencoded"}
                            >
                              <KeyValueTableEditor
                                rows={
                                  (() => {
                                    const body = request().body;
                                    return body.type === "form-urlencoded"
                                      ? body.entries
                                      : [];
                                  })()
                                }
                                resizeStorageKey="devx-kv-body-form-urlencoded"
                                onUpdate={(id, key, value) =>
                                  updateActiveRequest((current) => {
                                    if (
                                      current.body.type === "form-urlencoded"
                                    ) {
                                      current.body = {
                                        ...current.body,
                                        entries: current.body.entries.map(
                                          (entry) =>
                                            entry.id === id
                                              ? { ...entry, [key]: value }
                                              : entry,
                                        ),
                                      };
                                    }
                                  })
                                }
                                onToggle={(id) =>
                                  updateActiveRequest((current) => {
                                    if (
                                      current.body.type === "form-urlencoded"
                                    ) {
                                      current.body = {
                                        ...current.body,
                                        entries: current.body.entries.map(
                                          (entry) =>
                                            entry.id === id
                                              ? {
                                                  ...entry,
                                                  enabled: !entry.enabled,
                                                }
                                              : entry,
                                        ),
                                      };
                                    }
                                  })
                                }
                                onRemove={(id) =>
                                  updateActiveRequest((current) => {
                                    if (
                                      current.body.type === "form-urlencoded"
                                    ) {
                                      current.body = {
                                        ...current.body,
                                        entries: current.body.entries.filter(
                                          (entry) => entry.id !== id,
                                        ),
                                      };
                                    }
                                  })
                                }
                              />
                            </Show>
                          </div>
                        </Match>

                        <Match when={bottomEditorTab() === "script"}>
                          <div class="flex w-full flex-col gap-3">
                            <div
                              class="theme-panel-soft rounded-[18px] border px-3 py-3"
                              style={{ "border-color": "var(--app-border)" }}
                            >
                              <div class="mb-2 flex items-center justify-between gap-2">
                                <div>
                                  <p class="theme-text text-sm font-semibold">
                                    Pre-request Script
                                  </p>
                                  <p class="theme-text-soft text-xs">
                                    Run JavaScript before the request is sent.
                                  </p>
                                </div>
                                <AppButton
                                  variant="default"
                                  class="rounded-md px-2.5 py-1 text-xs font-medium"
                                  onClick={() =>
                                    updateActiveRequest((current) => {
                                      current.scripts.preRequest =
                                        preRequestScriptExample;
                                    })
                                  }
                                >
                                  Use Example
                                </AppButton>
                              </div>
                              <textarea
                                class="theme-input min-h-[280px] w-full rounded-[18px] px-3 py-2.5 font-mono text-sm leading-6 transition"
                                placeholder={preRequestScriptExample}
                                style={{
                                  height: `${preRequestScriptHeight()}px`,
                                }}
                                value={request().scripts.preRequest}
                                onInput={(event) =>
                                  updateActiveRequest((current) => {
                                    current.scripts.preRequest =
                                      event.currentTarget.value;
                                  })
                                }
                                onMouseUp={(event) =>
                                  persistScriptEditorHeight(
                                    event,
                                    preRequestScriptHeightStorageKey,
                                    setPreRequestScriptHeight,
                                  )
                                }
                                onBlur={(event) =>
                                  persistScriptEditorHeight(
                                    event,
                                    preRequestScriptHeightStorageKey,
                                    setPreRequestScriptHeight,
                                  )
                                }
                              />
                            </div>

                            <div
                              class="theme-panel-soft rounded-[18px] border px-3 py-3"
                              style={{ "border-color": "var(--app-border)" }}
                            >
                              <div class="mb-2 flex items-center justify-between gap-2">
                                <div>
                                  <p class="theme-text text-sm font-semibold">
                                    Post-response Script
                                  </p>
                                  <p class="theme-text-soft text-xs">
                                    Run JavaScript after the response returns
                                    and persist useful values.
                                  </p>
                                </div>
                                <AppButton
                                  variant="default"
                                  class="rounded-md px-2.5 py-1 text-xs font-medium"
                                  onClick={() =>
                                    updateActiveRequest((current) => {
                                      current.scripts.postResponse =
                                        postResponseScriptExample;
                                    })
                                  }
                                >
                                  Use Example
                                </AppButton>
                              </div>
                              <textarea
                                class="theme-input min-h-[280px] w-full rounded-[18px] px-3 py-2.5 font-mono text-sm leading-6 transition"
                                placeholder={postResponseScriptExample}
                                style={{
                                  height: `${postResponseScriptHeight()}px`,
                                }}
                                value={request().scripts.postResponse}
                                onInput={(event) =>
                                  updateActiveRequest((current) => {
                                    current.scripts.postResponse =
                                      event.currentTarget.value;
                                  })
                                }
                                onMouseUp={(event) =>
                                  persistScriptEditorHeight(
                                    event,
                                    postResponseScriptHeightStorageKey,
                                    setPostResponseScriptHeight,
                                  )
                                }
                                onBlur={(event) =>
                                  persistScriptEditorHeight(
                                    event,
                                    postResponseScriptHeightStorageKey,
                                    setPostResponseScriptHeight,
                                  )
                                }
                              />
                            </div>
                          </div>
                        </Match>
                      </Switch>
                    )}
                  </Show>
                </div>
              </div>
            </div>

            <div
              class="api-main-pane-resizer relative cursor-col-resize select-none"
              aria-hidden="true"
              onMouseDown={startMainPaneResize}
            >
              <div
                class={`absolute inset-y-0 left-0 w-px transition ${
                  mainPaneResizing() ? "bg-[var(--app-accent)]" : ""
                }`}
                style={{
                  background: mainPaneResizing()
                    ? "var(--app-accent)"
                    : "color-mix(in srgb, var(--app-accent) 28%, var(--app-border))",
                }}
              />
            </div>

            <div
              class="flex min-h-0 flex-col px-3 py-2"
              style={{ "min-height": "calc(100dvh - 128px)" }}
            >
              <Show when={responseError()}>
                <div
                  class="mb-3 border px-4 py-3 text-sm theme-warn"
                  style={{ "border-color": "var(--app-border)" }}
                >
                  {responseError()}
                </div>
              </Show>

              <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-1.5">
                  <EditorToggle
                    active={responseTab() === "body"}
                    label="Body"
                    onClick={() => setResponseTab("body")}
                  />
                  <EditorToggle
                    active={responseTab() === "headers"}
                    label="Headers"
                    onClick={() => setResponseTab("headers")}
                  />
                  <Show
                    when={responseTab() === "body" && responsePreviewKind()}
                  >
                    <button
                      class={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                        responseBodyView() === "preview"
                          ? "bg-[var(--app-method-delete-bg)] text-[var(--app-method-delete)]"
                          : "bg-[var(--app-method-get-bg)] text-[var(--app-method-get)]"
                      }`}
                      onClick={() =>
                        setResponseBodyView((current) =>
                          current === "preview" ? "raw" : "preview",
                        )
                      }
                    >
                      Preview
                    </button>
                  </Show>
                </div>
                <Show when={responseSummary()}>
                  {(summary) => (
                    <div class="theme-text-soft flex flex-wrap items-center gap-2 text-sm">
                      <span
                        class={`font-semibold ${getResponseStatusClass(summary().status)}`}
                      >
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
                    <Switch>
                      <Match
                        when={
                          responseBodyView() === "preview" &&
                          responsePreviewKind() === "json" &&
                          responsePreviewJson() !== null
                        }
                      >
                        <div
                          class="theme-code flex h-full min-h-[240px] flex-col overflow-auto rounded-[20px] border px-3 py-3"
                          style={{ "border-color": "var(--app-border)" }}
                        >
                          <JsonPreviewNode value={responsePreviewJson()} />
                        </div>
                      </Match>
                      <Match
                        when={
                          responseBodyView() === "preview" &&
                          responsePreviewKind() === "html" &&
                          responseSummary()
                        }
                      >
                        <div
                          class="theme-code flex h-full min-h-[240px] flex-col overflow-hidden rounded-[20px] border"
                          style={{ "border-color": "var(--app-border)" }}
                        >
                          <iframe
                            class="h-full min-h-[240px] w-full border-0 bg-white"
                            sandbox=""
                            srcdoc={responseSummary()?.body ?? ""}
                            title="HTML preview"
                          />
                        </div>
                      </Match>
                      <Match
                        when={
                          responseBodyView() === "preview" &&
                          responsePreviewKind() === "json" &&
                          responsePreviewJson() === null
                        }
                      >
                        <div
                          class="theme-code flex h-full min-h-[240px] items-center rounded-[20px] border px-4 text-sm theme-text-soft"
                          style={{ "border-color": "var(--app-border)" }}
                        >
                          JSON preview is unavailable because the response body
                          could not be parsed.
                        </div>
                      </Match>
                      <Match when={true}>
                        <div
                          class="theme-code flex h-full min-h-[240px] flex-col overflow-hidden rounded-[20px] border"
                          style={{ "border-color": "var(--app-border)" }}
                        >
                          <Show
                            when={
                              responseSummary() &&
                              isJsonContentType(responseSummary()!.contentType)
                            }
                            fallback={
                              <pre class="theme-text-muted h-full flex-1 overflow-x-auto px-3 py-3 font-mono text-sm leading-7">
                                <code>
                                  {responseSummary()?.body ??
                                    "Send a request to inspect the response body."}
                                </code>
                              </pre>
                            }
                          >
                            <JsonHighlightedCode
                              value={responseSummary()?.body ?? ""}
                            />
                          </Show>
                        </div>
                      </Match>
                    </Switch>
                  </Match>
                  <Match when={responseTab() === "headers"}>
                    <div class="min-h-[240px]">
                      <KeyValueTableEditor
                        rows={responseSummary()?.headers ?? []}
                        resizeStorageKey="devx-kv-response-headers"
                        readOnly
                      />
                    </div>
                  </Match>
                </Switch>
              </div>
            </div>
          </div>
        </Show>
      </WorkspaceSidebarLayout>

      <Show when={requestTabMenuState() && currentTabMenuRequest()}>
        <div
          class="theme-panel-soft fixed z-[400] inline-grid auto-cols-max overflow-hidden rounded-[18px] border p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
          data-rest-menu-root
          style={{
            "border-color": "var(--app-border)",
            left: `${requestTabMenuState()!.x}px`,
            top: `${requestTabMenuState()!.y}px`,
          }}
        >
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => {
              togglePinnedRequestTab(currentTabMenuRequest()!.id);
              setRequestTabMenuState(null);
            }}
          >
            {workspace.pinnedRequestIds.includes(currentTabMenuRequest()!.id)
              ? "UnPin"
              : "Pin"}
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() => closeOtherTabs(currentTabMenuRequest()!.id)}
          >
            Close Others
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={closeAllTabs}
          >
            Close All
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() =>
              closeTabsToDirection(currentTabMenuRequest()!.id, "right")
            }
          >
            Close Right
          </button>
          <button
            class="theme-sidebar-item whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm"
            onClick={() =>
              closeTabsToDirection(currentTabMenuRequest()!.id, "left")
            }
          >
            Close Left
          </button>
        </div>
      </Show>

      <Show when={curlImportCollectionId()}>
        <div class="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(15,23,42,0.28)] px-4">
          <div
            class="theme-panel-strong z-50 w-full max-w-2xl rounded-2xl border p-5"
            style={{ "border-color": "var(--app-border)" }}
          >
            <div class="mb-4 flex items-start justify-between gap-4">
              <div class="space-y-1">
                <p class="theme-eyebrow text-[10px] font-semibold uppercase tracking-[0.18em]">
                  Import
                </p>
                <h3 class="theme-text text-lg font-semibold">
                  Parse cURL Into Request
                </h3>
                <p class="theme-text-soft text-sm">
                  Paste a cURL command and generate a new request in the
                  selected collection.
                </p>
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
                <button
                  class="theme-button-primary rounded-lg px-4 py-2 text-sm font-semibold"
                  onClick={commitCurlImport}
                >
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
