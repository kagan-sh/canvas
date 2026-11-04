import { test } from "node:test";
import assert from "node:assert/strict";

import { themeFrom } from "./theme.ts";

test("the host's color scheme picks the palette", () => {
  assert.equal(themeFrom("light"), "light");
  assert.equal(themeFrom("dark"), "dark");
  assert.equal(themeFrom("light dark"), "dark");
  assert.equal(themeFrom(""), "light");
});
