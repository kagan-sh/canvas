import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SendBar } from "./SendBar.tsx";

test("without a thread, Send is off and the row says why", () => {
  const html = renderToStaticMarkup(createElement(SendBar, { threadId: null, canvasName: "board", narrow: false }));
  assert.match(html, /aria-label="Send to"/);
  assert.match(html, /Open a thread to send this canvas to it/);
  assert.match(html, /<button type="button" class="cv-primary" disabled="">Send<\/button>/);
});

test("with a canvas, the row names the command it will paste", () => {
  const html = renderToStaticMarkup(createElement(SendBar, { threadId: "thr_1", canvasName: "my-app", narrow: true }));
  assert.match(html, /kg canvas show my-app/);
  assert.match(html, /placeholder="Note for the agent"/);
});
