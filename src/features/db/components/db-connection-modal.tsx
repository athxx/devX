import { For, Show, type JSX } from 'solid-js'
import { ControlDot } from '../../../components/ui-primitives'

type DbConnectionModalProps<TKind> = {
  open: boolean;
  mode: 'create' | 'edit' | null;
  title: string;
  kind: TKind;
  kinds: TKind[];
  renderKindLabel: (kind: TKind) => string;
  showEnvironment?: boolean;
  environment: string;
  aliasField: JSX.Element;
  form: JSX.Element;
  onClose: () => void;
  onKindChange: (kind: TKind) => void;
  onEnvironmentChange: (value: string) => void;
  onSave: () => void;
}

export function DbConnectionModal<TKind>(props: DbConnectionModalProps<TKind>) {
  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-[330] flex items-center justify-center bg-[rgba(15,23,42,0.3)] px-4 py-6" data-db-menu-root>
        <div class="theme-panel-soft w-full max-w-4xl rounded-[22px] border p-5 shadow-[0_24px_60px_rgba(15,23,42,0.24)]" style={{ 'border-color': 'var(--app-border)' }}>
          <div class="flex items-start justify-between gap-4 border-b pb-4" style={{ 'border-color': 'var(--app-border)' }}>
            <div>
              <p class="theme-eyebrow text-xs font-semibold uppercase tracking-[0.22em]">
                {props.mode === 'create' ? 'New Connection' : 'Edit Connection'}
              </p>
              <h3 class="theme-text mt-2 text-lg font-semibold">{props.title}</h3>
            </div>
            <button class="traffic-dot-button inline-flex h-5 w-5 items-center justify-center rounded-full p-0" onClick={props.onClose}>
              <ControlDot size="small" variant="delete" />
            </button>
          </div>

          <div class="mt-4 grid gap-4">
            <div class="grid gap-3 md:grid-cols-2">
              {props.aliasField}
              <label class="grid gap-1">
                <span class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">Database Type</span>
                <select class="theme-input h-8 rounded-md px-2.5 text-sm" value={String(props.kind)} onInput={(event) => props.onKindChange(event.currentTarget.value as TKind)}>
                  <For each={props.kinds}>
                    {(kind) => <option value={String(kind)}>{props.renderKindLabel(kind)}</option>}
                  </For>
                </select>
              </label>
              <Show when={props.showEnvironment !== false}>
                <label class="grid gap-1">
                  <span class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">Environment</span>
                  <select class="theme-input h-8 rounded-md px-2.5 text-sm" value={props.environment} onInput={(event) => props.onEnvironmentChange(event.currentTarget.value)}>
                    <option value="local">Local</option>
                    <option value="dev">Dev</option>
                    <option value="staging">Staging</option>
                    <option value="prod">Prod</option>
                  </select>
                </label>
              </Show>
            </div>

            {props.form}
          </div>

          <div class="mt-5 flex items-center justify-end gap-2">
            <button class="theme-control h-8 rounded-md px-3 text-sm font-medium" onClick={props.onClose}>Cancel</button>
            <button class="theme-success h-8 rounded-md px-3 text-sm font-semibold" onClick={props.onSave}>Save</button>
          </div>
        </div>
      </div>
    </Show>
  )
}
