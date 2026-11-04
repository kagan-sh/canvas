import { View } from "gpui-kit";
import { fail, next, reply, type Job } from "kagan/jobs";
import { post } from "kagan/panel";
import { context, log, onContextChanged, openPanel, pasteIntoThread, writeClipboardPng } from "kagan/host";
import { migrate, query, transaction } from "kagan/database";
import { get, list, project, projects } from "kagan/threads";
import { runCli, runPage, runTool, type Deps } from "./host/actions.ts";
import { parseRequest } from "./host/bridge.ts";
import { errorMessage } from "./errors.ts";
import { defaultName } from "./host/names.ts";
import { PANEL_ID, type PluginMessage, type ThreadRow } from "./protocol.ts";
import { createSqlRows } from "./host/sql.ts";
import { createStore } from "./host/store.ts";
import { PngUploads } from "./host/upload.ts";

const png = new PngUploads();
const store = createStore(createSqlRows({ migrate, query, transaction }));

const deps: Deps = {
  store,
  png,
  announce: async (doc) => tell({ push: "changed", name: doc.name, rev: doc.rev }),
  send: (threadId, text) => pasteIntoThread(threadId, text),
  defaultName: (threadId) => defaultName(threadId, { thread: get, project, projects }),
  threads: threadRows,
  writePng: writeClipboardPng,
};

export default class Plugin extends View {
  init(_props: unknown, cx: { spawn(task: () => Promise<void>): void; notify(): void }): void {
    cx.spawn(async () => {
      for (;;) {
        const job = await next();
        handle(job).then(
          (value) => reply(job.id, value),
          (error) => fail(job.id, errorMessage(error)),
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
    return { text: await runTool(deps, String(job.name), input) };
  } catch (error) {
    return { text: errorMessage(error), isError: true };
  }
}

async function cli(job: Job): Promise<{ exitCode: number; stdout?: string; stderr?: string }> {
  const argv = Array.isArray(job.argv) ? job.argv.map(String) : [];
  return runCli(deps, String(job.command), argv);
}

async function answer(request: Parameters<typeof runPage>[1]): Promise<void> {
  try {
    const value = await runPage(deps, request, context());
    await tell({ reply: request.id, ok: true, value: value ?? {} });
  } catch (error) {
    await tell({ reply: request.id, ok: false, error: errorMessage(error) });
  }
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
