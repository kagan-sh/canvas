import { test } from "node:test";
import assert from "node:assert/strict";

import { seedOf, sketchArrow, sketchBox, sketchFreehand } from "./sketch.ts";

test("a seed is stable per id and differs between ids", () => {
  assert.equal(seedOf("b1"), seedOf("b1"));
  assert.notEqual(seedOf("b1"), seedOf("b2"));
  assert.notEqual(seedOf(""), 0);
});

test("a box is one clean sketched pass in the requested color", () => {
  const paths = sketchBox(200, 80, seedOf("b1"), "#e03131");
  assert.ok(paths.length > 0);
  for (const path of paths) {
    assert.match(path.d ?? "", /^M/);
    assert.equal(path.stroke, "#e03131");
    assert.equal(path.strokeWidth, 2);
  }
});

test("arrowheads are added only for the ends that ask for them", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
  ];
  const none = sketchArrow(points, "none", 1, "#000");
  const end = sketchArrow(points, "end", 1, "#000");
  const both = sketchArrow(points, "both", 1, "#000");
  assert.ok(end.length > none.length);
  assert.ok(both.length > end.length);
  assert.deepEqual(sketchArrow([{ x: 0, y: 0 }], "end", 1, "#000"), []);
});

test("a freehand stroke is a closed filled outline", () => {
  const path = sketchFreehand([[0, 0], [10, 10], [20, 5]], "#1971c2", false);
  assert.match(path.d, /^M/);
  assert.match(path.d, /Z$/);
  assert.equal(path.fill, "#1971c2");
});
