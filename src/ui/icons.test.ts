import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as icons from "./icons.tsx";

const drawn = Object.entries(icons).filter(([name]) => name.endsWith("Icon") && name !== "HeadsIcon");

test("every toolbar icon draws an svg with a stroke path", () => {
  assert.ok(drawn.length >= 18);
  for (const [name, Icon] of drawn) {
    const html = renderToStaticMarkup(createElement(Icon as () => React.JSX.Element));
    assert.match(html, /^<svg /, name);
    assert.match(html, /stroke="currentColor"/, name);
    assert.match(html, /(path|line|rect|circle|polyline)/, name);
    assert.match(html, /aria-hidden="true"/, name);
  }
});

test("the arrowhead icon draws one, two, or no heads", () => {
  for (const heads of ["none", "start", "end", "both"] as const) {
    const html = renderToStaticMarkup(createElement(icons.HeadsIcon, { heads }));
    assert.match(html, /^<svg /, heads);
    assert.equal(html.includes("<polyline"), heads !== "none");
  }
});
