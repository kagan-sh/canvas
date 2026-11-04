import { test } from "node:test";
import assert from "node:assert/strict";

import { applyOps, emptyDoc } from "./model.ts";
import { changes, dump, normalizeName, shareText, shellWord, summary } from "./text.ts";

const board = applyOps(emptyDoc("board"), [
  { op: "add", element: { type: "box", x: 10, y: 20, w: 200, h: 80, label: "web" } },
  { op: "add", element: { type: "box", x: 400, y: 20, w: 200, h: 80, label: "db" } },
  { op: "add", element: { type: "arrow", x1: 0, y1: 0, x2: 0, y2: 0, from: "b1", to: "b2" } },
]).doc;

test("the summary says where the drawing sits, or that it is empty", () => {
  assert.equal(summary(emptyDoc("board")), 'canvas "board" is empty; draw near 0,0');
  assert.equal(summary(board), 'canvas "board": 3 elements using 10,20 to 600,100');
});

test("a read is a summary, one line per element, then the layout notes", () => {
  const crowded = applyOps(board, [
    { op: "add", element: { type: "text", x: 0, y: 300, text: "word ".repeat(40).trim() } },
    { op: "add", element: { type: "text", x: 0, y: 330, text: "next" } },
  ]).doc;
  const text = dump(crowded);
  assert.match(text, /^canvas "board": 5 elements/);
  assert.match(text, /b1 box 10,20 200x80 "web"/);
  assert.match(text, /a3 arrow .* b1->b2/);
  assert.match(text, /layout: t4 overlaps t5/);
});

test("an edit reply holds only the lines that changed, plus what it added or deleted", () => {
  const recolored = applyOps(board, [{ op: "update", id: "b2", patch: { color: "green" } }]).doc;
  const reply = changes(board, recolored, []);
  assert.match(reply, /canvas "board": 3 elements/);
  assert.match(reply, /b2 box 400,20 200x80 green "db"/);
  assert.doesNotMatch(reply, /b1 box/);

  const deleted = applyOps(board, [{ op: "delete", id: "a3" }]).doc;
  assert.match(changes(board, deleted, []), /deleted: a3/);
  assert.doesNotMatch(changes(board, deleted, []), /added:/);
});

test("an edit counts older layout notes elsewhere instead of repeating them", () => {
  const crowded = applyOps(board, [
    { op: "add", element: { type: "text", x: 0, y: 300, text: "word ".repeat(40).trim() } },
    { op: "add", element: { type: "text", x: 0, y: 330, text: "next" } },
  ]).doc;
  const far = applyOps(crowded, [{ op: "add", element: { type: "box", x: 2000, y: 0, w: 100, h: 80, label: "far" } }]).doc;
  const reply = changes(crowded, far, ["b6"]);
  assert.doesNotMatch(reply, /t4 overlaps t5/);
  assert.match(reply, /1 older layout note elsewhere on the canvas/);
  assert.match(changes(crowded, applyOps(crowded, [{ op: "move", id: "t5", dx: 0, dy: 1 }]).doc, []), /t4 overlaps t5/);
});

test("the share note points at the canvas and leaves the drawing out", () => {
  const note = shareText(board, "make it pretty");
  assert.match(note, /^make it pretty\n\nThe canvas beside you is "board"/);
  assert.match(note, /kg canvas show board/);
  assert.match(note, /Then do what I asked\./);
  assert.doesNotMatch(note, /b1 box/);
  assert.match(shareText(board, ""), /In one or two sentences, tell me what you see/);
});

test("a shell word is quoted only when it needs it", () => {
  assert.equal(shellWord("board"), "board");
  assert.equal(shellWord("my-canvas.v2"), "my-canvas.v2");
  assert.equal(shellWord("my canvas"), "'my canvas'");
  assert.equal(shellWord("it's"), "'it'\\''s'");
});

test("names ignore case, surrounding space, and extra space inside", () => {
  assert.equal(normalizeName("  Team   Board "), "team-board");
  assert.equal(normalizeName("Ünïcode​ name"), "ünïcode-name");
  assert.equal(normalizeName("x".repeat(100)).length, 80);
});
