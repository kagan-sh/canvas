import type { Element, Op } from "../model.ts";
import { arrowPoints } from "../diagram.ts";
import { translated } from "../clip.ts";
import { textBounds, type Point, type Rect } from "../layout.ts";
import { MAX_SCALE, MIN_SCALE } from "../constants.ts";

export type Tool = "hand" | "select" | "box" | "arrow" | "line" | "pen" | "text" | "eraser";
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const HANDLE_CURSOR: Record<Handle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};
export const MIN_BOX = 10;
export const HEADS = ["none", "end", "start", "both"] as const;
export type Heads = (typeof HEADS)[number];

/** Top-left of the visible area in world units, and how zoomed in it is. */
export type View = { x: number; y: number; scale: number };
export type Drag =
  | { kind: "move"; ids: string[]; start: Point; current: Point }
  | { kind: "resize"; id: string; handle: Handle; start: Point; current: Point; origin: Rect }
  | { kind: "shape"; start: Point; current: Point }
  | { kind: "stroke"; points: [number, number][] }
  | { kind: "marquee"; start: Point; current: Point; base: string[] }
  | { kind: "erase"; ids: string[] }
  | { kind: "pan"; from: { clientX: number; clientY: number }; view: View };
/** `id` null is a new text element whose first line starts at `at`. */
export type Editing = { id: string | null; at: Point; value: string };

export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export function boxAt(elements: Element[], p: Point): string | undefined {
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i]!;
    if (e.type === "box" && p.x >= e.x && p.x <= e.x + e.w && p.y >= e.y && p.y <= e.y + e.h) return e.id;
  }
  return undefined;
}

export function normalized(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Shift draws a square, or snaps a line to the nearest 15 degrees. */
export function constrained(tool: Tool, start: Point, p: Point): Point {
  const dx = p.x - start.x;
  const dy = p.y - start.y;
  if (tool === "box") {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: start.x + Math.sign(dx || 1) * side, y: start.y + Math.sign(dy || 1) * side };
  }
  if (tool !== "arrow" && tool !== "line") return p;
  const step = Math.PI / 12;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const length = Math.hypot(dx, dy);
  return { x: Math.round(start.x + Math.cos(angle) * length), y: Math.round(start.y + Math.sin(angle) * length) };
}

export function resized(origin: Rect, handle: Handle, dx: number, dy: number): Rect {
  let { x, y, w, h } = origin;
  if (handle.includes("w")) {
    x += dx;
    w -= dx;
  }
  if (handle.includes("e")) w += dx;
  if (handle.includes("n")) {
    y += dy;
    h -= dy;
  }
  if (handle.includes("s")) h += dy;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.max(MIN_BOX, Math.round(w)), h: Math.max(MIN_BOX, Math.round(h)) };
}

/** The element as the drag in progress shows it, before the plugin hears of it. */
export function previewed(e: Element, drag: Drag | null): Element {
  if (drag?.kind === "move" && drag.ids.includes(e.id)) return translated(e, drag.current.x - drag.start.x, drag.current.y - drag.start.y);
  if (drag?.kind === "resize" && drag.id === e.id && e.type === "box")
    return { ...e, ...resized(drag.origin, drag.handle, drag.current.x - drag.start.x, drag.current.y - drag.start.y) };
  return e;
}

export function pointsBounds(points: Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function elementBounds(e: Element, elements: Element[]): Rect {
  switch (e.type) {
    case "box":
      return { x: e.x, y: e.y, w: e.w, h: e.h };
    case "text":
      return textBounds(e.x, e.y, e.text);
    case "arrow":
      return pointsBounds(arrowPoints(e, elements));
    case "path":
      return pointsBounds(e.points.map(([x, y]) => ({ x, y })));
  }
}

export function union(rects: Rect[]): Rect {
  return pointsBounds(rects.flatMap((r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }]));
}

export const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** Deleting a box takes its arrows with it, so a second delete of those arrows would fail the batch. */
export function deleteOps(ids: string[], elements: Element[]): Op[] {
  const chosen = elements.filter((e) => ids.includes(e.id));
  const boxes = chosen.filter((e) => e.type === "box").map((e) => e.id);
  const others = chosen
    .filter((e) => e.type !== "box" && !(e.type === "arrow" && (boxes.includes(e.from ?? "") || boxes.includes(e.to ?? ""))))
    .map((e) => e.id);
  return [...others, ...boxes].map((id) => ({ op: "delete", id }));
}

export function hintFor(tool: Tool, selected: Element[]): string | null {
  switch (tool) {
    case "select":
      if (selected.length === 1 && selected[0]!.type !== "path") return "Double-click or Enter to edit text, Delete to remove";
      if (selected.length > 1) return "Drag to move them together, Cmd+C to copy, Delete to remove";
      return "Move around with two-finger scroll, Space + drag, the middle mouse button, or the Hand tool";
    case "arrow":
    case "line":
      return "Drag from one box to another to connect them, hold Shift to snap the angle";
    case "box":
      return "Hold Shift to draw a square";
    case "text":
      return "Click anywhere to add text";
    case "eraser":
      return "Click or drag over shapes to erase them";
    default:
      return null;
  }
}
