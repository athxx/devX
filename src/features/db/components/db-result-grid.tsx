import { For, Show } from 'solid-js'

type DbResultGridProps = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  editable?: boolean;
  dirtyRowKeys?: string[];
  pendingRowKeys?: string[];
  getCellValue: (row: Record<string, unknown>, column: string) => string;
  getRowKey: (row: Record<string, unknown>, index: number) => string;
  onCellInput?: (rowKey: string, column: string, value: string) => void;
  onSaveRow?: (rowKey: string) => void;
  onResetRow?: (rowKey: string) => void;
}

export function DbResultGrid(props: DbResultGridProps) {
  return (
    <div
      class="theme-code overflow-auto rounded-[18px] border"
      style={{ 'border-color': 'var(--app-border)' }}
    >
      <table class="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <For each={props.columns}>
              {(column) => (
                <th
                  class="theme-kv-head border-b px-3 py-2 text-left font-medium"
                  style={{ 'border-color': 'var(--app-border)' }}
                >
                  {column}
                </th>
              )}
            </For>
            <Show when={props.editable}>
              <th
                class="theme-kv-head border-b px-3 py-2 text-left font-medium"
                style={{ 'border-color': 'var(--app-border)' }}
              >
                Actions
              </th>
            </Show>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row, index) => {
              const rowKey = props.getRowKey(row, index())
              const dirty = () => props.dirtyRowKeys?.includes(rowKey) ?? false
              const pending = () => props.pendingRowKeys?.includes(rowKey) ?? false

              return (
                <tr>
                  <For each={props.columns}>
                    {(column) => (
                      <td
                        class="theme-kv-cell border-b px-3 py-2 align-top"
                        style={{ 'border-color': 'var(--app-border)' }}
                      >
                        <Show
                          when={props.editable && props.onCellInput}
                          fallback={
                            <pre class="m-0 whitespace-pre-wrap break-all font-mono text-xs">
                              {props.getCellValue(row, column)}
                            </pre>
                          }
                        >
                          <textarea
                            class="theme-input min-h-[44px] w-full rounded-md px-2 py-1 font-mono text-xs"
                            value={props.getCellValue(row, column)}
                            onInput={(event) =>
                              props.onCellInput?.(
                                rowKey,
                                column,
                                event.currentTarget.value,
                              )
                            }
                          />
                        </Show>
                      </td>
                    )}
                  </For>
                  <Show when={props.editable}>
                    <td
                      class="theme-kv-cell border-b px-3 py-2 align-top"
                      style={{ 'border-color': 'var(--app-border)' }}
                    >
                      <div class="flex items-center gap-2">
                        <button
                          class="theme-success h-7 rounded-md px-2.5 text-[11px] font-semibold"
                          disabled={!dirty() || pending()}
                          onClick={() => props.onSaveRow?.(rowKey)}
                        >
                          {pending() ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          class="theme-control h-7 rounded-md px-2.5 text-[11px]"
                          disabled={!dirty() || pending()}
                          onClick={() => props.onResetRow?.(rowKey)}
                        >
                          Reset
                        </button>
                      </div>
                    </td>
                  </Show>
                </tr>
              )
            }}
          </For>
        </tbody>
      </table>
    </div>
  )
}
