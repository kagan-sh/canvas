import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyDoc, type Element } from "../model.ts";
import { docOf, stepsOf } from "./rows.ts";

const box: Element = { type: "box", id: "b1", x: 0, y: 0, w: 100, h: 80 };
const doc = { ...emptyDoc("board"), rev: 2, next: 2, elements: [box] };

test("a saved document reads back", () => {
  const found = { doc: JSON.stringify(doc), history: "[]", future: "[]" };
  assert.deepEqual(docOf(found, "board"), doc);
});

test("a corrupt document fails with a sentence that names the canvas", () => {
  assert.throws(() => docOf({ doc: "{", history: "[]", future: "[]" }, "board"), /canvas "board" could not be read/);
  assert.throws(() => docOf({ doc: '{"name":"board"}', history: "[]", future: "[]" }, "board"), /canvas "board" could not be read/);
});

test("undo stacks read back, and a corrupt or old one degrades to no steps", () => {
  const good = { doc: JSON.stringify(doc), history: JSON.stringify([[box]]), future: JSON.stringify([]) };
  assert.deepEqual(stepsOf(good), { history: [[box]], future: [] });
  assert.deepEqual(stepsOf({ doc: "{}", history: "not json", future: "[]" }), { history: [], future: [] });
  assert.deepEqual(stepsOf({ doc: "{}", history: '["old shape"]', future: "{}" }), { history: [], future: [] });
});
