import { readDevxSection, writeDevxSection } from "../../lib/indexed-db";
import type { NoteState } from "./models";

export async function loadNoteState(): Promise<NoteState | null> {
  return (await readDevxSection<NoteState>(["note"])) ?? null;
}

export async function saveNoteState(state: NoteState): Promise<void> {
  await writeDevxSection(["note"], state);
}

export async function loadNoteUiTempState<T>(key: string): Promise<T | undefined> {
  return readDevxSection<T>(["temp", "noteUi", key]);
}

export async function saveNoteUiTempState<T>(key: string, value: T): Promise<void> {
  await writeDevxSection(["temp", "noteUi", key], value);
}
