import { loadSettings, saveSettings, type AppSettings } from "../../lib/storage";

export type ProxyTarget = "api" | "db" | "ssh";

function normalizeAddress(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function getProxyTestUrl(value: string) {
  const address = normalizeAddress(value);
  return address ? `${address}/` : "";
}

export async function loadProxySettings(): Promise<AppSettings["proxy"]> {
  const settings = await loadSettings();
  return settings.proxy;
}

export async function saveProxySettings(proxy: AppSettings["proxy"]): Promise<AppSettings["proxy"]> {
  const settings = await loadSettings();
  const nextSettings: AppSettings = {
    ...settings,
    proxy: {
      api: {
        ...proxy.api,
        address: normalizeAddress(proxy.api.address)
      },
      db: {
        ...proxy.db,
        address: normalizeAddress(proxy.db.address)
      },
      ssh: {
        ...proxy.ssh,
        address: normalizeAddress(proxy.ssh.address)
      }
    }
  };

  await saveSettings(nextSettings);
  return nextSettings.proxy;
}

export async function testProxyConnection(address: string): Promise<{ ok: true; status: number }> {
  const target = getProxyTestUrl(address);

  if (!target) {
    throw new Error("Proxy address is required.");
  }

  const response = await fetch(target, {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`Proxy test failed with status ${response.status}.`);
  }

  return {
    ok: true,
    status: response.status
  };
}
