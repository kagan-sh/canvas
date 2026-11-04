import assert from "node:assert/strict";
import { test } from "node:test";
import { LABEL_FONT, LINE_H, TEXT_MAX_W } from "./constants.ts";
import { boxHeightForLabel, boxLabelLines, textBounds, textInk, textLines, textWidth, visibleBoxLines, wrapLines } from "./layout.ts";

test("textWidth uses Nunito's own widths, not one width for every character", () => {
  assert.ok(textWidth("MMMM", LABEL_FONT) > textWidth("iiii", LABEL_FONT) * 3);
  assert.equal(Math.round(textWidth("web", LABEL_FONT)), Math.round(((844 + 534 + 587) / 1000) * LABEL_FONT));
});

test("wrapLines breaks on words, newlines, and over-long tokens at a pixel width", () => {
  const w = (text: string) => textWidth(text, LABEL_FONT);
  assert.deepEqual(wrapLines("web server", w("web server"), LABEL_FONT), ["web server"]);
  assert.deepEqual(wrapLines("web server cache", w("server"), LABEL_FONT), ["web", "server", "cache"]);
  assert.deepEqual(wrapLines("one\ntwo", 500, LABEL_FONT), ["one", "two"]);
  const split = wrapLines("abcdefghij", w("abcd"), LABEL_FONT);
  assert.ok(split.length >= 3);
  assert.equal(split.join(""), "abcdefghij");
  assert.ok(split.every((line) => w(line) <= w("abcd")));
});

test("free text wraps only past the wide text width", () => {
  const title = "TOOLS AND HOW THEY TALK (inside one regional API container)";
  assert.deepEqual(textLines(title), [title]);
  const essay = "Postgres = the truth (data, history, outbox). Redis = fast and temporary (job queues, cache, rate limits, live updates across replicas).";
  const lines = textLines(essay);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => textWidth(line, LABEL_FONT) <= TEXT_MAX_W));
});

test("text bounds grow a line step per wrapped line, and the ink sits inside them", () => {
  const one = textBounds(0, 100, "short");
  const two = textBounds(0, 100, `${"word ".repeat(40)}`.trim());
  assert.ok(Math.abs(two.h - one.h - (textLines(`${"word ".repeat(40)}`.trim()).length - 1) * LINE_H) < 0.01);
  const ink = textInk(0, 100, "short");
  assert.ok(ink.y >= one.y && ink.y + ink.h <= one.y + one.h);
  // One-line notes a line step apart do not touch.
  assert.ok(textInk(0, 100, "a").y + textInk(0, 100, "a").h <= textInk(0, 100 + LINE_H, "a").y);
});

test("a box label wraps to the inner width and extra lines clip", () => {
  const lines = boxLabelLines("Read Entra Graph signInActivity", 200);
  assert.ok(lines.length >= 2);
  assert.ok(lines.every((line) => textWidth(line, LABEL_FONT) <= 200 - 24));
  const visible = visibleBoxLines("Read Entra Graph signInActivity", 200, 44);
  assert.equal(visible.length, 1);
});

test("boxHeightForLabel grows with wrapped lines but does not change stored size", () => {
  assert.equal(boxHeightForLabel(200, "web"), 44);
  assert.ok(boxHeightForLabel(200, "a long label that will wrap onto two lines") > 44);
});
