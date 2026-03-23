import { Show } from 'solid-js'

type DbTransactionBarProps = {
  sessionId: string | null | undefined;
  disabled?: boolean;
  onBegin: () => void;
  onCommit: () => void;
  onRollback: () => void;
}

export function DbTransactionBar(props: DbTransactionBarProps) {
  return (
    <div
      class="flex items-center gap-2 border-b px-3 py-2"
      style={{ 'border-color': 'var(--app-border)' }}
    >
      <div class="min-w-0 flex-1">
        <p class="text-xs font-semibold">Transaction</p>
        <p class="theme-text-soft truncate text-[11px]">
          <Show when={props.sessionId} fallback={'Autocommit mode'}>
            {`Session ${props.sessionId}`}
          </Show>
        </p>
      </div>
      <Show when={!props.sessionId}>
        <button
          class="theme-control h-7 rounded-md px-2.5 text-[11px] font-medium"
          disabled={props.disabled}
          onClick={props.onBegin}
        >
          Begin
        </button>
      </Show>
      <Show when={props.sessionId}>
        <>
          <button
            class="theme-control h-7 rounded-md px-2.5 text-[11px] font-medium"
            disabled={props.disabled}
            onClick={props.onRollback}
          >
            Rollback
          </button>
          <button
            class="theme-success h-7 rounded-md px-2.5 text-[11px] font-semibold"
            disabled={props.disabled}
            onClick={props.onCommit}
          >
            Commit
          </button>
        </>
      </Show>
    </div>
  )
}
