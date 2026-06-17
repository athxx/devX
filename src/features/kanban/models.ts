export type KanbanTaskStatus = "todo" | "in-progress" | "done";

export type KanbanTaskPriority = "low" | "medium" | "high";

export type KanbanTask = {
  id: string;
  title: string;
  description: string;
  status: KanbanTaskStatus;
  priority: KanbanTaskPriority;
  createdAt: string;
  updatedAt: string;
};

export type KanbanState = {
  tasks: KanbanTask[];
};
