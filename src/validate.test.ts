import { test } from "node:test";
import assert from "node:assert/strict";

import { applyOps, docSchema, emptyDoc, parseOps, type Doc } from "./model.ts";

function withBox(x: number): Doc {
  return applyOps(emptyDoc("board"), [{ op: "add", element: { type: "box", x, y: 0, w: 100, h: 80, label: "a" } }]).doc;
}

test("a move that takes an element past the canvas edge is refused and changes nothing", () => {
  const doc = withBox(999999);
  const before = JSON.stringify(doc);
  assert.throws(() => applyOps(doc, [{ op: "move", id: "b1", dx: 2, dy: 0 }]), /past the canvas edge/);
  assert.equal(JSON.stringify(doc), before);
});

test("the canvas stays readable and movable after a refused move", () => {
  const doc = withBox(999999);
  assert.throws(() => applyOps(doc, [{ op: "move", id: "b1", dx: 2, dy: 0 }]));
  const moved = applyOps(doc, [{ op: "move", id: "b1", dx: -2, dy: 0 }]).doc;
  assert.equal(docSchema.safeParse(moved).success, true);
  assert.equal(moved.elements[0]!.type === "box" && moved.elements[0]!.x, 999997);
});

test("in a batch, one bad move leaves the whole batch unapplied", () => {
  const doc = withBox(1);
  const before = JSON.stringify(doc);
  assert.throws(
    () =>
      applyOps(doc, [
        { op: "add", element: { type: "box", x: 0, y: 200, w: 50, h: 50 } },
        { op: "move", id: "b1", dx: 1000000, dy: 0 },
      ]),
    /past the canvas edge/,
  );
  assert.equal(JSON.stringify(doc), before);
});

test("a patch key the element does not have is refused, not dropped", () => {
  assert.throws(() => applyOps(withBox(0), [{ op: "update", id: "b1", patch: { lable: "lost" } } as never]), /not valid/);
});

test("from and to are refused on a box, including a missing id", () => {
  assert.throws(() => applyOps(withBox(0), [{ op: "update", id: "b1", patch: { from: "b1" } }]), /only an arrow/);
  assert.throws(() => applyOps(withBox(0), [{ op: "update", id: "b1", patch: { to: "missing" } }]), /only an arrow/);
});

test("an add with an unknown key, or from and to on a box, is refused", () => {
  assert.throws(() => applyOps(emptyDoc("board"), [{ op: "add", element: { type: "box", x: 0, y: 0, w: 1, h: 1, lable: "x" } as never }]), /not valid/);
  assert.throws(() => applyOps(emptyDoc("board"), [{ op: "add", element: { type: "box", x: 0, y: 0, w: 1, h: 1, from: "b1" } as never }]), /not valid/);
});

test("an arrow still takes from, to and a valid patch", () => {
  const doc = applyOps(emptyDoc("board"), [
    { op: "add", as: "a", element: { type: "box", x: 0, y: 0, w: 100, h: 80 } },
    { op: "add", as: "b", element: { type: "box", x: 300, y: 0, w: 100, h: 80 } },
    { op: "add", element: { type: "arrow", x1: 100, y1: 40, x2: 300, y2: 40, from: "a", to: "b" } },
  ]).doc;
  const next = applyOps(doc, [{ op: "update", id: "a3", patch: { label: "jobs", heads: "both" } }]).doc;
  const arrow = next.elements[2]!;
  assert.equal(arrow.type === "arrow" && arrow.from, "b1");
  assert.equal(arrow.type === "arrow" && arrow.label, "jobs");
});

test("a malformed batch is refused with one plain message", () => {
  assert.throws(() => parseOps([{ op: "explode" }]), /That change is not valid/);
  assert.throws(() => parseOps([]), /not valid/);
});
