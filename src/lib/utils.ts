export function makeId(prefix?: string) {
  const id = `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  return prefix ? `${prefix}-${id}` : id;
}

export function arrayMove<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return items.slice();
  }

  const next = items.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, item);
  return next;
}

export function reorderByDirection(
  ids: string[],
  id: string,
  direction: "top" | "up" | "down"
) {
  const index = ids.indexOf(id);
  if (index < 0) {
    return ids.slice();
  }

  if (direction === "top") {
    return arrayMove(ids, index, 0);
  }

  if (direction === "up" && index > 0) {
    return arrayMove(ids, index, index - 1);
  }

  if (direction === "down" && index < ids.length - 1) {
    return arrayMove(ids, index, index + 1);
  }

  return ids.slice();
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
