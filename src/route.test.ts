import assert from "node:assert/strict";
import { test } from "node:test";
import type { Point, Rect } from "./layout.ts";
import type { Element } from "./model.ts";
import { layoutOf } from "./route.ts";
import { toolsDiagram } from "./testdata/tools-diagram.ts";

const box = (id: string, x: number, y: number, w: number, h: number, label?: string): Element => ({
  id,
  type: "box",
  x,
  y,
  w,
  h,
  ...(label === undefined ? {} : { label }),
});
const arrow = (id: string, from: string, to: string, label?: string): Element => ({
  id,
  type: "arrow",
  x1: 0,
  y1: 0,
  x2: 0,
  y2: 0,
  from,
  to,
  ...(label === undefined ? {} : { label }),
});
const text = (id: string, x: number, y: number, body: string): Element => ({ id, type: "text", x, y, text: body });

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Whether a right-angle path enters the inside of r. */
function enters(path: Point[], r: Rect): boolean {
  return path.slice(1).some((q, i) => {
    const p = path[i]!;
    if (p.y === q.y) return r.y < p.y && p.y < r.y + r.h && Math.max(Math.min(p.x, q.x), r.x) < Math.min(Math.max(p.x, q.x), r.x + r.w);
    return r.x < p.x && p.x < r.x + r.w && Math.max(Math.min(p.y, q.y), r.y) < Math.min(Math.max(p.y, q.y), r.y + r.h);
  });
}

const orthogonal = (path: Point[]) => path.slice(1).every((q, i) => q.x === path[i]!.x || q.y === path[i]!.y);

/** Whether two paths run along the same line for more than a few pixels. */
function share(a: Point[], b: Point[]): boolean {
  const runs = (path: Point[]) =>
    path.slice(1).map((q, i) => {
      const p = path[i]!;
      const horizontal = p.y === q.y;
      return horizontal
        ? { horizontal, at: p.y, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) }
        : { horizontal, at: p.x, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y) };
    });
  return runs(a).some((p) =>
    runs(b).some((q) => p.horizontal === q.horizontal && Math.abs(p.at - q.at) < 8 && Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo) > 4),
  );
}

const notes = (elements: Element[]) => layoutOf(elements).notes.map((note) => note.text);

test("the tools diagram that came out mangled now draws cleanly, and the one label with no room is reported", () => {
  const layout = layoutOf(toolsDiagram);
  const boxes = toolsDiagram.filter((e) => e.type === "box");
  const arrows = toolsDiagram.filter((e) => e.type === "arrow");
  for (const a of arrows) {
    const path = layout.routes.get(a.id)!;
    assert.ok(orthogonal(path), `${a.id} is not right-angled`);
    for (const b of boxes) if (b.id !== a.from && b.id !== a.to) assert.ok(!enters(path, b), `${a.id} runs through ${b.id}`);
  }
  // a237 (BullMQ to features) used to cut through the outbox listener and ride a238's line.
  assert.ok(!enters(layout.routes.get("a237")!, boxes.find((b) => b.id === "b217")!));
  for (let i = 0; i < arrows.length; i++)
    for (let j = i + 1; j < arrows.length; j++)
      assert.ok(!share(layout.routes.get(arrows[i]!.id)!, layout.routes.get(arrows[j]!.id)!), `${arrows[i]!.id} rides ${arrows[j]!.id}`);
  const labels = [...layout.labels.values()];
  for (const label of labels) for (const b of boxes) assert.ok(!overlap(label, b), "a label sits on a box");
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) assert.ok(!overlap(labels[i]!, labels[j]!), "two labels collide");
  assert.ok(layout.labels.has("a237") && layout.labels.has("a238"));
  // t239 and t240 no longer wrap onto each other; the title stays one line.
  assert.deepEqual(notes(toolsDiagram), [`a234 label "add job" hidden: needs 99px of clear line`]);
});

test("a bound arrow detours around a box in its way", () => {
  const elements = [box("b1", 0, 0, 200, 80), box("b2", 300, 0, 200, 80), box("b3", 600, 0, 200, 80), arrow("a4", "b1", "b3")];
  const path = layoutOf(elements).routes.get("a4")!;
  assert.ok(orthogonal(path));
  assert.ok(!enters(path, elements[1] as Rect));
  assert.equal(path[0]!.x >= 0 && path[0]!.x <= 200, true);
  assert.equal(path[path.length - 1]!.x >= 600 && path[path.length - 1]!.x <= 800, true);
  assert.deepEqual(notes(elements), []);
});

test("aligned boxes with nothing between them keep one straight line", () => {
  const path = layoutOf([box("b1", 0, 0, 100, 100), box("b2", 300, 0, 100, 100), arrow("a3", "b1", "b2")]).routes.get("a3")!;
  assert.deepEqual(path, [
    { x: 100, y: 50 },
    { x: 300, y: 50 },
  ]);
});

test("two arrows never ride one line, even both ways between the same boxes", () => {
  const elements = [box("b1", 0, 0, 200, 80), box("b2", 400, 0, 200, 80), arrow("a3", "b1", "b2"), arrow("a4", "b2", "b1")];
  const layout = layoutOf(elements);
  assert.ok(!share(layout.routes.get("a3")!, layout.routes.get("a4")!));
  assert.deepEqual(notes(elements), []);
});

test("an arrow that cannot get out without crossing a box is reported", () => {
  const ring = [box("b1", 100, 100, 300, 60), box("b2", 100, 300, 300, 60), box("b3", 100, 160, 60, 140), box("b4", 340, 160, 60, 140)];
  const elements = [...ring, box("b5", 180, 180, 140, 100), box("b6", 600, 200, 100, 60), arrow("a7", "b5", "b6")];
  assert.ok(notes(elements).some((note) => /^a7 runs through b[1-4]$/.test(note)));
});

test("text that wraps onto the text below is reported; one-line notes a line apart are not", () => {
  const long = "word ".repeat(40).trim();
  assert.ok(notes([text("t1", 0, 0, long), text("t2", 0, 30, "next note")]).includes("t1 overlaps t2"));
  assert.deepEqual(notes([text("t1", 0, 0, "first note"), text("t2", 0, 24, "second note")]), []);
});

test("text across a box edge or on a box label is reported; a note inside an empty lane is not", () => {
  assert.ok(notes([box("b1", 0, 0, 300, 80, "web"), text("t2", 250, 20, "sticks out of the box")]).includes("t2 overlaps b1"));
  assert.ok(notes([box("b1", 0, 0, 300, 80, "web"), text("t2", 130, 46, "on")]).includes("t2 covers b1's label"));
  assert.deepEqual(notes([box("b1", 0, 0, 600, 400), text("t2", 20, 40, "lane title")]), []);
});

test("a free arrow drawn across text is reported", () => {
  const elements: Element[] = [text("t1", 100, 100, "a note"), { id: "a2", type: "arrow", x1: 0, y1: 95, x2: 400, y2: 95 }];
  assert.ok(notes(elements).includes("a2 runs through t1"));
});

test("an arrow label slides off a box beside the line instead of sitting on it", () => {
  const elements = [box("b1", 0, 0, 100, 80), box("b2", 500, 0, 100, 80), box("b3", 260, 0, 80, 30), arrow("a4", "b1", "b2", "GraphQL")];
  const layout = layoutOf(elements);
  assert.deepEqual(layout.routes.get("a4"), [
    { x: 100, y: 40 },
    { x: 500, y: 40 },
  ]);
  const label = layout.labels.get("a4");
  assert.ok(label);
  for (const b of elements.slice(0, 3)) assert.ok(!overlap(label, b as Rect));
  assert.deepEqual(notes(elements), []);
});

test("a label with no room is hidden and says how much line it needs", () => {
  const elements = [box("b1", 0, 0, 100, 80), box("b2", 140, 0, 100, 80), arrow("a3", "b1", "b2", "add job")];
  const layout = layoutOf(elements);
  assert.equal(layout.labels.has("a3"), false);
  const [note] = notes(elements);
  assert.match(note ?? "", /^a3 label "add job" hidden: needs (\d+)px of clear line$/);
  const need = Number(/needs (\d+)px/.exec(note!)![1]);
  // Widening the gap to what the note asks for makes the label fit.
  const wide = [box("b1", 0, 0, 100, 80), box("b2", 100 + need, 0, 100, 80), arrow("a3", "b1", "b2", "add job")];
  assert.ok(layoutOf(wide).labels.has("a3"));
  assert.deepEqual(notes(wide), []);
});

test("labels on close parallel arrows never sit on each other", () => {
  const elements = [
    box("b1", 0, 0, 100, 20),
    box("b2", 600, 0, 100, 20),
    box("b3", 0, 24, 100, 20),
    box("b4", 600, 24, 100, 20),
    arrow("a5", "b1", "b2", "first label"),
    arrow("a6", "b3", "b4", "second label"),
  ];
  const layout = layoutOf(elements);
  const one = layout.labels.get("a5");
  const two = layout.labels.get("a6");
  assert.ok(one && two);
  assert.ok(!overlap(one, two));
});
