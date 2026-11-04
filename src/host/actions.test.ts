import { test } from "node:test";
import assert from "node:assert/strict";

import { NOTE_MAX, runCli, runPage, runTool, type Deps } from "./actions.ts";
import type { Doc } from "../model.ts";
import type { PageRequest, ThreadRow } from "../protocol.ts";
import type { Row } from "./rows.ts";
import { createStore } from "./store.ts";
import { PngUploads } from "./upload.ts";

function setup(seed: Record<string, Row> = {}) {
  const rows = new Map(Object.entries(seed));
  const store = createStore({
    async migrate() {},
    async get(name) {
      return rows.get(name);
    },
    async names() {
      return [...rows.keys()];
    },
    async save(name, doc, history, future) {
      rows.set(name, { doc, history, future });
    },
    async remove(names) {
      for (const name of names) rows.delete(name);
    },
  });
  const announced: Doc[] = [];
  const sent: { threadId: string; text: string }[] = [];
  const pngs: string[] = [];
  const threads: ThreadRow[] = [
    { id: "thr_1", title: "This thread", status: "idle" },
    { id: "thr_2", title: "Other", status: "active" },
  ];
  const deps: Deps = {
    store,
    png: new PngUploads(),
    async announce(doc) {
      announced.push(doc);
    },
    async send(threadId, text) {
      sent.push({ threadId, text });
    },
    async defaultName(threadId) {
      return threadId === undefined ? "canvas" : "my-app";
    },
    async threads() {
      return threads;
    },
    writePng(base64) {
      pngs.push(base64);
    },
  };
  return { deps, announced, sent, pngs, rows };
}

const open = { id: 1, call: "open" as const };
const apply = (ops: unknown[]): PageRequest => ({ id: 2, call: "apply", name: "board", ops: ops as never });

test("canvas_read lists canvases, or prints one with its summary", async () => {
  const { deps } = setup();
  assert.equal(await runTool(deps, "canvas_read", {}), "No canvases yet.");
  await deps.store.open("board");
  assert.equal(await runTool(deps, "canvas_read", {}), "board");
  await deps.store.edit("board", [{ op: "add", element: { type: "box", x: 10, y: 20, w: 200, h: 80, label: "web" } }]);
  const text = await runTool(deps, "canvas_read", { name: "Board" });
  assert.match(text, /canvas "board": 1 element using 10,20 to 210,100/);
  assert.match(text, /b1 box 10,20 200x80 "web"/);
});

test("canvas_edit applies ops, announces the result, and refuses a bad name or tool", async () => {
  const { deps, announced } = setup();
  await deps.store.open("board");
  const reply = await runTool(deps, "canvas_edit", {
    name: "board",
    ops: [{ op: "add", as: "web", element: { type: "box", x: 0, y: 0, w: 200, h: 80, label: "web" } }],
  });
  assert.match(reply, /added: b1/);
  assert.equal(announced.length, 1);
  await assert.rejects(runTool(deps, "canvas_edit", { name: " ", ops: [] }), /needs a name/);
  await assert.rejects(
    runTool(deps, "canvas_edit", { name: "nope", ops: [{ op: "add", element: { type: "box", x: 0, y: 0, w: 10, h: 10 } }] }),
    /No canvas named "nope"/,
  );
  await assert.rejects(runTool(deps, "draw", {}), /Unknown tool draw/);
});

test("the CLI lists, shows a normalized name, and names the usage on a wrong command", async () => {
  const { deps } = setup();
  assert.equal((await runCli(deps, "list", [])).stdout, "No canvases yet.");
  await deps.store.open("board");
  await deps.store.edit("board", [{ op: "add", element: { type: "box", x: 0, y: 0, w: 10, h: 10 } }]);
  assert.equal((await runCli(deps, "list", [])).stdout, "board");
  const shown = await runCli(deps, "show", ["BOARD"]);
  assert.equal(shown.exitCode, 0);
  assert.match(shown.stdout ?? "", /canvas "board": 1 element/);
  assert.match((await runCli(deps, "show", ["nope"])).stderr ?? "", /No canvas named "nope"/);
  assert.equal((await runCli(deps, "show", [])).exitCode, 1);
  assert.equal((await runCli(deps, "delete", [])).exitCode, 1);
});

test("opening a canvas uses the panel name, else the thread's project, and creates it", async () => {
  const { deps, rows } = setup();
  const named = (await runPage(deps, { ...open, name: "Sketch" }, {})) as { name: string; doc: Doc };
  assert.equal(named.name, "sketch");
  assert.equal(named.doc.elements.length, 0);
  assert.ok(rows.has("sketch"));

  const byThread = (await runPage(deps, { ...open, threadId: "thr_1" }, {})) as { name: string };
  assert.equal(byThread.name, "my-app");
  const byContext = (await runPage(deps, open, { threadId: "thr_2" })) as { name: string };
  assert.equal(byContext.name, "my-app");
});

test("the page reads the context, lists threads, and applies an edit", async () => {
  const { deps, announced } = setup();
  await runPage(deps, { ...open, name: "board" }, {});
  assert.deepEqual(await runPage(deps, { id: 3, call: "context" }, { threadId: "thr_1", projectId: "p1" }), {
    threadId: "thr_1",
    projectId: "p1",
  });
  assert.equal(((await runPage(deps, { id: 4, call: "threads", threadId: "thr_1" }, {})) as { threads: ThreadRow[] }).threads.length, 2);
  const result = (await runPage(deps, apply([{ op: "add", element: { type: "box", x: 0, y: 0, w: 10, h: 10 } }]), {})) as { doc: Doc; added: string[] };
  assert.deepEqual(result.added, ["b1"]);
  assert.equal(announced.at(-1)?.rev, 1);
});

test("undo, redo, and delete go through the page", async () => {
  const { deps } = setup();
  await runPage(deps, { ...open, name: "board" }, {});
  await runPage(deps, apply([{ op: "add", element: { type: "box", x: 0, y: 0, w: 10, h: 10 } }]), {});
  assert.equal(((await runPage(deps, { id: 5, call: "undo", name: "board" }, {})) as { doc: Doc }).doc.elements.length, 0);
  assert.equal(((await runPage(deps, { id: 6, call: "redo", name: "board" }, {})) as { doc: Doc }).doc.elements.length, 1);
  assert.deepEqual(await runPage(deps, { id: 7, call: "delete", name: "board" }, {}), { names: [] });
});

test("Send pastes the share note, and refuses a note that is too long", async () => {
  const { deps, sent } = setup();
  await runPage(deps, { ...open, name: "board" }, {});
  assert.deepEqual(await runPage(deps, { id: 8, call: "send", name: "board", threadId: "thr_2", note: "make it pretty" }, {}), { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.threadId, "thr_2");
  assert.match(sent[0]?.text ?? "", /make it pretty/);
  assert.match(sent[0]?.text ?? "", /kg canvas show board/);
  await assert.rejects(
    runPage(deps, { id: 9, call: "send", name: "board", threadId: "thr_2", note: "x".repeat(NOTE_MAX + 1) }, {}),
    /longer than 4000 characters/,
  );
});

test("a picture goes to the clipboard only after its last piece", async () => {
  const { deps, pngs } = setup();
  assert.deepEqual(await runPage(deps, { id: 10, call: "pngChunk", upload: "u", index: 0, last: false, data: "QUJD" }, {}), {});
  assert.deepEqual(pngs, []);
  assert.deepEqual(await runPage(deps, { id: 11, call: "pngChunk", upload: "u", index: 1, last: true, data: "REVG" }, {}), {});
  assert.deepEqual(pngs, ["QUJDREVG"]);
  await assert.rejects(
    runPage(deps, { id: 12, call: "pngChunk", upload: "v", index: 1, last: true, data: "QUJD" }, {}),
    /out of order/,
  );
});
