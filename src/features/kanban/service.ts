import { makeId } from "../../lib/utils";
import { loadKanbanState, saveKanbanState } from "./local-db";
import type { KanbanState, KanbanTask, KanbanTaskPriority, KanbanTaskStatus } from "./models";

function normalizeTask(task: KanbanTask): KanbanTask {
  return {
    ...task,
    title: task.title?.trim() || "Untitled",
    description: task.description ?? "",
    status: task.status ?? "todo",
    priority: task.priority ?? "medium",
    createdAt: task.createdAt || new Date().toISOString(),
    updatedAt: task.updatedAt || new Date().toISOString(),
  };
}

function normalizeState(state: KanbanState): KanbanState {
  return {
    tasks: (state.tasks ?? []).map(normalizeTask),
  };
}

export { saveKanbanState };

export async function loadKanban(): Promise<KanbanState> {
  const stored = await loadKanbanState();
  const normalized = normalizeState(stored ?? { tasks: [] });

  if (!stored || JSON.stringify(stored) !== JSON.stringify(normalized)) {
    await saveKanbanState(normalized);
  }

  return normalized;
}

export async function addTask(
  title: string,
  description: string = "",
  priority: KanbanTaskPriority = "medium",
  status: KanbanTaskStatus = "todo",
): Promise<KanbanState> {
  const state = await loadKanban();
  const now = new Date().toISOString();
  const task: KanbanTask = {
    id: makeId("task"),
    title: title.trim() || "Untitled",
    description,
    status,
    priority,
    createdAt: now,
    updatedAt: now,
  };
  const next = { ...state, tasks: [...state.tasks, task] };
  await saveKanbanState(next);
  return next;
}

export async function updateTask(updated: KanbanTask): Promise<KanbanState> {
  const state = await loadKanban();
  const next = {
    ...state,
    tasks: state.tasks.map((task) =>
      task.id === updated.id
        ? normalizeTask({ ...updated, updatedAt: new Date().toISOString() })
        : task,
    ),
  };
  await saveKanbanState(next);
  return next;
}

export async function moveTask(
  taskId: string,
  status: KanbanTaskStatus,
): Promise<KanbanState> {
  const state = await loadKanban();
  const next = {
    ...state,
    tasks: state.tasks.map((task) =>
      task.id === taskId
        ? { ...task, status, updatedAt: new Date().toISOString() }
        : task,
    ),
  };
  await saveKanbanState(next);
  return next;
}

export async function deleteTask(taskId: string): Promise<KanbanState> {
  const state = await loadKanban();
  const next = { ...state, tasks: state.tasks.filter((task) => task.id !== taskId) };
  await saveKanbanState(next);
  return next;
}
