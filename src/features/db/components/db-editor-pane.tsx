import type { JSX } from 'solid-js'

type DbEditorPaneProps = {
  header: JSX.Element;
  editorMeta: JSX.Element;
  editor: JSX.Element;
  results: JSX.Element;
  splitRatio: number;
  onSplitChange: (value: number) => void;
}

export function DbEditorPane(props: DbEditorPaneProps) {
  let containerRef: HTMLDivElement | undefined

  const clampSplitRatio = (value: number) => Math.min(80, Math.max(20, Math.round(value)))

  function startResize(event: MouseEvent) {
    const container = containerRef
    if (!container) {
      return
    }

    event.preventDefault()
    const bounds = container.getBoundingClientRect()

    const handlePointerMove = (moveEvent: MouseEvent) => {
      const relativeY = moveEvent.clientY - bounds.top
      const nextRatio = clampSplitRatio((relativeY / bounds.height) * 100)
      props.onSplitChange(nextRatio)
    }

    const handlePointerUp = () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
    }

    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp, { once: true })
  }

  return (
    <>
      {props.header}
      <div ref={containerRef} class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div class="min-h-0 overflow-hidden" style={{ height: `${props.splitRatio}%` }}>
          {props.editorMeta}
          {props.editor}
        </div>
        <button
          class="group relative h-3 shrink-0 cursor-row-resize bg-transparent p-0"
          title="Resize editor and result"
          onMouseDown={startResize}
        >
          <span
            class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--app-border)] transition-colors group-hover:bg-[var(--app-accent)]"
            aria-hidden="true"
          />
          <span
            class="absolute left-1/2 top-1/2 h-1.5 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--app-border)] transition-colors group-hover:bg-[var(--app-accent)]"
            aria-hidden="true"
          />
        </button>
        <div class="min-h-0 flex-1 overflow-hidden">{props.results}</div>
      </div>
    </>
  )
}
