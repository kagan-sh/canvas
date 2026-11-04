import { test } from "node:test";
import assert from "node:assert/strict";

import type { Row } from "./rows.ts";
import { UNDO_DEPTH, createStore } from "./store.ts";

function memoryRows(seed: Record<string, Row> = {}) {
  const rows = new Map(Object.entries(seed));
  let migrations = 0;
  let failures = 0;
  return {
    rows,
    failMigration(times: number) {
      failures = times;
    },
    migrations: () => migrations,
    async migrate() {
      migrations++;
      if (failures > 0) {
        failures--;
        throw new Error("database is locked");
      }
    },
    async get(name: string) {
      return rows.get(name);
    },
    async names() {
      return [...rows.keys()];
    },
    async save(name: string, doc: string, history: string, future: string) {
      rows.set(name, { doc, history, future });
    },
    async remove(names: string[]) {
      for (const name of names) rows.delete(name);
    },
  };
}

const add = (label: string) => [{ op: "add" as const, element: { type: "box" as const, x: 0, y: 0, w: 100, h: 80, label } }];

test("opening a new canvas saves it empty, and opening it again reads the same doc", async () => {
  const rows = memoryRows();
  const store = createStore(rows);
  const first = await store.open("board");
  assert.deepEqual(first, { name: "board", rev: 0, next: 1, elements: [] });
  assert.deepEqual(await store.listNames(), ["board"]);
  const second = await store.open("board");
  assert.equal(second.rev, 0);
});

test("an edit pushes the pre-change elements, and undo and redo walk the stacks", async () => {
  const store = createStore(memoryRows());
  await store.open("board");
  await store.edit("board", add("a"));
  await store.edit("board", add("b"));
  assert.equal((await store.read("board")).elements.length, 2);

  assert.deepEqual(
    (await store.step("board", "undo")).elements.map((element) => element.type === "box" && element.label),
    ["a"],
  );
  assert.equal((await store.step("board", "undo")).elements.length, 0);
  assert.equal((await store.step("board", "redo")).elements.length, 1);
  // A new edit drops the redo steps, as every editor does.
  await store.edit("board", add("c"));
  await assert.rejects(store.step("board", "redo"), /Nothing to redo/);
  assert.deepEqual(
    (await store.read("board")).elements.map((element) => element.type === "box" && element.label),
    ["a", "c"],
  );
});

test("undo keeps at most UNDO_DEPTH steps", async () => {
  const store = createStore(memoryRows());
  await store.open("board");
  for (let i = 0; i < UNDO_DEPTH + 5; i++) await store.edit("board", add(`box ${i}`));
  for (let i = 0; i < UNDO_DEPTH; i++) await store.step("board", "undo");
  await assert.rejects(store.step("board", "undo"), /Nothing to undo/);
  assert.equal((await store.read("board")).elements.length, 5);
});

test("two edits sent together run one after the other, so neither is lost", async () => {
  const store = createStore(memoryRows());
  await store.open("board");
  await Promise.all([store.edit("board", add("a")), store.edit("board", add("b"))]);
  assert.equal((await store.read("board")).elements.length, 2);
});

test("reading or editing a canvas that does not exist names the real ones", async () => {
  const store = createStore(memoryRows());
  await store.open("board");
  await assert.rejects(store.read("nope"), /No canvas named "nope"\. Known canvases: board\./);
  await assert.rejects(store.edit("nope", add("a")), /No canvas named "nope"/);
});

test("deleting removes the raw name and its normalized row", async () => {
  const store = createStore(memoryRows({ "My App": { doc: "{}", history: "[]", future: "[]" } }));
  assert.deepEqual(await store.listNames(), ["My App"]);
  assert.deepEqual(await store.remove("My App"), []);
});

test("a failed migration is retried on the next store call", async () => {
  const rows = memoryRows();
  rows.failMigration(1);
  const store = createStore(rows);
  await assert.rejects(store.listNames(), /database is locked/);
  assert.deepEqual(await store.listNames(), []);
  assert.equal(rows.migrations(), 2);
});

test("a corrupt saved document fails with a sentence that names the canvas", async () => {
  const store = createStore(memoryRows({ board: { doc: "{", history: "[]", future: "[]" } }));
  await assert.rejects(store.read("board"), /canvas "board" could not be read/);
});
