import { View } from "gpui-kit";
import { fail, next, reply, type Job } from "kagan/jobs";
import { post } from "kagan/panel";
import { context, log, onContextChanged, openPanel, pasteIntoThread, writeClipboardPng } from "kagan/host";
import { get, list, project } from "kagan/threads";
import { parseRequest } from "./bridge.ts";
import { type Doc, parseOps } from "./model.ts";
import { PANEL_ID, type PageRequest, type PluginMessage, type ThreadRow } from "./protocol.ts";
import { edit, listNames, open, read, remove, step } from "./store.ts";
import { changes, dump, normalizeName, shareText } from "./text.ts";
import { PngUploads } from "./upload.ts";

/** Largest Send note the panel can paste. */
const NOTE_MAX = 4000;
/** Most ops one canvas_edit call may carry. */
const OPS_MAX = 500;

/** Pieces of a picture the page is sending. */
const pngUploads = new PngUploads();

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
    // Check the message first. Then answer in the background: the page hears the result as a message, not as this reply.
    const parsed = parseRequest(job.message);
    if (!parsed.ok) {
      if (parsed.id !== null) await tell({ reply: parsed.id, ok: false, error: parsed.error });
      else log("warn", parsed.error);
      return null;
    }
    void answer(parsed.request);
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
      const ops = parseOps(input.ops);
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
    await tell({ reply: request.id, ok: true, value: value ?? {} });
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
      const ops = parseOps(request.ops);
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

/** Copy as image: the page sends the PNG in ordered pieces, and the last one puts it on the clipboard. */
function pngChunk(request: Extract<PageRequest, { call: "pngChunk" }>): Record<string, never> {
  const base64 = pngUploads.accept(request.upload, request.index, request.last, request.data);
  if (base64 !== null) writeClipboardPng(base64);
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
