import { Compartment, EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { sql } from '@codemirror/lang-sql'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { createEffect, onCleanup, onMount } from 'solid-js'
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
    case 'mongodb':
      return javascript()
    default:
      return sql()
  }
}

export function DbCodeEditor(props: DbCodeEditorProps) {
  let containerRef: HTMLDivElement | undefined
  let editor: EditorView | null = null

  const languageCompartment = new Compartment()
  const readOnlyCompartment = new Compartment()

  onMount(() => {
    if (!containerRef) {
      return
    }

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
          EditorView.theme({
            '&': {
              height: '100%',
              'min-height': '220px',
              'font-size': '13px',
              background: 'transparent',
            },
            '.cm-scroller': {
              overflow: 'auto',
              'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            },
            '.cm-content': {
              padding: '12px 0',
            },
            '.cm-gutters': {
              background: 'transparent',
              color: 'var(--app-text-soft)',
              border: 'none',
            },
            '.cm-activeLine, .cm-activeLineGutter': {
              background: 'rgba(127, 127, 127, 0.08)',
            },
            '.cm-focused': {
              outline: 'none',
            },
            '.cm-selectionBackground, ::selection': {
              background: 'rgba(59, 130, 246, 0.22)',
            },
          }),
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
  })

  createEffect(() => {
    if (!editor) {
      return
    }

    props.kind
    props.readOnly
    props.value

    const currentValue = editor.state.doc.toString()
    const effects = [
      languageCompartment.reconfigure(languageExtension(props.kind)),
      readOnlyCompartment.reconfigure(EditorState.readOnly.of(Boolean(props.readOnly))),
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
      class="h-full min-h-[220px] w-full overflow-hidden rounded-[18px] border"
      style={{ 'border-color': 'var(--app-border)' }}
    />
  )
}
