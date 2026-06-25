/**
 * Centralized keyboard shortcut system.
 *
 * On macOS the modifier is ⌘ (Meta), on other platforms it is Alt.
 * Detection uses `event.code` (physical key) so that Alt-produced
 * diacritics on macOS do not break matching.
 */

export type ShortcutId =
  | "closeTab"
  | "runQuery"
  | "compactQuery"
  | "formatQuery";

export type ShortcutDef = {
  id: ShortcutId;
  label: string;
  /** Physical key code, e.g. "KeyT", "KeyR" */
  code: string;
  defaultKey: string;
};

export const shortcutDefs: readonly ShortcutDef[] = [
  { id: "closeTab",     label: "Close tab",     code: "KeyT", defaultKey: "T" },
  { id: "runQuery",     label: "Run query",      code: "KeyR", defaultKey: "R" },
  { id: "compactQuery", label: "Compact query",  code: "KeyC", defaultKey: "C" },
  { id: "formatQuery",  label: "Format query",   code: "KeyF", defaultKey: "F" },
];

/** User-customised key overrides keyed by ShortcutId. */
export type ShortcutOverrides = Partial<Record<ShortcutId, string>>;

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPod|iPhone|iPad/.test(navigator.userAgent ?? "");

/** Display symbol for the modifier key on the current platform. */
export const modifierLabel = isMac ? "⌘" : "Alt";

/** Check whether the modifier is held for the current platform. */
export function isModifierHeld(event: KeyboardEvent): boolean {
  return isMac ? event.metaKey : event.altKey;
}

/**
 * Resolve the display label for a shortcut, applying user overrides.
 * Returns e.g. "⌘T" on macOS or "Alt+R" on Windows/Linux.
 */
export function shortcutLabel(
  id: ShortcutId,
  overrides?: ShortcutOverrides,
): string {
  const def = shortcutDefs.find((d) => d.id === id);
  if (!def) return "";
  const key = overrides?.[id] ?? def.defaultKey;
  return isMac ? `⌘${key}` : `Alt+${key}`;
}

/**
 * Match a keyboard event against a shortcut.
 * Uses `event.code` so that Alt-produced characters on macOS do not
 * interfere with matching.
 */
export function matchShortcut(
  event: KeyboardEvent,
  id: ShortcutId,
  overrides?: ShortcutOverrides,
): boolean {
  if (!isModifierHeld(event)) return false;
  const def = shortcutDefs.find((d) => d.id === id);
  if (!def) return false;
  return event.code === def.code;
}
