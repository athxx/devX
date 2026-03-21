import { readDevxSection, writeDevxSection } from "../../lib/indexed-db";
import type { RestWorkspaceState } from "./models";

export async function loadRestWorkspaceFromDb(): Promise<RestWorkspaceState | undefined> {
  return readDevxSection<RestWorkspaceState>(["api"]);
}

export async function saveRestWorkspaceToDb(state: RestWorkspaceState): Promise<void> {
  await writeDevxSection(["api"], state);
}
