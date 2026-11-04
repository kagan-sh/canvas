import assert from "node:assert/strict";
import { test } from "node:test";
import { standaloneSvg } from "./export.ts";

test("crops to the drawing with a margin, writes theme variables in as colors, and embeds the font", () => {
  const svg = standaloneSvg(
    '<path stroke="var(--ex-stroke)" fill="var(--ex-missing, #fff)"/><text fill="var(--ex-unknown)">hi</text>',
    { x: 100, y: 50, w: 200, h: 80 },
    (name) => ({ "--ex-stroke": "#1e1e1e" })[name] ?? "",
    "#ffffff",
    "@font-face{font-family:Nunito}",
  );
  assert.equal(svg,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="68 18 264 144" width="264" height="144">'
    + '<style>@font-face{font-family:Nunito}</style><rect x="68" y="18" width="264" height="144" fill="#ffffff"/>'
    + '<path stroke="#1e1e1e" fill="#fff"/><text fill="currentColor">hi</text></svg>');
});
