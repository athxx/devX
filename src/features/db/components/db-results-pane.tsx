import type { JSX } from 'solid-js'

type DbResultsPaneProps = {
  children: JSX.Element
}

export function DbResultsPane(props: DbResultsPaneProps) {
  return <div class="min-h-0 overflow-hidden">{props.children}</div>
}
