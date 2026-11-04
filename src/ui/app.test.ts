import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The panel is a page component, but nothing in its first paint needs a browser. A small
// stand-in for the theme and pointer globals lets the empty panel render as markup.
const noop = () => undefined;
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: { documentElement: {}, head: {}, body: {} },
});
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: () => ({ colorScheme: "dark" }) });
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    addEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    kagan: { post: () => true },
  },
});

const { App } = await import("./App.tsx");

test("the panel paints its toolbar, menu, and send bar before a canvas arrives", () => {
  const html = renderToStaticMarkup(createElement(App));
  assert.match(html, /cv-root/);
  assert.match(html, /aria-label="Tools"/);
  assert.match(html, /aria-label="Main menu"/);
  assert.match(html, /aria-label="Rectangle"/);
  assert.match(html, /aria-label="Note for the agent"/);
  assert.match(html, />Send</);
  assert.match(html, /100%/);
  assert.match(html, /Open a thread to send this canvas to it/);
});
