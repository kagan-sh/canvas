import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Toasts, toast } from "./toast.tsx";

test("a toast shows its message, detail, and error style, then expires", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  toast.info("Copied the canvas as an image");
  assert.match(renderToStaticMarkup(createElement(Toasts)), /Copied the canvas as an image/);

  toast.error("Couldn't load the canvas", "store is locked");
  const html = renderToStaticMarkup(createElement(Toasts));
  assert.match(html, /Couldn&#x27;t load the canvas/);
  assert.match(html, /store is locked/);
  assert.match(html, /cv-toast-error/);

  t.mock.timers.tick(4500);
  assert.doesNotMatch(renderToStaticMarkup(createElement(Toasts)), /Copied the canvas/);
});
