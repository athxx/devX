import { loadIndexedDbValue, saveIndexedDbValue } from "../../lib/indexed-db";
import { withLegacyStore } from "../../lib/legacy-db";
import type { AppSettings } from "../../lib/storage";

const PROXY_SETTINGS_KEY = "proxy-settings";
const LEGACY_DB_NAME = "devx-settings-db";
const LEGACY_STORE_NAME = "settings";

export async function loadProxySettingsFromDb(): Promise<AppSettings["proxy"] | undefined> {
  const current = await loadIndexedDbValue<AppSettings["proxy"]>(PROXY_SETTINGS_KEY);

  if (current) {
    return current;
  }

  try {
    const legacy = await withLegacyStore<AppSettings["proxy"] | undefined>(LEGACY_DB_NAME, LEGACY_STORE_NAME, "readonly", (store) =>
      store.get(PROXY_SETTINGS_KEY)
    );

    if (legacy) {
      await saveIndexedDbValue(PROXY_SETTINGS_KEY, legacy);
    }

    return legacy;
  } catch {
    return undefined;
  }
}

export async function saveProxySettingsToDb(settings: AppSettings["proxy"]): Promise<void> {
  await saveIndexedDbValue(PROXY_SETTINGS_KEY, settings);
}
