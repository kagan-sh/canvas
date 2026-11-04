import { test } from "node:test";
import assert from "node:assert/strict";

import { base64, TooLarge } from "./png.ts";

test("bytes become standard base64, in chunks that keep every byte", () => {
  assert.equal(base64(new Uint8Array([65, 66, 67])), "QUJD");
  const bytes = new Uint8Array(0x8000 * 2 + 3).map((_, index) => index % 256);
  assert.equal(Buffer.from(base64(bytes), "base64").equals(Buffer.from(bytes)), true);
});

test("too large is its own error so the panel can say why", () => {
  const cause = new TooLarge("too big");
  assert.equal(cause instanceof Error, true);
  assert.equal(cause.message, "too big");
});
