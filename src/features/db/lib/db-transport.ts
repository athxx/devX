import { loadProxySettings } from "../../proxy/service";
import type { DbConnection, DbConnectionKind, DbResultPayload } from "../models";

export type DbSocketResponse = {
  id?: string;
  type?: string;
  error?: string;
  data?: unknown;
};

export type DbSocketCommandMessage = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
};

type PendingDbSocketRequest = {
  kind: DbConnectionKind;
  resolve: (value: DbResultPayload) => void;
  reject: (reason?: unknown) => void;
};

let dbRelaySocket: WebSocket | null = null;
let dbRelaySocketUrl: string | null = null;
let dbRelaySocketPromise: Promise<WebSocket> | null = null;
const pendingDbSocketRequests = new Map<string, PendingDbSocketRequest>();

export async function buildDbRelayUrl(): Promise<string | null> {
  const settings = await loadProxySettings();
  if (settings.db.mode !== "proxy" || !settings.db.address.trim()) {
    return null;
  }

  const normalized = settings.db.address
    .trim()
    .replace(/\/+$/, "")
    .replace(/^http:/i, "ws:")
    .replace(/^https:/i, "wss:");

  try {
    const url = new URL(normalized);
    url.searchParams.set("x-ason-proxy", "devx");
    return url.toString();
  } catch {
    const separator = normalized.includes("?") ? "&" : "?";
    return `${normalized}${separator}x-ason-proxy=devx`;
  }
}

export async function executeDbSocketCommand(
  message: DbSocketCommandMessage,
  connection: Pick<DbConnection, "kind">,
): Promise<DbResultPayload> {
  const relayUrl = await buildDbRelayUrl();
  if (!relayUrl) {
    throw new Error("DB Proxy is not configured, please go to Settings → Proxy");
  }

  const ws = await getDbRelaySocket(relayUrl);

  return new Promise<DbResultPayload>((resolve, reject) => {
    pendingDbSocketRequests.set(message.id, {
      kind: connection.kind,
      resolve,
      reject,
    });

    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      pendingDbSocketRequests.delete(message.id);
      reject(
        error instanceof Error ? error : new Error("DB websocket send failed"),
      );
    }
  });
}

function rejectPendingDbSocketRequests(error: Error) {
  for (const [id, pending] of pendingDbSocketRequests.entries()) {
    pending.reject(error);
    pendingDbSocketRequests.delete(id);
  }
}

async function getDbRelaySocket(relayUrl: string): Promise<WebSocket> {
  if (
    dbRelaySocket &&
    dbRelaySocket.readyState === WebSocket.OPEN &&
    dbRelaySocketUrl === relayUrl
  ) {
    return dbRelaySocket;
  }

  if (dbRelaySocketPromise && dbRelaySocketUrl === relayUrl) {
    return dbRelaySocketPromise;
  }

  if (dbRelaySocket && dbRelaySocket.readyState <= WebSocket.OPEN) {
    dbRelaySocket.close();
  }

  dbRelaySocketUrl = relayUrl;
  dbRelaySocketPromise = new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(relayUrl);

    ws.onopen = () => {
      dbRelaySocket = ws;
      resolve(ws);
    };

    ws.onmessage = (event) => {
      let response: DbSocketResponse;

      try {
        response = JSON.parse(event.data as string) as DbSocketResponse;
      } catch {
        return;
      }

      if (!response.id) {
        return;
      }

      const pending = pendingDbSocketRequests.get(response.id);
      if (!pending) {
        return;
      }

      pendingDbSocketRequests.delete(response.id);

      if (response.type === "error") {
        pending.reject(new Error(response.error || "DB relay error"));
        return;
      }

      pending.resolve({
        kind:
          pending.kind === "redis"
            ? "redis"
            : pending.kind === "mongodb"
              ? "mongo"
              : "sql",
        data: (response.data ?? {}) as Record<string, unknown>,
      } as DbResultPayload);
    };

    ws.onerror = () => {
      const error = new Error("DB websocket error");
      if (dbRelaySocket === ws) {
        dbRelaySocket = null;
      }
      dbRelaySocketPromise = null;
      rejectPendingDbSocketRequests(error);
      reject(error);
    };

    ws.onclose = () => {
      if (dbRelaySocket === ws) {
        dbRelaySocket = null;
      }
      dbRelaySocketPromise = null;
      rejectPendingDbSocketRequests(
        new Error("DB websocket closed unexpectedly"),
      );
    };
  });

  try {
    return await dbRelaySocketPromise;
  } finally {
    dbRelaySocketPromise = null;
  }
}
