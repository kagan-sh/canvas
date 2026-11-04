import { test } from "node:test";
import assert from "node:assert/strict";

import { translated } from "../clip.ts";
import type { Element } from "../model.ts";
import {
  HANDLES,
  MIN_BOX,
  boxAt,
  constrained,
  deleteOps,
  elementBounds,
  hintFor,
  inside,
  normalized,
  pointsBounds,
  previewed,
  resized,
  union,
} from "./geometry.ts";

test("shift makes a box square, in the direction of the drag", () => {
  assert.deepEqual(constrained("box", { x: 10, y: 10 }, { x: 40, y: 25 }), { x: 40, y: 40 });
  assert.deepEqual(constrained("box", { x: 10, y: 10 }, { x: -20, y: 0 }), { x: -20, y: -20 });
});

test("shift snaps an arrow to the nearest 15 degrees and keeps its length", () => {
  assert.deepEqual(constrained("arrow", { x: 0, y: 0 }, { x: 100, y: 5 }), { x: 100, y: 0 });
  const snapped = constrained("line", { x: 0, y: 0 }, { x: 100, y: 84 });
  assert.equal(Math.round(Math.atan2(snapped.y, snapped.x) / (Math.PI / 12)) * 15, 45);
});

test("other tools keep the raw point", () => {
  assert.deepEqual(constrained("pen", { x: 0, y: 0 }, { x: 7, y: 3 }), { x: 7, y: 3 });
});

test("a negative drag flips the box instead of making it negative", () => {
  assert.deepEqual(resized({ x: 100, y: 100, w: 50, h: 50 }, "e", -200, 0), { x: -50, y: 100, w: 150, h: 50 });
});

test("a box never shrinks below MIN_BOX", () => {
  const box = resized({ x: 0, y: 0, w: 50, h: 50 }, "se", -49, -49);
  assert.equal(box.w, MIN_BOX);
  assert.equal(box.h, MIN_BOX);
});

test("dragging a north handle moves the top edge and keeps the bottom", () => {
  assert.deepEqual(resized({ x: 0, y: 0, w: 100, h: 100 }, "n", 0, -20), { x: 0, y: -20, w: 100, h: 120 });
});

test("every handle has a cursor", () => {
  assert.equal(HANDLES.length, 8);
  assert.equal(new Set(HANDLES).size, 8);
});

test("pointsBounds covers every point", () => {
  assert.deepEqual(pointsBounds([{ x: 5, y: 5 }, { x: -5, y: 20 }]), { x: -5, y: 5, w: 10, h: 15 });
});

test("elementBounds follows the element's own shape", () => {
  assert.deepEqual(elementBounds({ type: "box", id: "b1", x: 1, y: 2, w: 3, h: 4 }, []), { x: 1, y: 2, w: 3, h: 4 });
  assert.deepEqual(elementBounds({ type: "path", id: "p1", points: [[0, 0], [4, 6]] }, []), { x: 0, y: 0, w: 4, h: 6 });
});

test("union covers the rectangle corners, not just their origins", () => {
  assert.deepEqual(union([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 5, h: 5 }]), { x: 0, y: 0, w: 25, h: 10 });
});

test("normalized and inside", () => {
  assert.deepEqual(normalized({ x: 10, y: 10 }, { x: 0, y: 0 }), { x: 0, y: 0, w: 10, h: 10 });
  assert.equal(inside({ x: 1, y: 1, w: 2, h: 2 }, { x: 0, y: 0, w: 10, h: 10 }), true);
  assert.equal(inside({ x: 1, y: 1, w: 20, h: 2 }, { x: 0, y: 0, w: 10, h: 10 }), false);
});

const elements: Element[] = [
  { type: "box", id: "b1", x: 0, y: 0, w: 50, h: 50 },
  { type: "box", id: "b2", x: 100, y: 0, w: 50, h: 50 },
  { type: "arrow", id: "a1", x1: 50, y1: 25, x2: 100, y2: 25, from: "b1", to: "b2" },
];

test("deleting a box takes its arrows with it, once", () => {
  assert.deepEqual(deleteOps(["b1", "a1"], elements), [{ op: "delete", id: "b1" }]);
});

test("an arrow whose endpoints stay is deleted on its own", () => {
  assert.deepEqual(deleteOps(["a1"], elements), [{ op: "delete", id: "a1" }]);
});

test("both boxes take the arrow once", () => {
  const ids = deleteOps(["b1", "b2", "a1"], elements).map((op) => ("id" in op ? op.id : null));
  assert.deepEqual(ids, ["b1", "b2"]);
});

test("boxAt picks the topmost box under the point", () => {
  const stacked: Element[] = [
    { type: "box", id: "b1", x: 0, y: 0, w: 100, h: 100 },
    { type: "box", id: "b2", x: 50, y: 50, w: 100, h: 100 },
  ];
  assert.equal(boxAt(stacked, { x: 75, y: 75 }), "b2");
  assert.equal(boxAt(stacked, { x: 10, y: 10 }), "b1");
  assert.equal(boxAt(stacked, { x: 500, y: 500 }), undefined);
});

test("previewed moves a selection by the drag delta", () => {
  const box: Element = { type: "box", id: "b1", x: 0, y: 0, w: 10, h: 10 };
  assert.deepEqual(
    previewed(box, { kind: "move", ids: ["b1"], start: { x: 0, y: 0 }, current: { x: 5, y: 7 } }),
    translated(box, 5, 7),
  );
});

test("the hint names the next action for each tool", () => {
  const box: Element = { type: "box", id: "b1", x: 0, y: 0, w: 10, h: 10 };
  assert.match(hintFor("select", []) ?? "", /Space \+ drag/);
  assert.match(hintFor("select", [box]) ?? "", /Double-click/);
  assert.match(hintFor("select", [box, box]) ?? "", /move them together/);
  assert.match(hintFor("arrow", []) ?? "", /connect them/);
  assert.match(hintFor("box", []) ?? "", /square/);
  assert.match(hintFor("eraser", []) ?? "", /erase/);
  assert.equal(hintFor("pen", []), null);
});
