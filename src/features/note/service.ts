import { makeId } from "../../lib/utils";
import { loadNoteState, saveNoteState } from "./local-db";
import type { NoteItem, NoteState } from "./models";

function normalizeNote(note: NoteItem): NoteItem {
  return {
    ...note,
    title: note.title?.trim() || "Untitled",
    content: note.content ?? "",
    pinned: note.pinned ?? false,
    tags: Array.isArray(note.tags) ? note.tags : [],
    createdAt: note.createdAt || new Date().toISOString(),
    updatedAt: note.updatedAt || new Date().toISOString(),
  };
}

function normalizeState(state: NoteState): NoteState {
  return {
    notes: (state.notes ?? []).map(normalizeNote),
  };
}

export { saveNoteState };

export async function loadNotes(): Promise<NoteState> {
  const stored = await loadNoteState();
  const normalized = normalizeState(stored ?? { notes: [] });

  if (!stored || JSON.stringify(stored) !== JSON.stringify(normalized)) {
    await saveNoteState(normalized);
  }

  return normalized;
}

export async function addNote(title: string = "", content: string = ""): Promise<NoteState> {
  const state = await loadNotes();
  const now = new Date().toISOString();
  const note: NoteItem = {
    id: makeId("note"),
    title: title.trim() || "Untitled",
    content,
    pinned: false,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  const next = { ...state, notes: [note, ...state.notes] };
  await saveNoteState(next);
  return next;
}

export async function updateNote(updated: NoteItem): Promise<NoteState> {
  const state = await loadNotes();
  const next = {
    ...state,
    notes: state.notes.map((note) =>
      note.id === updated.id
        ? normalizeNote({ ...updated, updatedAt: new Date().toISOString() })
        : note,
    ),
  };
  await saveNoteState(next);
  return next;
}

export async function toggleNotePin(noteId: string): Promise<NoteState> {
  const state = await loadNotes();
  const next = {
    ...state,
    notes: state.notes.map((note) =>
      note.id === noteId
        ? { ...note, pinned: !note.pinned, updatedAt: new Date().toISOString() }
        : note,
    ),
  };
  await saveNoteState(next);
  return next;
}

export async function deleteNote(noteId: string): Promise<NoteState> {
  const state = await loadNotes();
  const next = { ...state, notes: state.notes.filter((note) => note.id !== noteId) };
  await saveNoteState(next);
  return next;
}
