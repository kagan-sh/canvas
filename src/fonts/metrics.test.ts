import { test } from "node:test";
import assert from "node:assert/strict";

import { advance, ASCENT, DESCENT } from "./metrics.ts";

test("every printable ASCII glyph has a positive advance", () => {
  for (let code = 0x20; code <= 0x7e; code++) {
    assert.ok(advance(String.fromCharCode(code)) > 0, `U+${code.toString(16)}`);
  }
});

test("a punctuation glyph outside ASCII has its own advance, and an unknown one still advances", () => {
  assert.equal(advance("…"), 700);
  assert.ok(advance("\u4e2d") > 0);
});

test("the ascent and descent describe a line box taller than the text", () => {
  assert.ok(ASCENT + DESCENT > 1);
});
