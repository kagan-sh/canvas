import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Element } from "../model.ts";
import { Shape } from "./shapes.tsx";

const paint = (element: Element, extra: { route?: { x: number; y: number }[]; labelAt?: { x: number; y: number; w: number; h: number } } = {}) =>
  renderToStaticMarkup(
    createElement(Shape, {
      element,
      route: extra.route ?? null,
      labelAt: extra.labelAt ?? null,
      theme: "light",
      faded: false,
      hideText: false,
      movable: true,
    }),
  );

test("a box draws its label and a grab area", () => {
  const html = paint({ type: "box", id: "b1", x: 10, y: 20, w: 200, h: 80, label: "web" });
  assert.match(html, /data-id="b1"/);
  assert.match(html, /translate\(10 20\)/);
  assert.match(html, /web/);
  assert.match(html, /cursor:move/);
});

test("a text element draws each line and hides when an editor is open", () => {
  const text: Element = { type: "text", id: "t1", x: 10, y: 40, text: "first\nsecond" };
  const shown = paint(text);
  assert.match(shown, /first/);
  assert.match(shown, /second/);
  const hidden = renderToStaticMarkup(
    createElement(Shape, { element: text, route: null, labelAt: null, theme: "dark", faded: false, hideText: true, movable: true }),
  );
  assert.doesNotMatch(hidden, /first/);
  assert.match(hidden, /data-id="t1"/);
});

test("an arrow draws its route and a label patch", () => {
  const arrow: Element = { type: "arrow", id: "a1", x1: 0, y1: 0, x2: 100, y2: 0, label: "yes" };
  const html = paint(arrow, { route: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], labelAt: { x: 35, y: -10, w: 30, h: 20 } });
  assert.match(html, /polyline/);
  assert.match(html, /yes/);
  assert.match(html, /fill="var\(--bg\)"/);
});

test("a faded element is dimmed while the eraser passes over it", () => {
  const html = renderToStaticMarkup(
    createElement(Shape, {
      element: { type: "path", id: "p1", points: [[0, 0], [10, 10]] } as Element,
      route: null,
      labelAt: null,
      theme: "light",
      faded: true,
      hideText: false,
      movable: false,
    }),
  );
  assert.match(html, /opacity="0.3"/);
});
