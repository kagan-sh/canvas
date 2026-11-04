import { errorMessage } from "../errors.ts";
import { parseOps, type Doc } from "../model.ts";
import type { PageRequest, ThreadRow } from "../protocol.ts";
import type { Store } from "./store.ts";
import { changes, dump, normalizeName, shareText } from "../text.ts";
import type { PngUploads } from "./upload.ts";

/** Largest Send note the panel can paste. */
export const NOTE_MAX = 4000;

/** What the page and the agents need from kagan. The app wires the real host; tests pass fakes. */
export type Deps = {
  store: Store;
  png: PngUploads;
  /** Tells the panel the canvas changed. */
  announce(doc: Doc): Promise<void>;
  /** Pastes the share note into a thread without pressing Enter. */
  send(threadId: string, text: string): Promise<void>;
  /** The canvas a new thread opens on. */
  defaultName(threadId: string | undefined): Promise<string>;
  threads(threadId: string): Promise<ThreadRow[]>;
  /** Puts a base64 PNG on the clipboard. */
  writePng(base64: string): void;
};

/** An agent tool call. Throws a sentence per failure; the caller marks it as an error. */
export async function runTool(deps: Deps, name: string, input: Record<string, unknown>): Promise<string> {
  const { store } = deps;
  if (name === "canvas_read") {
    if (typeof input.name !== "string") {
      const names = await store.listNames();
      return names.length === 0 ? "No canvases yet." : names.join("\n");
    }
    return dump(await store.read(normalizeName(input.name)));
  }
  if (name === "canvas_edit") {
    if (typeof input.name !== "string" || input.name.trim() === "") throw new Error("canvas_edit needs a name");
    const result = await store.edit(normalizeName(input.name), parseOps(input.ops));
    await deps.announce(result.after);
    return changes(result.before, result.after, result.added);
  }
  throw new Error(`Unknown tool ${name}`);
}

/** One `kg canvas` command. */
export async function runCli(
  deps: Deps,
  command: string,
  argv: string[],
): Promise<{ exitCode: number; stdout?: string; stderr?: string }> {
  const usage = "Usage: kg canvas list\n       kg canvas show <name>";
  try {
    if (command === "list" && argv.length === 0) {
      const names = await deps.store.listNames();
      return { exitCode: 0, stdout: names.length === 0 ? "No canvases yet." : names.join("\n") };
    }
    if (command === "show" && argv.length > 0) {
      return { exitCode: 0, stdout: dump(await deps.store.read(normalizeName(argv.join(" ")))) };
    }
    return { exitCode: 1, stderr: usage };
  } catch (error) {
    return { exitCode: 1, stderr: errorMessage(error) };
  }
}

/** One message from the page. Throws a sentence per failure; the page hears it as a reply. */
export async function runPage(deps: Deps, request: PageRequest, context: { threadId?: string; projectId?: string }): Promise<unknown> {
  const { store } = deps;
  switch (request.call) {
    case "open": {
      const name = normalizeName(request.name ?? (await deps.defaultName(request.threadId ?? context.threadId)));
      return { name, doc: await store.open(name) };
    }
    case "list":
      return { names: await store.listNames() };
    case "context":
      return { threadId: context.threadId ?? null, projectId: context.projectId ?? null };
    case "apply": {
      const result = await store.edit(normalizeName(request.name), parseOps(request.ops));
      await deps.announce(result.after);
      return { doc: result.after, added: result.added };
    }
    case "undo":
    case "redo": {
      const doc = await store.step(normalizeName(request.name), request.call);
      await deps.announce(doc);
      return { doc };
    }
    case "delete": {
      const name = normalizeName(request.name);
      const names = await store.remove(name);
      return { names };
    }
    case "threads":
      return { threads: await deps.threads(request.threadId) };
    case "send": {
      if (request.note.length > NOTE_MAX) throw new Error(`The note is longer than ${NOTE_MAX} characters.`);
      const doc = await store.read(normalizeName(request.name));
      await deps.send(request.threadId, shareText(doc, request.note));
      return { sent: true };
    }
    case "pngChunk": {
      // Copy as image: the page sends the PNG in ordered pieces, and the last one puts it on the clipboard.
      const base64 = deps.png.accept(request.upload, request.index, request.last, request.data);
      if (base64 !== null) deps.writePng(base64);
      return {};
    }
  }
}
