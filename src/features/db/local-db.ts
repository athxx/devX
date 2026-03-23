import { readDevxSection, writeDevxSection } from '../../lib/indexed-db'

export type DbUiState = {
  sidebarConnectionsHeight?: number
}

export async function loadDbPersistentStateFromDb(): Promise<unknown | null> {
  return (await readDevxSection<unknown>(['db'])) ?? null
}

export async function saveDbPersistentStateToDb(state: unknown): Promise<void> {
  await writeDevxSection(['db'], state)
}

export async function loadDbTempStateFromDb(): Promise<unknown | null> {
  return (await readDevxSection<unknown>(['temp', 'db'])) ?? null
}

export async function saveDbTempStateToDb(state: unknown): Promise<void> {
  await writeDevxSection(['temp', 'db'], state)
}

export async function loadDbUiStateFromDb(): Promise<DbUiState | null> {
  return (await readDevxSection<DbUiState>(['temp', 'dbUi'])) ?? null
}

export async function saveDbUiStateToDb(state: DbUiState): Promise<void> {
  await writeDevxSection(['temp', 'dbUi'], state)
}
