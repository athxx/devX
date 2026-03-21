import { readDevxSection, writeDevxSection } from "../../lib/indexed-db";

export async function loadDbWorkspaceFromDb(): Promise<unknown | null> {
  return (await readDevxSection<unknown>(["db"])) ?? null;
}

export async function saveDbWorkspaceToDb(workspace: unknown): Promise<void> {
  await writeDevxSection(["db"], workspace);
}
