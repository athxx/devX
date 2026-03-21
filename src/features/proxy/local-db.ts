import { readDevxSection, writeDevxSection } from "../../lib/indexed-db";
import type { AppSettings } from "../../lib/storage";

export async function loadProxySettingsFromDb(): Promise<AppSettings["proxy"] | undefined> {
  return readDevxSection<AppSettings["proxy"]>(["settings", "proxy"]);
}

export async function saveProxySettingsToDb(settings: AppSettings["proxy"]): Promise<void> {
  await writeDevxSection(["settings", "proxy"], settings);
}
