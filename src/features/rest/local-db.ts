import { readDevxSection, writeDevxSection } from '../../lib/indexed-db'
import type { RestWorkspaceState } from './models'

export type RestPersistentState = Pick<
  RestWorkspaceState,
  'collections' | 'requests' | 'environments'
>

export type RestTempState = Pick<
  RestWorkspaceState,
  | 'history'
  | 'lastResponse'
  | 'openRequestIds'
  | 'pinnedRequestIds'
  | 'activeCollectionId'
  | 'activeRequestId'
  | 'activeEnvironmentId'
>

export async function loadRestPersistentStateFromDb(): Promise<RestPersistentState | undefined> {
  return readDevxSection<RestPersistentState>(['api'])
}

export async function saveRestPersistentStateToDb(
  state: RestPersistentState,
): Promise<void> {
  await writeDevxSection(['api'], state)
}

export async function loadRestTempStateFromDb(): Promise<RestTempState | undefined> {
  return readDevxSection<RestTempState>(['temp', 'api'])
}

export async function saveRestTempStateToDb(state: RestTempState): Promise<void> {
  await writeDevxSection(['temp', 'api'], state)
}

export async function loadRestUiValueFromDb<T>(key: string): Promise<T | undefined> {
  return readDevxSection<T>(['temp', 'apiUi', key])
}

export async function saveRestUiValueToDb<T>(key: string, value: T): Promise<void> {
  await writeDevxSection(['temp', 'apiUi', key], value)
}
