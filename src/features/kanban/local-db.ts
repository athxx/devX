import { readDevxSection, writeDevxSection } from "../../lib/indexed-db";
import type { KanbanState } from "./models";

export async function loadKanbanState(): Promise<KanbanState | null> {
  return (await readDevxSection<KanbanState>(["kanban"])) ?? null;
}

export async function saveKanbanState(state: KanbanState): Promise<void> {
  await writeDevxSection(["kanban"], state);
}

export async function loadKanbanUiTempState<T>(key: string): Promise<T | undefined> {
  return readDevxSection<T>(["temp", "kanbanUi", key]);
}

export async function saveKanbanUiTempState<T>(key: string, value: T): Promise<void> {
  await writeDevxSection(["temp", "kanbanUi", key], value);
}
