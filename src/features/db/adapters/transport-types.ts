// Wire/transport types shared between service.ts (which owns the websocket
// relay) and the pure adapters (which build command messages and parse the
// raw row shapes). Kept in their own module so adapters never need to import
// service.ts — preventing an import cycle.

/**
 * Envelope sent to the Go relay over the `/db` websocket. The per-command
 * fields live inside `payload`; the relay echoes `id` back on the response.
 */
export type DbSocketCommandMessage = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
};

/** Row shape returned by the SQL explorer (table/view listing) queries. */
export type SqlExplorerRow = {
  schema_name?: unknown;
  table_name?: unknown;
  table_type?: unknown;
  SCHEMA_NAME?: unknown;
  TABLE_NAME?: unknown;
  TABLE_TYPE?: unknown;
};

/** Row shape returned by the SQL routine (function listing) queries. */
export type SqlExplorerRoutineRow = {
  schema_name?: unknown;
  routine_name?: unknown;
  SCHEMA_NAME?: unknown;
  ROUTINE_NAME?: unknown;
};
