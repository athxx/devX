import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { ControlDot } from "../../../components/ui-primitives";
import { WorkspaceSidebarLayout } from "../../../components/workspace-sidebar-layout";
import type { NoteItem, NoteState } from "../models";
import {
  addNote,
  deleteNote,
  loadNotes,
  toggleNotePin,
  updateNote,
} from "../service";

type NotePanelProps = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarResizing: boolean;
  onSidebarResizeStart: (event: MouseEvent) => void;
};

export function NotePanel(props: NotePanelProps) {
  const [state, setState] = createSignal<NoteState>({ notes: [] });
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [search, setSearch] = createSignal("");
  const [menuId, setMenuId] = createSignal<string | null>(null);
  const [editTitle, setEditTitle] = createSignal("");
  const [editContent, setEditContent] = createSignal("");
  const [editTags, setEditTags] = createSignal("");

  onMount(() => {
    void loadNotes().then((loaded) => {
      setState(loaded);
      if (loaded.notes.length > 0) {
        selectNote(loaded.notes[0]);
      }
    });
  });

  const filteredNotes = createMemo(() => {
    const q = search().trim().toLowerCase();
    const notes = state().notes;
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)),
    );
  });

  const sortedNotes = createMemo(() => {
    const notes = filteredNotes();
    const pinned = notes.filter((n) => n.pinned);
    const unpinned = notes.filter((n) => !n.pinned);
    return [...pinned, ...unpinned];
  });

  const activeNote = createMemo(() => {
    const id = activeId();
    return id ? state().notes.find((n) => n.id === id) ?? null : null;
  });

  function selectNote(note: NoteItem | null) {
    if (!note) {
      setActiveId(null);
      return;
    }
    setActiveId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditTags(note.tags.join(", "));
  }

  const handleNew = async () => {
    const next = await addNote("Untitled", "");
    setState(next);
    selectNote(next.notes[0]);
  };

  const handleSave = async () => {
    const note = activeNote();
    if (!note) return;
    const tags = editTags()
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const next = await updateNote({
      ...note,
      title: editTitle().trim() || "Untitled",
      content: editContent(),
      tags,
    });
    setState(next);
  };

  const handleTogglePin = async (noteId: string) => {
    const next = await toggleNotePin(noteId);
    setState(next);
    setMenuId(null);
  };

  const handleDelete = async (noteId: string) => {
    const next = await deleteNote(noteId);
    setState(next);
    setMenuId(null);
    if (activeId() === noteId) {
      selectNote(next.notes[0] ?? null);
    }
  };

  function formatTime(iso: string) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  return (
    <WorkspaceSidebarLayout
      sidebarOpen={props.sidebarOpen}
      sidebarWidth={props.sidebarWidth}
      sidebarResizing={props.sidebarResizing}
      onResizeStart={props.onSidebarResizeStart}
      contentClass="theme-workspace-pane min-h-0 flex flex-col border-l"
      contentStyle={{ "border-color": "var(--app-border)" }}
      sidebar={
        <>
          <div
            class="mb-4 flex items-center justify-between border-b pb-3"
            style={{ "border-color": "var(--app-border)" }}
          >
            <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.24em]">
              Notes
            </p>
            <button
              class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
              title="新建笔记"
              onClick={() => void handleNew()}
            >
              <ControlDot size="small" variant="add" />
            </button>
          </div>

          <div class="mb-3">
            <input
              class="theme-input h-8 w-full rounded-md px-2.5 text-sm"
              placeholder="搜索笔记..."
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </div>

          <div class="flex flex-1 flex-col gap-0.5 overflow-y-auto">
            <For each={sortedNotes()}>
              {(note) => (
                <div
                  class={`group theme-sidebar-item flex min-w-0 cursor-pointer flex-col rounded-lg px-2.5 py-2 text-left ${
                    activeId() === note.id ? "theme-sidebar-item-active" : ""
                  }`}
                  onClick={() => selectNote(note)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenuId(menuId() === note.id ? null : note.id);
                  }}
                >
                  <div class="flex items-center justify-between gap-1">
                    <div class="flex min-w-0 flex-1 items-center gap-1.5">
                      <Show when={note.pinned}>
                        <span class="shrink-0 text-[10px]">📌</span>
                      </Show>
                      <p class="truncate text-[13px] font-medium">{note.title}</p>
                    </div>
                    <div class="relative shrink-0" data-note-menu>
                      <button
                        class={`traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0 transition-opacity ${
                          menuId() === note.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuId(menuId() === note.id ? null : note.id);
                        }}
                      >
                        <ControlDot size="small" variant="menu" />
                      </button>
                      <Show when={menuId() === note.id}>
                        <div
                          class="theme-panel-soft theme-menu-popover absolute right-0 top-7 z-30 min-w-[140px] border p-1"
                          style={{ "border-color": "var(--app-border)" }}
                          data-note-menu
                        >
                          <button
                            class="theme-sidebar-item w-full rounded-xl px-3 py-1.5 text-left text-sm"
                            onClick={() => void handleTogglePin(note.id)}
                          >
                            {note.pinned ? "取消置顶" : "置顶"}
                          </button>
                          <button
                            class="theme-sidebar-item w-full rounded-xl px-3 py-1.5 text-left text-sm text-[#ff3b30]"
                            onClick={() => void handleDelete(note.id)}
                          >
                            删除
                          </button>
                        </div>
                      </Show>
                    </div>
                  </div>
                  <p class="theme-text-soft mt-0.5 truncate text-xs">
                    {note.content?.slice(0, 60) || "空白笔记"}
                  </p>
                  <div class="mt-1 flex items-center gap-1.5">
                    <Show when={note.tags.length > 0}>
                      <For each={note.tags.slice(0, 3)}>
                        {(tag) => (
                          <span class="theme-chip rounded-full px-1.5 py-0 text-[10px]">
                            {tag}
                          </span>
                        )}
                      </For>
                    </Show>
                    <span class="theme-text-soft text-[10px]">
                      {formatTime(note.updatedAt)}
                    </span>
                  </div>
                </div>
              )}
            </For>

            <Show when={sortedNotes().length === 0}>
              <p class="theme-text-soft px-2 py-8 text-center text-xs">
                {search() ? "没有匹配的笔记" : "还没有笔记，点击 + 创建"}
              </p>
            </Show>
          </div>
        </>
      }
    >
      <Show
        when={activeNote()}
        fallback={
          <div class="flex h-full items-center justify-center">
            <p class="theme-text-soft text-sm">选择或创建一个笔记</p>
          </div>
        }
      >
        {(note) => (
          <div class="flex h-full flex-col">
            <div
              class="flex items-center gap-3 border-b px-5 py-3"
              style={{ "border-color": "var(--app-border)" }}
            >
              <Show when={note().pinned}>
                <span class="text-sm">📌</span>
              </Show>
              <input
                class="flex-1 bg-transparent text-base font-semibold outline-none"
                style={{ color: "var(--app-text)" }}
                value={editTitle()}
                onInput={(e) => setEditTitle(e.currentTarget.value)}
                onBlur={() => void handleSave()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSave();
                }}
              />
              <span class="theme-text-soft shrink-0 text-xs">
                {formatTime(note().updatedAt)}
              </span>
            </div>

            <div class="flex-1 overflow-hidden">
              <textarea
                class="h-full w-full resize-none bg-transparent px-5 py-4 text-sm leading-relaxed outline-none"
                style={{ color: "var(--app-text)" }}
                placeholder="开始写笔记..."
                value={editContent()}
                onInput={(e) => setEditContent(e.currentTarget.value)}
                onBlur={() => void handleSave()}
              />
            </div>

            <div
              class="flex items-center gap-2 border-t px-5 py-2"
              style={{ "border-color": "var(--app-border)" }}
            >
              <span class="theme-text-soft text-xs">标签:</span>
              <input
                class="theme-input h-7 flex-1 rounded-md px-2 text-xs"
                placeholder="用逗号分隔标签"
                value={editTags()}
                onInput={(e) => setEditTags(e.currentTarget.value)}
                onBlur={() => void handleSave()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSave();
                }}
              />
              <Show when={note().tags.length > 0}>
                <For each={note().tags}>
                  {(tag) => (
                    <span class="theme-chip rounded-full px-2 py-0.5 text-[11px]">
                      {tag}
                    </span>
                  )}
                </For>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </WorkspaceSidebarLayout>
  );
}
