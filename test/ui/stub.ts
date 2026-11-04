// A stand-in for kagan's plugin side, for tests outside kagan. It answers the protocol in
// src/protocol.ts from an in-memory store, with the real drawing model (src/model.ts).
// It proves the page, not the kagan window.
import { applyOps, emptyDoc, type Doc, type Op } from "../../src/model.ts";

type Request = { id: number; call: string; [key: string]: any };

const docs = new Map<string, Doc>();
// A page can start with saved drawings: window.__seed maps a canvas name to the ops that draw it.
const seeded = (globalThis as { __seed?: Record<string, Op[]> }).__seed ?? {};
for (const [name, ops] of Object.entries(seeded)) docs.set(name, applyOps(emptyDoc(name), ops).doc);
const undo = new Map<string, Doc[]>();
const redo = new Map<string, Doc[]>();
const pngParts: { index: number; last: boolean; data: string }[] = [];
const sent: { name: string; threadId: string; note: string }[] = [];
const corrupt = new Set<string>();
const calls: string[] = [];
const THREADS = [
  { id: "thr_here", title: "This thread", status: "idle" },
  { id: "thr_other", title: "Fix the login bug", status: "running" },
];

function docFor(name: string): Doc {
  let doc = docs.get(name);
  if (doc === undefined) {
    doc = emptyDoc(name);
    docs.set(name, doc);
  }
  return doc;
}

function dispatch(detail: unknown) {
  window.dispatchEvent(new CustomEvent("kagan", { detail }));
}
const ok = (id: number, value: unknown) => dispatch({ reply: id, ok: true, value });
const fail = (id: number, error: string) => dispatch({ reply: id, ok: false, error });

function write(name: string, next: Doc) {
  docs.set(name, next);
}

function handle(request: Request) {
  const { id } = request;
  calls.push(request.call);
  try {
    // A corrupted answer for a call the test asked to break: a value that does not fit the protocol.
    if (corrupt.delete(request.call)) return ok(id, { names: "oops" });
    switch (request.call) {
      case "open": {
        const name: string = request.name ?? "Main";
        ok(id, { name, doc: docFor(name) });
        return;
      }
      case "list":
        docFor("Main");
        ok(id, { names: [...docs.keys()] });
        return;
      case "apply": {
        const name: string = request.name;
        const current = docFor(name);
        const result = applyOps(current, request.ops as Op[]);
        undo.set(name, [...(undo.get(name) ?? []), current]);
        redo.set(name, []);
        write(name, result.doc);
        // Like main.ts: the change is announced before the call answers.
        dispatch({ push: "changed", name, rev: result.doc.rev });
        ok(id, { doc: result.doc, added: result.added });
        return;
      }
      case "undo":
      case "redo": {
        const name: string = request.name;
        const from = request.call === "undo" ? undo : redo;
        const to = request.call === "undo" ? redo : undo;
        const stack = from.get(name) ?? [];
        const previous = stack.pop();
        if (previous === undefined) return fail(id, "Nothing to undo.");
        const current = docFor(name);
        from.set(name, stack);
        to.set(name, [...(to.get(name) ?? []), current]);
        // Like the store and main.ts: a step is a new revision, announced before the call answers.
        const next = { ...previous, rev: current.rev + 1 };
        write(name, next);
        dispatch({ push: "changed", name, rev: next.rev });
        ok(id, { doc: next });
        return;
      }
      case "delete": {
        docs.delete(request.name);
        docFor("Main");
        ok(id, { names: [...docs.keys()] });
        return;
      }
      case "context":
        ok(id, { threadId: "thr_here", projectId: "p1" });
        return;
      case "threads":
        ok(id, { threads: THREADS });
        return;
      case "send":
        sent.push({ name: request.name, threadId: request.threadId, note: request.note });
        ok(id, {});
        return;
      case "pngChunk":
        pngParts.push({ index: request.index, last: request.last, data: request.data });
        ok(id, {});
        return;
      default:
        fail(id, `Unknown call ${request.call}`);
    }
  } catch (cause) {
    fail(id, cause instanceof Error ? cause.message : String(cause));
  }
}

Object.assign(window, {
  kagan: {
    post(message: unknown) {
      const request = message as Request;
      setTimeout(() => handle(request), 0);
      return true;
    },
  },
  kaganStub: {
    corruptNext(call: string) {
      corrupt.add(call);
    },
    calls: () => [...calls],
    clearCalls() {
      calls.length = 0;
    },
    push(message: unknown) {
      dispatch(message);
    },
    // What the plugin does when an agent calls canvas_edit: apply the ops, then push "changed".
    agentEdit(name: string, ops: unknown[]) {
      const result = applyOps(docFor(name), ops as Op[]);
      write(name, result.doc);
      dispatch({ push: "changed", name, rev: result.doc.rev });
      return result.added;
    },
    docs: () => Object.fromEntries([...docs].map(([name, doc]) => [name, doc])),
    sent: () => sent,
    pngParts: () => pngParts,
  },
});
