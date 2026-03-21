import type { AppSettings } from "../../lib/storage";
import { loadProxySettingsFromDb, saveProxySettingsToDb } from "./local-db";

export type ProxyTarget = "api" | "db" | "ssh";

function normalizeAddress(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const withProtocol = /^[a-z][a-z0-9+\-.]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    const isLocalHost =
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "0.0.0.0" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1";

    if (isLocalHost && !url.port) {
      url.port = "8787";
    }

    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
  } catch {
    return withProtocol.replace(/\/+$/, "");
  }
}

export function getDefaultProxyAddress(target: ProxyTarget) {
  switch (target) {
    case "db":
      return "ws://127.0.0.1:8787/db";
    case "ssh":
      return "ws://127.0.0.1:8787/ssh";
    case "api":
    default:
      return "http://127.0.0.1:8787/api";
  }
}

export function getProxyTestUrl(value: string) {
  const address = normalizeAddress(value);
  return address ? `${address}/` : "";
}

export async function loadProxySettings(): Promise<AppSettings["proxy"]> {
  const stored = await loadProxySettingsFromDb();

  if (stored) {
    return {
      api: {
        ...defaultProxySettings.api,
        ...stored.api,
        address: normalizeAddress(stored.api?.address ?? "")
      },
      db: {
        ...defaultProxySettings.db,
        ...stored.db,
        mode: "proxy",
        address: normalizeAddress(stored.db?.address ?? "")
      },
      ssh: {
        ...defaultProxySettings.ssh,
        ...stored.ssh,
        mode: "proxy",
        address: normalizeAddress(stored.ssh?.address ?? "")
      }
    };
  }

  const seed = {
    api: {
      ...defaultProxySettings.api,
      address: normalizeAddress(defaultProxySettings.api.address)
    },
    db: {
      ...defaultProxySettings.db,
      mode: "proxy",
      address: normalizeAddress(defaultProxySettings.db.address)
    },
    ssh: {
      ...defaultProxySettings.ssh,
      mode: "proxy",
      address: normalizeAddress(defaultProxySettings.ssh.address)
    }
  } satisfies AppSettings["proxy"];

  await saveProxySettingsToDb(seed);
  return seed;
}

export async function saveProxySettings(proxy: AppSettings["proxy"]): Promise<AppSettings["proxy"]> {
  const nextSettings: AppSettings["proxy"] = {
    api: {
      ...defaultProxySettings.api,
      ...proxy.api,
      address: normalizeAddress(proxy.api.address)
    },
    db: {
      ...defaultProxySettings.db,
      ...proxy.db,
      mode: "proxy",
      address: normalizeAddress(proxy.db.address)
    },
    ssh: {
      ...defaultProxySettings.ssh,
      ...proxy.ssh,
      mode: "proxy",
      address: normalizeAddress(proxy.ssh.address)
    }
  };

  await saveProxySettingsToDb(nextSettings);
  return nextSettings;
}

export async function testProxyConnection(
  address: string,
  proxyTarget: ProxyTarget
): Promise<{ ok: true; status: number }> {
  const normalizedAddress = normalizeAddress(address);

  if (!normalizedAddress) {
    throw new Error("Proxy address is required.");
  }

  if (proxyTarget === "db" || proxyTarget === "ssh") {
    const wsHttpProbe = normalizedAddress.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
    const response = await fetch(wsHttpProbe, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      headers: {
        "x-ason-proxy": "devx"
      }
    });

    if (!response.ok && response.status !== 426) {
      throw new Error(`Proxy test failed with status ${response.status}.`);
    }

    return {
      ok: true,
      status: response.status
    };
  }

  const proxyEndpoint = normalizedAddress;
  const endpointUrl = new URL(proxyEndpoint);
  const upstreamUrl = `${endpointUrl.origin}/`;

  await fetch(proxyEndpoint, {
    method: "OPTIONS",
    mode: "cors",
    cache: "no-store"
  });

  const response = await fetch(proxyEndpoint, {
    method: "GET",
    mode: "cors",
    cache: "no-store",
    headers: {
      "x-ason-proxy": "devx",
      "x-ason-url": upstreamUrl
    }
  });

  if (!response.ok) {
    throw new Error(`Proxy test failed with status ${response.status}.`);
  }

  return {
    ok: true,
    status: response.status
  };
}

const defaultProxySettings: AppSettings["proxy"] = {
  api: {
    mode: "none",
    address: ""
  },
  db: {
    mode: "none",
    address: ""
  },
  ssh: {
    mode: "none",
    address: ""
  }
};
