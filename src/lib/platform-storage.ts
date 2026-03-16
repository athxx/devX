type StorageArea = "local" | "sync";

function getChromeStorageArea(area: StorageArea) {
  if (typeof chrome === "undefined" || !chrome.storage) {
    return null;
  }

  return area === "sync" ? chrome.storage.sync : chrome.storage.local;
}

export async function getStoredValue<T>(
  key: string,
  area: StorageArea = "local"
): Promise<T | undefined> {
  const chromeArea = getChromeStorageArea(area);

  if (chromeArea) {
    const result = await chromeArea.get(key);
    return result[key] as T | undefined;
  }

  if (typeof window === "undefined") {
    return undefined;
  }

  const raw = window.localStorage.getItem(`${area}:${key}`);

  if (!raw) {
    return undefined;
  }

  return JSON.parse(raw) as T;
}

export async function setStoredValue<T>(
  key: string,
  value: T,
  area: StorageArea = "local"
): Promise<void> {
  const chromeArea = getChromeStorageArea(area);

  if (chromeArea) {
    await chromeArea.set({
      [key]: value
    });
    return;
  }

  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(`${area}:${key}`, JSON.stringify(value));
}

export async function removeStoredValue(key: string, area: StorageArea = "local"): Promise<void> {
  const chromeArea = getChromeStorageArea(area);

  if (chromeArea) {
    await chromeArea.remove(key);
    return;
  }

  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(`${area}:${key}`);
}
