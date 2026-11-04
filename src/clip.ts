import { z } from "zod";

import { arrowPoints, contentBounds, elementSchema, emptyDoc, type Element, type ElementInput, type Op } from "./model.ts";

export const isBound = (e: Element) => e.type === "arrow" && (e.from !== undefined || e.to !== undefined);

/** An attached arrow stays put: it follows its boxes instead. */
export function translated(e: Element, dx: number, dy: number): Element {
  switch (e.type) {
    case "box":
    case "text":
      return { ...e, x: e.x + dx, y: e.y + dy };
    case "arrow":
      return isBound(e) ? e : { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy };
    case "path":
      return { ...e, points: e.points.map(([x, y]) => [x + dx, y + dy]) };
  }
}

/** The chosen elements, ready to paste on any canvas. An arrow keeps its boxes only when
 * both boxes are copied too; otherwise it becomes a free arrow along its current route. */
export function copyElements(ids: string[], elements: Element[]): Element[] {
  const chosen = elements.filter((e) => ids.includes(e.id));
  const boxes = new Set(chosen.filter((e) => e.type === "box").map((e) => e.id));
  return chosen.map((e) => {
    if (e.type !== "arrow" || !isBound(e)) return e;
    if (e.from !== undefined && e.to !== undefined && boxes.has(e.from) && boxes.has(e.to)) return e;
    const points = arrowPoints(e, elements);
    const { from: _from, to: _to, ...free } = e;
    const start = points[0]!;
    const end = points[points.length - 1]!;
    return { ...free, x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  });
}

/** Ops that add the clip shifted by dx,dy. Arrows go last so they can name the new boxes.
 * A link to a box outside the clip is dropped: that id means another box on this canvas. */
export function pasteOps(clip: Element[], dx: number, dy: number): Op[] {
  const alias = (id: string) => `copy_${id}`;
  const boxes = new Set(clip.filter((e) => e.type === "box").map((e) => e.id));
  const shapes = clip.filter((e) => e.type !== "arrow");
  const arrows = clip.filter((e) => e.type === "arrow");
  return [...shapes, ...arrows].map((e): Op => {
    if (e.type === "arrow") {
      const { id: _id, from, to, ...free } = e;
      if (from !== undefined && to !== undefined && boxes.has(from) && boxes.has(to))
        return { op: "add", element: { ...free, from: alias(from), to: alias(to) } };
      const { id: _freeId, ...element } = translated(free as Element, dx, dy);
      return { op: "add", element: element as ElementInput };
    }
    const { id, ...element } = translated(e, dx, dy);
    return { op: "add", as: alias(id), element: element as ElementInput };
  });
}

export function clipCenter(clip: Element[]): { x: number; y: number } {
  const bounds = contentBounds({ ...emptyDoc(""), elements: clip });
  return bounds === null ? { x: 0, y: 0 } : { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
}

const clipSchema = z.object({ bbCanvas: z.literal(1), elements: z.array(elementSchema).min(1) });

/** The clipboard holds this JSON. The `bbCanvas: 1` tag lets decodeClip tell a copied clip from other text. */
export function encodeClip(clip: Element[]): string {
  return JSON.stringify({ bbCanvas: 1, elements: clip });
}

export function decodeClip(text: string): Element[] | null {
  try {
    const parsed = clipSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.elements : null;
  } catch {
    return null;
  }
}
