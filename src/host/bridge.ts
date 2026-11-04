import { pageRequestSchema, type PageRequest } from "../protocol.ts";

export type Parsed = { ok: true; request: PageRequest } | { ok: false; id: number | null; error: string };

/**
 * Checks one message from the page before any call runs. A message with a usable id gets an error
 * reply; one without an id cannot be answered, so the caller only logs it.
 */
export function parseRequest(message: unknown): Parsed {
  const id = typeof message === "object" && message !== null && "id" in message && typeof message.id === "number" && Number.isInteger(message.id) && message.id >= 0 ? message.id : null;
  const result = pageRequestSchema.safeParse(message);
  if (result.success) return { ok: true, request: result.data };
  const issue = result.error.issues[0]!;
  const where = issue.path.length === 0 ? "" : ` (${issue.path.map(String).join(" › ")})`;
  return { ok: false, id, error: `The page sent a request kagan does not understand${where}: ${issue.message}` };
}
