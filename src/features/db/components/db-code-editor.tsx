import { Compartment, EditorState } from "@codemirror/state";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search";
import { javascript } from "@codemirror/lang-javascript";
import {
  MSSQL,
  MySQL,
  PostgreSQL,
  SQLite,
  sql,
  StandardSQL,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import { createDbCompletionSources } from "./sql-completion";
import { getDbAdapter } from "../adapters";
import {
  HighlightStyle,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { DbConnectionKind } from "../models";
import { ContextMenu } from "./db-menu";
import type { ContextMenuItem } from "./db-menu";

type DbCodeEditorProps = {
  value: string;
  kind: DbConnectionKind;
  /** Named editor theme; "auto" (default) follows the app's light/dark mode. */
  themeId?: EditorThemeId;
  readOnly?: boolean;
  schema?: SQLNamespace;
  defaultSchema?: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  /** Run only when there is an explicit selection (dbx "Execute selection"). */
  onRunSelection?: (selection: string) => void;
  onCompact?: () => void;
  onFormat?: () => void;
  onCloseTab?: () => void;
  /** dbx editor menu: open the data view / DDL for the focused identifier. */
  onViewData?: (identifier: string) => void;
  onViewDdl?: (identifier: string) => void;
  onEditorReady?: (editor: EditorView) => void;
};

function languageExtension(kind: DbConnectionKind) {
  const adapter = getDbAdapter(kind);
  switch (adapter.completionDialect()) {
    case "postgresql":
      return sql({ dialect: PostgreSQL, upperCaseKeywords: true });
    case "mysql":
      return sql({ dialect: MySQL, upperCaseKeywords: true });
    case "mssql":
      return sql({ dialect: MSSQL, upperCaseKeywords: true });
    case "sqlite":
      return sql({ dialect: SQLite, upperCaseKeywords: true });
    case "standard":
      return sql({ dialect: StandardSQL, upperCaseKeywords: true });
    case null:
      // Non-SQL kinds: Mongo shell uses JS highlighting; Redis has none.
      return adapter.completionKeywords() === "mongo" ? javascript() : [];
  }
}

const lightEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    "min-height": "100%",
    "font-size": "14px",
    background: "var(--app-input)",
    color: "var(--app-text)",
  },
  ".cm-scroller": {
    overflow: "auto",
    "font-family":
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    "line-height": "1.7",
  },
  ".cm-content": {
    padding: "0",
    "min-height": "100%",
  },
  ".cm-line": {
    padding: "0",
  },
  ".cm-gutters": {
    background: "var(--app-input)",
    color: "var(--app-text-soft)",
    border: "none",
    "padding-right": "8px",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    "padding-left": "8px",
  },
  ".cm-activeLine": {
    background: "rgba(127, 127, 127, 0.08)",
  },
  ".cm-focused": {
    outline: "none",
  },
  ".cm-selectionBackground, ::selection": {
    background: "rgba(59, 130, 246, 0.22)",
  },
  ".cm-cursor": {
    "border-left-color": "var(--app-text)",
  },
});

const atomDarkTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      "min-height": "100%",
      "font-size": "14px",
      background: "#282c34",
      color: "#abb2bf",
    },
    ".cm-scroller": {
      overflow: "auto",
      "font-family":
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      "line-height": "1.7",
    },
    ".cm-content": {
      padding: "0",
      "min-height": "100%",
    },
    ".cm-line": {
      padding: "0",
    },
    ".cm-gutters": {
      background: "#282c34",
      color: "#636d83",
      border: "none",
      "padding-right": "8px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      "padding-left": "8px",
    },
    ".cm-activeLine": {
      background: "#2f343d",
    },
    ".cm-focused": {
      outline: "none",
    },
    ".cm-selectionBackground, ::selection": {
      background: "#3e4451",
    },
    ".cm-cursor": {
      "border-left-color": "#528bff",
    },
  },
  { dark: true },
);

const atomDarkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#c678dd" },
  {
    tag: [
      tags.name,
      tags.deleted,
      tags.character,
      tags.propertyName,
      tags.macroName,
    ],
    color: "#e06c75",
  },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#61afef" },
  {
    tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)],
    color: "#d19a66",
  },
  { tag: [tags.definition(tags.name), tags.separator], color: "#abb2bf" },
  { tag: [tags.brace], color: "#abb2bf" },
  { tag: [tags.annotation], color: "#e5c07b" },
  {
    tag: [
      tags.number,
      tags.changed,
      tags.annotation,
      tags.modifier,
      tags.self,
      tags.namespace,
    ],
    color: "#d19a66",
  },
  { tag: [tags.typeName, tags.className], color: "#e5c07b" },
  { tag: [tags.operator, tags.operatorKeyword], color: "#56b6c2" },
  { tag: [tags.url, tags.escape, tags.regexp, tags.link], color: "#56b6c2" },
  { tag: [tags.meta, tags.comment], color: "#5c6370", fontStyle: "italic" },
  { tag: [tags.string, tags.inserted], color: "#98c379" },
  { tag: [tags.invalid], color: "#ffffff", backgroundColor: "#e05252" },
]);

// --- additional named themes -------------------------------------------
// Each named dark theme ships its own EditorView.theme + HighlightStyle so the
// editor can offer a DBX-style theme picker rather than a single light/dark
// toggle. The light theme stays bound to the app's CSS tokens; dark themes are
// self-contained palettes.

function buildDarkTheme(palette: {
  background: string;
  text: string;
  gutter: string;
  activeLine: string;
  selection: string;
  cursor: string;
}) {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        "min-height": "100%",
        "font-size": "14px",
        background: palette.background,
        color: palette.text,
      },
      ".cm-scroller": {
        overflow: "auto",
        "font-family":
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        "line-height": "1.7",
      },
      ".cm-content": { padding: "0", "min-height": "100%" },
      ".cm-line": { padding: "0" },
      ".cm-gutters": {
        background: palette.background,
        color: palette.gutter,
        border: "none",
        "padding-right": "8px",
      },
      ".cm-lineNumbers .cm-gutterElement": { "padding-left": "8px" },
      ".cm-activeLine": { background: palette.activeLine },
      ".cm-focused": { outline: "none" },
      ".cm-selectionBackground, ::selection": { background: palette.selection },
      ".cm-cursor": { "border-left-color": palette.cursor },
    },
    { dark: true },
  );
}

const draculaTheme = buildDarkTheme({
  background: "#282a36",
  text: "#f8f8f2",
  gutter: "#6272a4",
  activeLine: "#343746",
  selection: "#44475a",
  cursor: "#f8f8f0",
});

const draculaHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#ff79c6" },
  { tag: [tags.name, tags.propertyName, tags.deleted], color: "#f8f8f2" },
  {
    tag: [tags.function(tags.variableName), tags.labelName],
    color: "#50fa7b",
  },
  { tag: [tags.constant(tags.name), tags.standard(tags.name)], color: "#bd93f9" },
  { tag: [tags.typeName, tags.className], color: "#8be9fd" },
  { tag: [tags.number], color: "#bd93f9" },
  { tag: [tags.operator, tags.operatorKeyword], color: "#ff79c6" },
  { tag: [tags.string, tags.inserted], color: "#f1fa8c" },
  { tag: [tags.meta, tags.comment], color: "#6272a4", fontStyle: "italic" },
  { tag: [tags.invalid], color: "#ffffff", backgroundColor: "#ff5555" },
]);

const githubDarkTheme = buildDarkTheme({
  background: "#0d1117",
  text: "#c9d1d9",
  gutter: "#484f58",
  activeLine: "#161b22",
  selection: "rgba(56,139,253,0.25)",
  cursor: "#58a6ff",
});

const githubDarkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#ff7b72" },
  { tag: [tags.name, tags.propertyName], color: "#c9d1d9" },
  {
    tag: [tags.function(tags.variableName), tags.labelName],
    color: "#d2a8ff",
  },
  { tag: [tags.constant(tags.name), tags.standard(tags.name)], color: "#79c0ff" },
  { tag: [tags.typeName, tags.className], color: "#ffa657" },
  { tag: [tags.number], color: "#79c0ff" },
  { tag: [tags.operator, tags.operatorKeyword], color: "#ff7b72" },
  { tag: [tags.string, tags.inserted], color: "#a5d6ff" },
  { tag: [tags.meta, tags.comment], color: "#8b949e", fontStyle: "italic" },
  { tag: [tags.invalid], color: "#ffffff", backgroundColor: "#f85149" },
]);

const solarizedDarkTheme = buildDarkTheme({
  background: "#002b36",
  text: "#93a1a1",
  gutter: "#586e75",
  activeLine: "#073642",
  selection: "rgba(88,110,117,0.4)",
  cursor: "#839496",
});

const solarizedDarkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#859900" },
  { tag: [tags.name, tags.propertyName], color: "#93a1a1" },
  {
    tag: [tags.function(tags.variableName), tags.labelName],
    color: "#268bd2",
  },
  { tag: [tags.constant(tags.name), tags.standard(tags.name)], color: "#cb4b16" },
  { tag: [tags.typeName, tags.className], color: "#b58900" },
  { tag: [tags.number], color: "#d33682" },
  { tag: [tags.operator, tags.operatorKeyword], color: "#859900" },
  { tag: [tags.string, tags.inserted], color: "#2aa198" },
  { tag: [tags.meta, tags.comment], color: "#586e75", fontStyle: "italic" },
  { tag: [tags.invalid], color: "#ffffff", backgroundColor: "#dc322f" },
]);

export type EditorThemeId =
  | "auto"
  | "light"
  | "atom-dark"
  | "github-dark"
  | "dracula"
  | "solarized-dark";

type NamedEditorTheme = {
  id: Exclude<EditorThemeId, "auto">;
  label: string;
  appearance: "light" | "dark";
  view: ReturnType<typeof EditorView.theme>;
  highlight: HighlightStyle;
};

/** Concrete (non-"auto") editor themes, in the order shown in the picker. */
export const EDITOR_THEMES: NamedEditorTheme[] = [
  {
    id: "light",
    label: "Light",
    appearance: "light",
    view: lightEditorTheme,
    highlight: defaultHighlightStyle,
  },
  {
    id: "atom-dark",
    label: "Atom One Dark",
    appearance: "dark",
    view: atomDarkTheme,
    highlight: atomDarkHighlightStyle,
  },
  {
    id: "github-dark",
    label: "GitHub Dark",
    appearance: "dark",
    view: githubDarkTheme,
    highlight: githubDarkHighlightStyle,
  },
  {
    id: "dracula",
    label: "Dracula",
    appearance: "dark",
    view: draculaTheme,
    highlight: draculaHighlightStyle,
  },
  {
    id: "solarized-dark",
    label: "Solarized Dark",
    appearance: "dark",
    view: solarizedDarkTheme,
    highlight: solarizedDarkHighlightStyle,
  },
];

/** The picker also surfaces "Auto" (follow the app's light/dark mode). */
export const EDITOR_THEME_OPTIONS: Array<{ id: EditorThemeId; label: string }> =
  [{ id: "auto", label: "Auto (App)" }, ...EDITOR_THEMES];

export const DEFAULT_EDITOR_THEME_ID: EditorThemeId = "auto";

export function isEditorThemeId(value: unknown): value is EditorThemeId {
  return (
    value === "auto" || EDITOR_THEMES.some((theme) => theme.id === value)
  );
}

/**
 * Resolve a theme id to a concrete theme. "auto" follows the app's dark-mode
 * flag (light ⇄ Atom One Dark), preserving the original toggle behavior.
 */
function resolveEditorTheme(
  themeId: EditorThemeId,
  isDarkMode: boolean,
): NamedEditorTheme {
  if (themeId === "auto") {
    return isDarkMode ? EDITOR_THEMES[1] : EDITOR_THEMES[0];
  }
  return EDITOR_THEMES.find((theme) => theme.id === themeId) ?? EDITOR_THEMES[0];
}

function getEditorThemeExtension(themeId: EditorThemeId, isDarkMode: boolean) {
  return resolveEditorTheme(themeId, isDarkMode).view;
}

function getSyntaxThemeExtension(themeId: EditorThemeId, isDarkMode: boolean) {
  return syntaxHighlighting(resolveEditorTheme(themeId, isDarkMode).highlight, {
    fallback: true,
  });
}

export function DbCodeEditor(props: DbCodeEditorProps) {
  let containerRef: HTMLDivElement | undefined;
  let editor: EditorView | null = null;

  const [isDarkMode, setIsDarkMode] = createSignal(false);
  const [menu, setMenu] = createSignal<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  /** Selected text, or "" when nothing is selected. */
  function selectionText(): string {
    if (!editor) return "";
    const { from, to } = editor.state.selection.main;
    return from === to ? "" : editor.state.sliceDoc(from, to);
  }

  /**
   * The identifier under the cursor/selection — the word a "View Data"/"View
   * DDL" action targets. Selection wins; otherwise the word at the caret.
   */
  function focusedIdentifier(): string {
    if (!editor) return "";
    const selected = selectionText();
    if (selected.trim()) return selected.trim();
    const pos = editor.state.selection.main.head;
    const word = editor.state.wordAt(pos);
    return word ? editor.state.sliceDoc(word.from, word.to) : "";
  }

  function buildEditorMenu(): ContextMenuItem[] {
    const selected = selectionText();
    const identifier = focusedIdentifier();
    const readOnly = Boolean(props.readOnly);
    return [
      {
        label: "Execute SQL",
        icon: "Play",
        shortcut: "⌘↵",
        disabled: readOnly || !props.onRun,
        action: () => props.onRun?.(),
      },
      {
        label: "Execute Selection",
        icon: "Play",
        disabled: readOnly || !selected.trim(),
        action: () => props.onRunSelection?.(selected),
      },
      { separator: true },
      {
        label: "View Data",
        icon: "Table2",
        disabled: !props.onViewData || !identifier,
        action: () => props.onViewData?.(identifier),
      },
      {
        label: "View DDL",
        icon: "FileCode",
        disabled: !props.onViewDdl || !identifier,
        action: () => props.onViewDdl?.(identifier),
      },
      { separator: true },
      {
        label: "Copy Selection",
        icon: "Copy",
        shortcut: "⌘C",
        disabled: !selected,
        action: () => {
          if (selected && navigator?.clipboard?.writeText) {
            void navigator.clipboard.writeText(selected);
          }
        },
      },
      {
        label: "Select All",
        icon: "ListTree",
        shortcut: "⌘A",
        action: () => {
          if (!editor) return;
          editor.dispatch({
            selection: { anchor: 0, head: editor.state.doc.length },
          });
          editor.focus();
        },
      },
    ];
  }
  const languageCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const syntaxCompartment = new Compartment();

  const completionSources = createDbCompletionSources(
    () => props.kind,
    () => props.schema,
    () => props.defaultSchema,
  );

  onMount(() => {
    if (!containerRef) {
      return;
    }

    const syncTheme = () => {
      setIsDarkMode(document.documentElement.dataset.theme === "dark");
    };

    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    editor = new EditorView({
      state: EditorState.create({
        doc: props.value,
        extensions: [
          lineNumbers(),
          history(),
          closeBrackets(),
          autocompletion({ override: completionSources }),
          // Find/replace panel (Mod-f) + match highlighting — CodeMirror's own
          // search UI, no extra dependency.
          search({ top: true }),
          highlightSelectionMatches(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            ...closeBracketsKeymap,
            ...searchKeymap,
            {
              key: "Mod-Enter",
              run: () => {
                props.onRun?.();
                return true;
              },
            },
            {
              key: "Alt-c",
              run: () => {
                props.onCompact?.();
                return true;
              },
            },
            {
              key: "Alt-f",
              run: () => {
                props.onFormat?.();
                return true;
              },
            },
            {
              key: "Alt-r",
              run: () => {
                props.onRun?.();
                return true;
              },
            },
            {
              key: "Alt-t",
              run: () => {
                props.onCloseTab?.();
                return true;
              },
            },
          ]),
          EditorView.lineWrapping,
          themeCompartment.of(
            getEditorThemeExtension(props.themeId ?? "auto", isDarkMode()),
          ),
          syntaxCompartment.of(
            getSyntaxThemeExtension(props.themeId ?? "auto", isDarkMode()),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const nextValue = update.state.doc.toString();
              if (nextValue !== props.value) {
                props.onChange(nextValue);
              }
            }
          }),
          languageCompartment.of(languageExtension(props.kind)),
          readOnlyCompartment.of(
            EditorState.readOnly.of(Boolean(props.readOnly)),
          ),
        ],
      }),
      parent: containerRef,
    });

    props.onEditorReady?.(editor);

    onCleanup(() => {
      observer.disconnect();
    });
  });

  createEffect(() => {
    if (!editor) {
      return;
    }

    const nextKind = props.kind;
    const nextReadOnly = Boolean(props.readOnly);
    const dark = isDarkMode();
    const themeId = props.themeId ?? "auto";

    editor.dispatch({
      effects: [
        languageCompartment.reconfigure(languageExtension(nextKind)),
        readOnlyCompartment.reconfigure(EditorState.readOnly.of(nextReadOnly)),
        themeCompartment.reconfigure(getEditorThemeExtension(themeId, dark)),
        syntaxCompartment.reconfigure(getSyntaxThemeExtension(themeId, dark)),
      ],
    });
  });

  createEffect(() => {
    if (!editor) {
      return;
    }

    const nextValue = props.value;
    const currentValue = editor.state.doc.toString();

    if (currentValue !== nextValue) {
      editor.dispatch({
        changes: { from: 0, to: currentValue.length, insert: nextValue },
      });
    }
  });

  onCleanup(() => {
    editor?.destroy();
  });

  return (
    <>
      <div
        ref={containerRef}
        class="h-full w-full overflow-hidden"
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({
            x: event.clientX,
            y: event.clientY,
            items: buildEditorMenu(),
          });
        }}
      />
      <ContextMenu
        position={menu()}
        items={menu()?.items ?? []}
        onClose={() => setMenu(null)}
      />
    </>
  );
}
