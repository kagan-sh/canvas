import type { Doc, Op } from "./model.ts";

/** The web panel's id in kagan.json. `post` delivers to this panel. */
export const PANEL_ID = "canvas";

export type ThreadRow = { id: string; title: string; status: string };

/** Page -> plugin, sent with `kagan.post`. The plugin answers with a `Reply` through `post`. */
export type PageRequest = { id: number } & (
  | { call: "open"; threadId?: string; name?: string }
  | { call: "list" }
  | { call: "apply"; name: string; ops: Op[] }
  | { call: "undo" | "redo"; name: string }
  | { call: "delete"; name: string }
  | { call: "threads"; threadId: string }
  | { call: "send"; name: string; threadId: string; note: string }
  | { call: "pngChunk"; upload: string; index: number; last: boolean; data: string }
);

/** Plugin -> page, through `post(PANEL_ID, message)`. The page hears it as a `kagan` event. */
export type PluginMessage =
  | { reply: number; ok: true; value: unknown }
  | { reply: number; ok: false; error: string }
  | { push: "changed"; name: string; rev: number }
  | { push: "deleted"; name: string }
  | { push: "context"; threadId: string | null; projectId: string | null };

export type OpenValue = { name: string; doc: Doc };
export type ApplyValue = { doc: Doc; added: string[] };
export type ListValue = { names: string[] };
export type ThreadsValue = { threads: ThreadRow[] };

/** Largest base64 string the page sends in one `pngChunk`. Keeps each post under the 1 MiB cap. */
export const PNG_CHUNK_CHARS = 512 * 1024;

/** The most a PNG may decode to, as `writeClipboardPng` allows. */
export const PNG_MAX_BYTES = 8 * 1024 * 1024;
