import type { JSX } from 'solid-js'

type DbEditorPaneProps = {
  header: JSX.Element;
  editorMeta: JSX.Element;
  editor: JSX.Element;
  results: JSX.Element;
}

export function DbEditorPane(props: DbEditorPaneProps) {
  return (
    <>
      {props.header}
      <div class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_1px_minmax(0,1fr)]">
        <div class="min-h-0 overflow-hidden p-3">
          {props.editorMeta}
          {props.editor}
        </div>
        <div style={{ background: 'var(--app-border)' }} />
        <div class="min-h-0 overflow-hidden">{props.results}</div>
      </div>
    </>
  )
}
