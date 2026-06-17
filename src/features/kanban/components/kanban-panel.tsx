import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { ControlDot } from "../../../components/ui-primitives";
import type {
  KanbanTask,
  KanbanTaskPriority,
  KanbanTaskStatus,
  KanbanState,
} from "../models";
import { addTask, deleteTask, loadKanban, moveTask, updateTask } from "../service";

const columns: Array<{ status: KanbanTaskStatus; label: string; color: string }> = [
  { status: "todo", label: "待办", color: "var(--app-text-muted)" },
  { status: "in-progress", label: "进行中", color: "#E0AF68" },
  { status: "done", label: "已完成", color: "#28C840" },
];

const priorityConfig: Record<KanbanTaskPriority, { label: string; color: string }> = {
  low: { label: "低", color: "#7f7f85" },
  medium: { label: "中", color: "#E0AF68" },
  high: { label: "高", color: "#FF5F57" },
};

export function KanbanPanel() {
  const [state, setState] = createSignal<KanbanState>({ tasks: [] });
  const [addingTo, setAddingTo] = createSignal<KanbanTaskStatus | null>(null);
  const [newTitle, setNewTitle] = createSignal("");
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editTitle, setEditTitle] = createSignal("");
  const [editDesc, setEditDesc] = createSignal("");
  const [editPriority, setEditPriority] = createSignal<KanbanTaskPriority>("medium");
  const [menuTaskId, setMenuTaskId] = createSignal<string | null>(null);

  onMount(() => {
    void loadKanban().then(setState);
  });

  const tasksByStatus = createMemo(() => {
    const map: Record<KanbanTaskStatus, KanbanTask[]> = {
      todo: [],
      "in-progress": [],
      done: [],
    };
    for (const task of state().tasks) {
      map[task.status]?.push(task);
    }
    return map;
  });

  const handleAdd = (status: KanbanTaskStatus) => {
    setAddingTo(status);
    setNewTitle("");
  };

  const handleConfirmAdd = async (status: KanbanTaskStatus) => {
    const title = newTitle().trim();
    if (!title) {
      setAddingTo(null);
      return;
    }
    const next = await addTask(title, "", "medium", status);
    setState(next);
    setNewTitle("");
    setAddingTo(null);
  };

  const handleStartEdit = (task: KanbanTask) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditDesc(task.description);
    setEditPriority(task.priority);
    setMenuTaskId(null);
  };

  const handleSaveEdit = async () => {
    const id = editingId();
    if (!id) return;
    const task = state().tasks.find((t) => t.id === id);
    if (!task) return;
    const next = await updateTask({
      ...task,
      title: editTitle().trim() || "Untitled",
      description: editDesc(),
      priority: editPriority(),
    });
    setState(next);
    setEditingId(null);
  };

  const handleMove = async (taskId: string, status: KanbanTaskStatus) => {
    const next = await moveTask(taskId, status);
    setState(next);
    setMenuTaskId(null);
  };

  const handleDelete = async (taskId: string) => {
    const next = await deleteTask(taskId);
    setState(next);
    setMenuTaskId(null);
  };

  return (
    <div class="flex h-full gap-4 overflow-x-auto p-4">
      <For each={columns}>
        {(col) => (
          <div class="flex min-w-[260px] flex-1 flex-col rounded-2xl border"
            style={{ "border-color": "var(--app-border)", background: "var(--app-panel-soft)" }}>
            <div class="flex items-center justify-between border-b px-4 py-3"
              style={{ "border-color": "var(--app-border)" }}>
              <div class="flex items-center gap-2">
                <span class="inline-block h-2.5 w-2.5 rounded-full" style={{ background: col.color }} />
                <span class="text-sm font-semibold">{col.label}</span>
                <span class="theme-chip rounded-full px-1.5 py-0.5 text-[11px] font-medium">
                  {tasksByStatus()[col.status].length}
                </span>
              </div>
              <button
                class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0"
                title="添加任务"
                onClick={() => handleAdd(col.status)}
              >
                <ControlDot size="small" variant="add" />
              </button>
            </div>

            <div class="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
              <Show when={addingTo() === col.status}>
                <div class="theme-control rounded-xl p-3">
                  <input
                    class="theme-input h-8 w-full rounded-md px-2.5 text-sm"
                    placeholder="任务标题"
                    value={newTitle()}
                    onInput={(e) => setNewTitle(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleConfirmAdd(col.status);
                      if (e.key === "Escape") setAddingTo(null);
                    }}
                    autofocus
                  />
                  <div class="mt-2 flex items-center gap-2">
                    <button
                      class="theme-control rounded-lg px-3 py-1 text-xs font-medium transition hover:bg-white/10"
                      onClick={() => void handleConfirmAdd(col.status)}
                    >
                      添加
                    </button>
                    <button
                      class="theme-text-soft text-xs hover:text-[var(--app-text)]"
                      onClick={() => setAddingTo(null)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              </Show>

              <For each={tasksByStatus()[col.status]}>
                {(task) => (
                  <Show
                    when={editingId() !== task.id}
                    fallback={
                      <div class="theme-control rounded-xl p-3">
                        <input
                          class="theme-input h-8 w-full rounded-md px-2.5 text-sm"
                          placeholder="任务标题"
                          value={editTitle()}
                          onInput={(e) => setEditTitle(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleSaveEdit();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <textarea
                          class="theme-input mt-2 h-16 w-full resize-none rounded-md px-2.5 py-1.5 text-sm"
                          placeholder="描述（可选）"
                          value={editDesc()}
                          onInput={(e) => setEditDesc(e.currentTarget.value)}
                        />
                        <div class="mt-2 flex items-center gap-2">
                          <select
                            class="theme-input h-7 rounded-md px-2 text-xs"
                            value={editPriority()}
                            onChange={(e) => setEditPriority(e.currentTarget.value as KanbanTaskPriority)}
                          >
                            <option value="low">低优先</option>
                            <option value="medium">中优先</option>
                            <option value="high">高优先</option>
                          </select>
                          <button
                            class="theme-control rounded-lg px-3 py-1 text-xs font-medium transition hover:bg-white/10"
                            onClick={() => void handleSaveEdit()}
                          >
                            保存
                          </button>
                          <button
                            class="theme-text-soft text-xs hover:text-[var(--app-text)]"
                            onClick={() => setEditingId(null)}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    }
                  >
                    <div
                      class="group theme-control relative cursor-default rounded-xl p-3 transition hover:brightness-110"
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenuTaskId(menuTaskId() === task.id ? null : task.id);
                      }}
                    >
                      <div class="flex items-start justify-between gap-2">
                        <p class="min-w-0 flex-1 text-sm font-medium leading-snug break-words">
                          {task.title}
                        </p>
                        <div class="relative shrink-0" data-kanban-menu>
                          <button
                            class={`traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0 transition-opacity ${
                              menuTaskId() === task.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuTaskId(menuTaskId() === task.id ? null : task.id);
                            }}
                          >
                            <ControlDot size="small" variant="menu" />
                          </button>
                          <Show when={menuTaskId() === task.id}>
                            <div
                              class="theme-panel-soft theme-menu-popover absolute right-0 top-7 z-30 min-w-[140px] border p-1"
                              style={{ "border-color": "var(--app-border)" }}
                              data-kanban-menu
                            >
                              <button
                                class="theme-sidebar-item w-full rounded-xl px-3 py-1.5 text-left text-sm"
                                onClick={() => handleStartEdit(task)}
                              >
                                编辑
                              </button>
                              <For each={columns.filter((c) => c.status !== task.status)}>
                                {(targetCol) => (
                                  <button
                                    class="theme-sidebar-item w-full rounded-xl px-3 py-1.5 text-left text-sm"
                                    onClick={() => void handleMove(task.id, targetCol.status)}
                                  >
                                    移到{targetCol.label}
                                  </button>
                                )}
                              </For>
                              <button
                                class="theme-sidebar-item w-full rounded-xl px-3 py-1.5 text-left text-sm text-[#ff3b30]"
                                onClick={() => void handleDelete(task.id)}
                              >
                                删除
                              </button>
                            </div>
                          </Show>
                        </div>
                      </div>
                      <Show when={task.description}>
                        <p class="theme-text-soft mt-1.5 text-xs leading-relaxed break-words">
                          {task.description}
                        </p>
                      </Show>
                      <div class="mt-2 flex items-center gap-2">
                        <span
                          class="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: priorityConfig[task.priority].color }}
                        />
                        <span class="theme-text-soft text-[10px]">
                          {priorityConfig[task.priority].label}
                        </span>
                      </div>
                    </div>
                  </Show>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
