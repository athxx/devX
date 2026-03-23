import { Compartment, EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { MSSQL, MySQL, PostgreSQL, SQLite, sql, StandardSQL } from '@codemirror/lang-sql'
import { HighlightStyle, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import type { DbConnectionKind } from '../models'

type DbCodeEditorProps = {
  value: string
  kind: DbConnectionKind
  readOnly?: boolean
  onChange: (value: string) => void
  onRun?: () => void
}

function languageExtension(kind: DbConnectionKind) {
  switch (kind) {
    case 'redis':
      return []
    case 'mongodb':
      return javascript()
    case 'postgresql':
    case 'gaussdb':
      return sql({ dialect: PostgreSQL, upperCaseKeywords: true })
    case 'mysql':
    case 'tidb':
      return sql({ dialect: MySQL, upperCaseKeywords: true })
    case 'sqlserver':
      return sql({ dialect: MSSQL, upperCaseKeywords: true })
    case 'sqlite':
      return sql({ dialect: SQLite, upperCaseKeywords: true })
    default:
      return sql({ dialect: StandardSQL, upperCaseKeywords: true })
  }
}

const lightEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    'min-height': '100%',
    'font-size': '14px',
    background: 'var(--app-input)',
    color: 'var(--app-text)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    'line-height': '1.7',
  },
  '.cm-content': {
    padding: '0',
    'min-height': '100%',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-gutters': {
    background: 'var(--app-input)',
    color: 'var(--app-text-soft)',
    border: 'none',
    'padding-right': '8px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    'padding-left': '8px',
  },
  '.cm-activeLine': {
    background: 'rgba(127, 127, 127, 0.08)',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-selectionBackground, ::selection': {
    background: 'rgba(59, 130, 246, 0.22)',
  },
  '.cm-cursor': {
    'border-left-color': 'var(--app-text)',
  },
})

const atomDarkTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      'min-height': '100%',
      'font-size': '14px',
      background: '#282c34',
      color: '#abb2bf',
    },
    '.cm-scroller': {
      overflow: 'auto',
      'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      'line-height': '1.7',
    },
    '.cm-content': {
      padding: '0',
      'min-height': '100%',
    },
    '.cm-line': {
      padding: '0',
    },
    '.cm-gutters': {
      background: '#282c34',
      color: '#636d83',
      border: 'none',
      'padding-right': '8px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      'padding-left': '8px',
    },
    '.cm-activeLine': {
      background: '#2f343d',
    },
    '.cm-focused': {
      outline: 'none',
    },
    '.cm-selectionBackground, ::selection': {
      background: '#3e4451',
    },
    '.cm-cursor': {
      'border-left-color': '#528bff',
    },
  },
  { dark: true },
)

const atomDarkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#c678dd' },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: '#e06c75' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: '#61afef' },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: '#d19a66' },
  { tag: [tags.definition(tags.name), tags.separator], color: '#abb2bf' },
  { tag: [tags.brace], color: '#abb2bf' },
  { tag: [tags.annotation], color: '#e5c07b' },
  { tag: [tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: '#d19a66' },
  { tag: [tags.typeName, tags.className], color: '#e5c07b' },
  { tag: [tags.operator, tags.operatorKeyword], color: '#56b6c2' },
  { tag: [tags.url, tags.escape, tags.regexp, tags.link], color: '#56b6c2' },
  { tag: [tags.meta, tags.comment], color: '#5c6370', fontStyle: 'italic' },
  { tag: [tags.string, tags.inserted], color: '#98c379' },
  { tag: [tags.invalid], color: '#ffffff', backgroundColor: '#e05252' },
])

function getEditorThemeExtension(isDarkMode: boolean) {
  return isDarkMode ? atomDarkTheme : lightEditorTheme
}

function getSyntaxThemeExtension(isDarkMode: boolean) {
  return isDarkMode
    ? syntaxHighlighting(atomDarkHighlightStyle, { fallback: true })
    : syntaxHighlighting(defaultHighlightStyle, { fallback: true })
}

export function DbCodeEditor(props: DbCodeEditorProps) {
  let containerRef: HTMLDivElement | undefined
  let editor: EditorView | null = null

  const [isDarkMode, setIsDarkMode] = createSignal(false)
  const languageCompartment = new Compartment()
  const readOnlyCompartment = new Compartment()
  const themeCompartment = new Compartment()
  const syntaxCompartment = new Compartment()

  onMount(() => {
    if (!containerRef) {
      return
    }

    const syncTheme = () => {
      setIsDarkMode(document.documentElement.dataset.theme === 'dark')
    }

    syncTheme()

    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    editor = new EditorView({
      state: EditorState.create({
        doc: props.value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            {
              key: 'Mod-Enter',
              run: () => {
                props.onRun?.()
                return true
              },
            },
          ]),
          EditorView.lineWrapping,
          themeCompartment.of(getEditorThemeExtension(isDarkMode())),
          syntaxCompartment.of(getSyntaxThemeExtension(isDarkMode())),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const nextValue = update.state.doc.toString()
              if (nextValue !== props.value) {
                props.onChange(nextValue)
              }
            }
          }),
          languageCompartment.of(languageExtension(props.kind)),
          readOnlyCompartment.of(EditorState.readOnly.of(Boolean(props.readOnly))),
        ],
      }),
      parent: containerRef,
    })

    onCleanup(() => {
      observer.disconnect()
    })
  })

  createEffect(() => {
    if (!editor) {
      return
    }

    props.kind
    props.readOnly
    props.value
    isDarkMode()

    const currentValue = editor.state.doc.toString()
    const effects = [
      languageCompartment.reconfigure(languageExtension(props.kind)),
      readOnlyCompartment.reconfigure(EditorState.readOnly.of(Boolean(props.readOnly))),
      themeCompartment.reconfigure(getEditorThemeExtension(isDarkMode())),
      syntaxCompartment.reconfigure(getSyntaxThemeExtension(isDarkMode())),
    ]

    if (currentValue !== props.value) {
      editor.dispatch({
        changes: { from: 0, to: currentValue.length, insert: props.value },
        effects,
      })
      return
    }

    editor.dispatch({ effects })
  })

  onCleanup(() => {
    editor?.destroy()
  })

  return (
    <div
      ref={containerRef}
      class="h-full w-full overflow-hidden"
    />
  )
}
