import assert from "node:assert/strict";
import { test } from "node:test";
import { fitView, PHONE_CHROME, pinchView, type PinchStart } from "./gesture.ts";

const start: PinchStart = {
  view: { x: 100, y: 200, scale: 1 },
  a: { x: 40, y: 80 },
  b: { x: 140, y: 80 },
};

test("a pinch that only spreads the fingers zooms around the midpoint", () => {
  const next = pinchView(start, { x: 20, y: 80 }, { x: 160, y: 80 });
  assert.equal(next.scale, 1.4);
  const midX = 90;
  const midY = 80;
  const worldX = start.view.x + midX / start.view.scale;
  const worldY = start.view.y + midY / start.view.scale;
  assert.ok(Math.abs(next.x + midX / next.scale - worldX) < 1e-9);
  assert.ok(Math.abs(next.y + midY / next.scale - worldY) < 1e-9);
});

test("fingers that slide together pan without zooming", () => {
  const next = pinchView(start, { x: 60, y: 100 }, { x: 160, y: 100 });
  assert.equal(next.scale, 1);
  assert.equal(next.x, 80);
  assert.equal(next.y, 180);
});

test("fingers that have not moved leave the view alone", () => {
  assert.deepEqual(pinchView(start, start.a, start.b), start.view);
});

test("a huge drawing opens at a readable scale, centered, instead of shrinking to a speck", () => {
  const bounds = { x: 0, y: 0, w: 4000, h: 2000 };
  const width = 390;
  const view = fitView(bounds, width, 700, PHONE_CHROME, 0.5);
  assert.equal(view.scale, 0.5);
  const cx = PHONE_CHROME.left + (width - PHONE_CHROME.left - PHONE_CHROME.right) / 2;
  assert.ok(Math.abs(view.x + cx / view.scale - (bounds.x + bounds.w / 2)) < 1e-6);
});

test("a phone fit keeps a wide drawing inside the chrome, including its right edge", () => {
  const bounds = { x: 0, y: 0, w: 1400, h: 500 };
  const width = 390;
  const height = 700;
  const view = fitView(bounds, width, height, PHONE_CHROME);
  const left = view.x + PHONE_CHROME.left / view.scale;
  const right = view.x + (width - PHONE_CHROME.right) / view.scale;
  const top = view.y + PHONE_CHROME.top / view.scale;
  const bottom = view.y + (height - PHONE_CHROME.bottom) / view.scale;
  assert.ok(left <= bounds.x);
  assert.ok(right >= bounds.x + bounds.w);
  assert.ok(top <= bounds.y);
  assert.ok(bottom >= bounds.y + bounds.h);
});
