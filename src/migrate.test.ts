import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyOps, docSchema } from "./model.ts";
import { dump, normalizeName } from "./text.ts";

// Written by the 0.1.6 model code (kagan canvas, origin/main): the rows that users already have.
const saved = JSON.parse(readFileSync(new URL("./testdata/canvas-0.1.6.json", import.meta.url), "utf8")) as { doc: unknown };

test("a canvas saved by 0.1.6 parses with the current document schema", () => {
  const parsed = docSchema.safeParse(saved.doc);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
});

test("a 0.1.6 canvas still takes edits and reads back as text", () => {
  const doc = docSchema.parse(saved.doc);
  const edited = applyOps(doc, [{ op: "add", element: { type: "box", x: 0, y: 500, w: 200, h: 80, label: "later" } }]);
  assert.equal(edited.added[0], "b7");
  const text = dump(edited.doc);
  assert.match(text, /canvas "Team Board": 7 elements/);
  assert.match(text, /jobs/);
});

test("names match the rule 0.1.6 used, so an old row is found by its name", () => {
  assert.equal(normalizeName("  Team   Board "), "team-board");
  assert.equal(normalizeName("Ünïcode​ name"), "ünïcode-name");
  assert.equal(normalizeName("x".repeat(100)).length, 80);
});
