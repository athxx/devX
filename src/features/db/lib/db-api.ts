import type { DbConnection, DbResultPayload } from "../models";
import {
  buildDbRelayUrl,
  executeDbSocketCommand,
  type DbSocketCommandMessage,
} from "./db-transport";

export { buildDbRelayUrl };
export type { DbSocketCommandMessage } from "./db-transport";

/**
 * Single facade over the DB relay transport (mirrors dbx's `lib/api.ts`).
 *
 * Everything that talks to the Go backend goes through here, so the transport
 * (WebSocket today, swappable later) stays decoupled from callers and we have
 * one place to add timing / error instrumentation.
 */
export function sendDbCommand(
  message: DbSocketCommandMessage,
  connection: Pick<DbConnection, "kind">,
): Promise<DbResultPayload> {
  return executeDbSocketCommand(message, connection);
}
