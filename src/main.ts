import { View } from "gpui-kit";
import { fail, next, reply, type Job } from "kagan/jobs";
import { post } from "kagan/panel";
import { context, onContextChanged, openPanel, pasteIntoThread, writeClipboardPng } from "kagan/host";
import { get, list, project } from "kagan/threads";
import { z } from "zod";

import { type Doc, opSchema } from "./model.ts";
import { PANEL_ID, PNG_MAX_BYTES, type PageRequest, type PluginMessage, type ThreadRow } from "./protocol.ts";
import { edit, listNames, open, read, remove, step } from "./store.ts";
import { changes, dump, normalizeName, shareText } from "./text.ts";

/** Largest Send note the panel can paste. */
const NOTE_MAX = 4000;
/** Most ops one canvas_edit call may carry. */
const OPS_MAX = 500;

/** Base64 of the largest PNG plus room for the padding. */
const PNG_MAX_CHARS = Math.ceil((PNG_MAX_BYTES * 4) / 3) + 4;

/** PNG chunks sent so far, by upload id. Each upload is joined on its last chunk. */
const uploads = new Map<string, { parts: string[]; chars: number }>();

export default class Plugin extends View {
  init(_props: unknown, cx: { spawn(task: () => Promise<void>): void; notify(): void }): void {
    cx.spawn(async () => {
      for (;;) {
        const job = await next();
        handle(job).then(
          (value) => reply(job.id, value),
          (error) => fail(job.id, error instanceof Error ? error.message : String(error)),
        );
      }
    });
    cx.spawn(async () => {
      for (;;) {
        const current = context();
        await tell({ push: "context", threadId: current.threadId ?? null, projectId: current.projectId ?? null });
        await onContextChanged();
      }
    });
  }

  render(): string {
    return "";
  }
}

async function tell(message: PluginMessage): Promise<void> {
  // The page is gone while its panel is closed. Nothing is lost: the page asks again when it opens.
  await post(PANEL_ID, message).catch(() => undefined);
}

async function handle(job: Job): Promise<unknown> {
  if (job.kind === "tool") return tool(job);
  if (job.kind === "cli") return cli(job);
  if (job.kind === "command") {
    if (job.command === "open") await openPanel(PANEL_ID);
    return null;
  }
  if (job.kind === "page") {
    // Answer in the background: the page hears the result as a message, not as this reply.
    void answer(job.message as PageRequest);
    return null;
  }
  throw new Error(`Unknown job ${job.kind}`);
}

async function tool(job: Job): Promise<{ text: string; isError?: boolean }> {
  const input = job.input !== null && typeof job.input === "object" ? (job.input as Record<string, unknown>) : {};
  try {
    if (job.name === "canvas_read") {
      if (typeof input.name !== "string") {
        const names = await listNames();
        return { text: names.length === 0 ? "No canvases yet." : names.join("\n") };
      }
      return { text: dump(await read(normalizeName(input.name))) };
    }
    if (job.name === "canvas_edit") {
      if (typeof input.name !== "string" || input.name.trim() === "") throw new Error("canvas_edit needs a name");
      const ops = z.array(opSchema).min(1).max(OPS_MAX).parse(input.ops);
      const name = normalizeName(input.name);
      const result = await edit(name, ops);
      await announce(result.after);
      return { text: changes(result.before, result.after, result.added) };
    }
    throw new Error(`Unknown tool ${String(job.name)}`);
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), isError: true };
  }
}

async function cli(job: Job): Promise<{ exitCode: number; stdout?: string; stderr?: string }> {
  const argv = Array.isArray(job.argv) ? job.argv.map(String) : [];
  const usage = "Usage: kg canvas list\n       kg canvas show <name>";
  try {
    if (job.command === "list" && argv.length === 0) {
      const names = await listNames();
      return { exitCode: 0, stdout: names.length === 0 ? "No canvases yet." : names.join("\n") };
    }
    if (job.command === "show" && argv.length > 0) {
      return { exitCode: 0, stdout: dump(await read(normalizeName(argv.join(" ")))) };
    }
    return { exitCode: 1, stderr: usage };
  } catch (error) {
    return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
  }
}

/** Tells the page the canvas changed. The page reloads it when it is the one on screen. */
async function announce(doc: Doc): Promise<void> {
  await tell({ push: "changed", name: doc.name, rev: doc.rev });
}

async function answer(request: PageRequest): Promise<void> {
  try {
    const value = await call(request);
    await tell({ reply: request.id, ok: true, value });
  } catch (error) {
    await tell({ reply: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function call(request: PageRequest): Promise<unknown> {
  switch (request.call) {
    case "open": {
      const name = normalizeName(request.name ?? (await defaultName(request.threadId ?? context().threadId)));
      return { name, doc: await open(name) };
    }
    case "list":
      return { names: await listNames() };
    case "context": {
      const current = context();
      return { threadId: current.threadId ?? null, projectId: current.projectId ?? null };
    }
    case "apply": {
      const ops = z.array(opSchema).min(1).max(OPS_MAX).parse(request.ops);
      const result = await edit(normalizeName(request.name), ops);
      await announce(result.after);
      return { doc: result.after, added: result.added };
    }
    case "undo":
    case "redo": {
      const doc = await step(normalizeName(request.name), request.call);
      await announce(doc);
      return { doc };
    }
    case "delete": {
      const name = normalizeName(request.name);
      const names = await remove(name);
      await tell({ push: "deleted", name });
      return { names };
    }
    case "threads":
      return { threads: await threadRows(request.threadId) };
    case "send": {
      if (request.note.length > NOTE_MAX) throw new Error(`The note is longer than ${NOTE_MAX} characters.`);
      const doc = await read(normalizeName(request.name));
      await pasteIntoThread(request.threadId, shareText(doc, request.note));
      return { sent: true };
    }
    case "pngChunk":
      return pngChunk(request);
  }
}

/** Copy as image: the page sends the PNG in chunks, and the last one puts it on the clipboard. */
function pngChunk(request: Extract<PageRequest, { call: "pngChunk" }>): Record<string, never> {
  const pending = uploads.get(request.upload) ?? { parts: [], chars: 0 };
  pending.parts.push(request.data);
  pending.chars += request.data.length;
  if (pending.chars > PNG_MAX_CHARS) {
    uploads.delete(request.upload);
    throw new Error("The picture is larger than 8 MiB.");
  }
  if (!request.last) {
    uploads.set(request.upload, pending);
    return {};
  }
  uploads.delete(request.upload);
  const base64 = pending.parts.join("");
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if ((base64.length / 4) * 3 - padding > PNG_MAX_BYTES) throw new Error("The picture is larger than 8 MiB.");
  writeClipboardPng(base64);
  return {};
}

/** The canvas a new thread opens on: the project's name, as a slug, or "canvas" with no project. */
async function defaultName(threadId: string | undefined): Promise<string> {
  if (threadId === undefined) return "canvas";
  const thread = await get(threadId);
  // projects.get has no row for the personal project; its id slug is the name then.
  const label = await project(thread.projectId).then(
    (found) => found.name,
    () => thread.projectId.replace(/^proj_/, ""),
  );
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "canvas";
}

/** The thread on screen first, then the rest of its project's threads. */
async function threadRows(threadId: string): Promise<ThreadRow[]> {
  const current = await get(threadId);
  const threads = await list({ projectId: current.projectId, limit: 50 });
  return [current, ...threads.filter((thread) => thread.id !== threadId)].map((thread) => ({
    id: thread.id,
    title: thread.title || thread.id,
    status: thread.status,
  }));
}
