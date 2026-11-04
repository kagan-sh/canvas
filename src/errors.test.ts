import { test } from "node:test";
import assert from "node:assert/strict";

import { errorMessage } from "./errors.ts";

test("an Error keeps its own message", () => {
  assert.equal(errorMessage(new Error("canvas store is locked")), "canvas store is locked");
});

test("anything thrown that is not an Error still reads as text", () => {
  assert.equal(errorMessage("nope"), "nope");
  assert.equal(errorMessage(undefined), "undefined");
});
