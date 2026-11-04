import { z } from "zod";

import { docSchema, opSchema } from "./model.ts";

/** The web panel's id in kagan.json. `post` delivers to this panel. */
export const PANEL_ID = "canvas";

/** Largest base64 string the page sends in one `pngChunk`. Keeps each post under the 1 MiB cap. */
export const PNG_CHUNK_CHARS = 512 * 1024;

/** The most a PNG may decode to, as `writeClipboardPng` allows. */
export const PNG_MAX_BYTES = 8 * 1024 * 1024;

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const canvasName = z.string().min(1).max(200);
const threadId = z.string().min(1).max(200);
const note = z.string().max(4000);
const pngData = z.string().min(1).max(PNG_CHUNK_CHARS);

/** Page -> plugin. Every field is checked before any call runs; anything else is refused. */
export const pageRequestSchema = z.discriminatedUnion("call", [
  z.strictObject({ id: count, call: z.literal("open"), threadId: threadId.optional(), name: canvasName.optional() }),
  z.strictObject({ id: count, call: z.literal("list") }),
  z.strictObject({ id: count, call: z.literal("context") }),
  z.strictObject({ id: count, call: z.literal("apply"), name: canvasName, ops: z.array(opSchema).min(1).max(500) }),
  z.strictObject({ id: count, call: z.literal("undo"), name: canvasName }),
  z.strictObject({ id: count, call: z.literal("redo"), name: canvasName }),
  z.strictObject({ id: count, call: z.literal("delete"), name: canvasName }),
  z.strictObject({ id: count, call: z.literal("threads"), threadId }),
  z.strictObject({ id: count, call: z.literal("send"), name: canvasName, threadId, note }),
  z.strictObject({
    id: count,
    call: z.literal("pngChunk"),
    upload: z.string().min(1).max(64),
    index: count,
    last: z.boolean(),
    data: pngData,
  }),
]);
export type PageRequest = z.infer<typeof pageRequestSchema>;

/** Plugin -> page, through `post(PANEL_ID, message)`. The page hears it as a `kagan` event. */
export const pluginMessageSchema = z.union([
  z.strictObject({ reply: count, ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ reply: count, ok: z.literal(false), error: z.string().max(2000) }),
  z.strictObject({ push: z.literal("changed"), name: canvasName, rev: count }),
  z.strictObject({ push: z.literal("deleted"), name: canvasName }),
  z.strictObject({ push: z.literal("context"), threadId: z.string().nullable(), projectId: z.string().nullable() }),
]);
export type PluginMessage = z.infer<typeof pluginMessageSchema>;

const threadRow = z.strictObject({ id: z.string(), title: z.string(), status: z.string() });
const doc = docSchema;

/** What each call answers with. The page checks every answer against its entry here. */
export const valueSchemas = {
  open: z.strictObject({ name: z.string(), doc }),
  list: z.strictObject({ names: z.array(z.string()) }),
  context: z.strictObject({ threadId: z.string().nullable(), projectId: z.string().nullable() }),
  threads: z.strictObject({ threads: z.array(threadRow) }),
  apply: z.strictObject({ doc, added: z.array(z.string()) }),
  undo: z.union([doc, z.strictObject({ doc })]),
  redo: z.union([doc, z.strictObject({ doc })]),
  delete: z.strictObject({ names: z.array(z.string()) }),
  send: z.strictObject({ sent: z.literal(true) }),
  pngChunk: z.strictObject({}),
} as const;

export type OpenValue = z.infer<typeof valueSchemas.open>;
export type ApplyValue = z.infer<typeof valueSchemas.apply>;
export type ListValue = z.infer<typeof valueSchemas.list>;
export type ContextValue = z.infer<typeof valueSchemas.context>;
export type ThreadsValue = z.infer<typeof valueSchemas.threads>;
export type ThreadRow = z.infer<typeof threadRow>;
