import assert from "node:assert/strict";
import { test } from "node:test";
import { clipCenter, copyElements, decodeClip, encodeClip, pasteOps } from "./clip.ts";
import { applyOps, emptyDoc, type Element } from "./model.ts";

const drawing = applyOps(emptyDoc("t"), [
  { op: "add", as: "a", element: { type: "box", x: 0, y: 0, w: 100, h: 50, label: "a" } },
  { op: "add", as: "b", element: { type: "box", x: 300, y: 0, w: 100, h: 50 } },
  { op: "add", as: "c", element: { type: "box", x: 0, y: 300, w: 100, h: 50 } },
  { op: "add", element: { type: "arrow", x1: 0, y1: 0, x2: 0, y2: 0, from: "a", to: "b" } },
  { op: "add", element: { type: "arrow", x1: 0, y1: 0, x2: 0, y2: 0, from: "a", to: "c" } },
]).doc;

test("a paste keeps arrows between copied boxes attached to the new boxes", () => {
  const clip = copyElements(["b1", "b2", "a4"], drawing.elements);
  const pasted = applyOps(drawing, pasteOps(clip, 0, 500));
  assert.deepEqual(pasted.added, ["b6", "b7", "a8"]);
  const arrow = pasted.doc.elements.find((e) => e.id === "a8");
  assert.equal(arrow?.type === "arrow" && `${arrow.from}->${arrow.to}`, "b6->b7");
  const box = pasted.doc.elements.find((e) => e.id === "b6");
  assert.equal(box?.type === "box" && box.y, 500);
});

test("an arrow copied without both of its boxes pastes as a free arrow along its route", () => {
  const clip = copyElements(["b1", "a5"], drawing.elements);
  const arrow = clip.find((e) => e.id === "a5") as Extract<Element, { type: "arrow" }>;
  assert.equal(arrow.from, undefined);
  assert.equal(arrow.to, undefined);
  assert.equal(arrow.y2, 300);
  assert.doesNotThrow(() => applyOps(drawing, pasteOps(clip, 10, 10)));
});

test("the clip round-trips through the clipboard text and rejects anything else", () => {
  const clip = copyElements(["b1", "b2", "a4"], drawing.elements);
  assert.deepEqual(decodeClip(encodeClip(clip)), clip);
  assert.equal(decodeClip("hello"), null);
  assert.equal(decodeClip('{"bbCanvas":1,"elements":[{"type":"box"}]}'), null);
  assert.deepEqual(clipCenter(clip), { x: 200, y: 25 });
});

test("pasted text whose arrows point at boxes outside it pastes those arrows free", () => {
  const foreign = decodeClip(
    '{"bbCanvas":1,"elements":[{"id":"b1","type":"box","x":0,"y":0,"w":10,"h":10},{"id":"a2","type":"arrow","x1":0,"y1":0,"x2":50,"y2":0,"from":"b1","to":"b9"}]}',
  )!;
  const pasted = applyOps(drawing, pasteOps(foreign, 0, 0));
  const arrow = pasted.doc.elements.at(-1)!;
  assert.equal(arrow.type === "arrow" && (arrow.from ?? arrow.to), undefined);
});
