// @ts-check

import { PathBuilder, div } from "gpui-kit";
import { arrowLabelAt, arrowRoute, textBounds, textLines, visibleBoxLines, BOX_PAD, LABEL_FONT, ARROW_FONT } from "./layout.js";
import { arrowPoints } from "./model.js";

const LIMIT = 1_000_000;

/** @param {number} value */
function finite(value) {
  return Number.isFinite(value) && Math.abs(value) <= LIMIT;
}

/** @param {number} x @param {number} y @param {number} w @param {number} h */
function legalRect(x, y, w, h) {
  return finite(x) && finite(y) && finite(w) && finite(h) && w >= 0 && h >= 0 && x + w <= LIMIT && y + h <= LIMIT;
}

/**
 * World → surface pixels. `view.x` / `view.y` are screen pan (same as panel `viewX` /
 * `viewY`): local = world * scale + pan. Matches `toWorld` in panel.js.
 *
 * @param {number} wx
 * @param {number} wy
 * @param {{ x: number, y: number, scale: number }} view
 */
function screen(wx, wy, view) {
  return [wx * view.scale + view.x, wy * view.scale + view.y];
}

/**
 * @param {string} hex
 * @param {import("gpui-kit").Path} path
 */
function paint(path, hex) {
  return window.paint_path(path, /** @type {import("gpui-kit").Color} */ (hex));
}

/**
 * @param {[number, number][]} points screen points
 * @param {number} width
 * @param {string} hex
 * @param {boolean} [closed]
 */
function strokePoly(points, width, hex, closed = false) {
  if (points.length < 2) return null;
  const builder = PathBuilder.stroke(Math.max(1, width));
  builder.move_to(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) builder.line_to(points[i][0], points[i][1]);
  if (closed) builder.close();
  try {
    return paint(builder.build(), hex);
  } catch {
    return null;
  }
}

/**
 * @param {[number, number][]} points screen points
 * @param {string} hex
 */
function fillPoly(points, hex) {
  if (points.length < 3) return null;
  const builder = PathBuilder.fill();
  builder.add_polygon(points, true);
  try {
    return paint(builder.build(), hex);
  } catch {
    return null;
  }
}

/**
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {number} size
 * @param {string} hex
 */
function arrowHead(x1, y1, x2, y2, size, hex) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  return fillPoly(
    [
      [x2, y2],
      [x2 - ux * size + px * size * 0.45, y2 - uy * size + py * size * 0.45],
      [x2 - ux * size - px * size * 0.45, y2 - uy * size - py * size * 0.45],
    ],
    hex,
  );
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} width
 * @param {string} hex
 */
function strokeRect(x, y, w, h, width, hex) {
  return strokePoly(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    width,
    hex,
    true,
  );
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} hex
 */
function fillRect(x, y, w, h, hex) {
  return fillPoly(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    hex,
  );
}

/**
 * Build drawable children for the canvas surface (no Sketch — shipping kagan dropped it).
 *
 * @param {import("./model.js").ElementRecord[]} elements
 * @param {{ x: number, y: number, scale: number }} view
 * @param {string[]} selected
 * @param {import("./model.js").ElementRecord | null} draft
 * @param {Record<string, string>} swatch hex colors keyed by canvas color name
 * @param {string} accentHex
 */
export function renderScene(elements, view, selected, draft, swatch, accentHex) {
  /** @type {import("gpui-kit").Element[]} */
  const children = [];
  /** @type {Map<string, { x: number, y: number, w: number, h: number }>} */
  const boxes = new Map();
  for (const element of elements) {
    if (element.type === "box" && element.id) boxes.set(element.id, element);
  }

  /** @param {import("./model.js").ElementRecord} element */
  const push = (element) => {
    const hex = swatch[element.color && element.color in swatch ? element.color : "default"] ?? swatch.default;
    if (element.type === "box") {
      if (!legalRect(element.x, element.y, element.w, element.h)) return;
      const [x, y] = screen(element.x, element.y, view);
      const w = element.w * view.scale;
      const h = element.h * view.scale;
      const stroke = strokeRect(x, y, w, h, 2, hex);
      if (stroke) children.push(stroke);
      if (element.label) {
        const lines = visibleBoxLines(element.label, element.w, element.h).filter((line) => !line.includes("\n"));
        if (lines.length > 0) {
          children.push(
            div()
              .absolute()
              .left(x)
              .top(y + BOX_PAD * view.scale)
              .w(w)
              .text_center()
              .text_size(LABEL_FONT * view.scale)
              .text_color(hex)
              .child(lines.join("\n")),
          );
        }
      }
      return;
    }
    if (element.type === "arrow") {
      const world = element.from || element.to
        ? arrowRoute(element, boxes).map((point) => /** @type {[number, number]} */ ([point.x, point.y]))
        : arrowPoints(element, elements).map((point) => /** @type {[number, number]} */ ([point.x, point.y]));
      if (world.length < 2 || world.some((point) => !finite(point[0]) || !finite(point[1]))) return;
      const points = world.map(([wx, wy]) => screen(wx, wy, view));
      const line = strokePoly(points, 2, hex);
      if (line) children.push(line);
      const heads = element.heads === "none" || element.heads === "start" || element.heads === "both" ? element.heads : "end";
      const head = 10;
      if (heads === "end" || heads === "both") {
        const a = points[points.length - 2];
        const b = points[points.length - 1];
        const tip = arrowHead(a[0], a[1], b[0], b[1], head, hex);
        if (tip) children.push(tip);
      }
      if (heads === "start" || heads === "both") {
        const a = points[1];
        const b = points[0];
        const tip = arrowHead(a[0], a[1], b[0], b[1], head, hex);
        if (tip) children.push(tip);
      }
      if (element.label) {
        const at = arrowLabelAt(element.label, world.map(([x, y]) => ({ x, y })));
        if (at && finite(at.x) && finite(at.y)) {
          const [sx, sy] = screen(at.x, at.y, view);
          children.push(
            div()
              .absolute()
              .left(sx - 80)
              .top(sy - ARROW_FONT * view.scale)
              .w(160)
              .text_center()
              .text_size(ARROW_FONT * view.scale)
              .text_color(hex)
              .child(element.label.replace(/[\r\n]/g, " ")),
          );
        }
      }
      return;
    }
    if (element.type === "text") {
      const bounds = textBounds(element.x, element.y, element.text);
      const lines = textLines(element.text).map((line) => line.replace(/[\r\n]/g, ""));
      if (!legalRect(bounds.x, bounds.y, Math.max(bounds.w, 1), Math.max(bounds.h, 1))) return;
      const [x, y] = screen(bounds.x, bounds.y, view);
      children.push(
        div()
          .absolute()
          .left(x)
          .top(y)
          .text_size(LABEL_FONT * view.scale)
          .text_color(hex)
          .child(lines.join("\n")),
      );
      return;
    }
    if (element.points.length < 2) return;
    const samples = element.points.map(([x, y]) => screen(x, y, view));
    if (samples.some((point) => !finite(point[0]) || !finite(point[1]))) return;
    const ink = strokePoly(samples, Math.max(2, 3 * view.scale), hex);
    if (ink) children.push(ink);
  };

  for (const element of elements) push(element);
  if (draft) push(draft);

  for (const id of selected) {
    const element = elements.find((item) => item.id === id);
    if (!element) continue;
    const bounds = boundsOf(element, elements);
    if (bounds === null) continue;
    const [x, y] = screen(bounds.x - 4, bounds.y - 4, view);
    const w = (bounds.w + 8) * view.scale;
    const h = (bounds.h + 8) * view.scale;
    if (!finite(x) || !finite(y) || w < 0 || h < 0) continue;
    const halo = strokeRect(x, y, w, h, 1.5, accentHex);
    if (halo) children.push(halo);
    if (element.type === "box" && selected.length === 1) {
      const side = 8;
      for (const [hx, hy] of handlePoints(element, view)) {
        const handle = fillRect(hx - side / 2, hy - side / 2, side, side, accentHex);
        if (handle) children.push(handle);
      }
    }
  }

  return children;
}

/**
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @param {{ x: number, y: number, scale: number }} view
 */
function handlePoints(box, view) {
  const [x, y] = screen(box.x, box.y, view);
  const w = box.w * view.scale;
  const h = box.h * view.scale;
  return [
    [x, y],
    [x + w / 2, y],
    [x + w, y],
    [x + w, y + h / 2],
    [x + w, y + h],
    [x + w / 2, y + h],
    [x, y + h],
    [x, y + h / 2],
  ];
}

/** @param {import("./model.js").ElementRecord} element @param {import("./model.js").ElementRecord[]} elements */
export function boundsOf(element, elements) {
  if (element.type === "box") return { x: element.x, y: element.y, w: element.w, h: element.h };
  if (element.type === "text") return textBounds(element.x, element.y, element.text);
  if (element.type === "arrow") {
    const points = arrowPoints(element, elements);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  const xs = element.points.map((point) => point[0]);
  const ys = element.points.map((point) => point[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(Math.max(...xs) - x, 1), h: Math.max(Math.max(...ys) - y, 1) };
}
