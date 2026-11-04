import { textBounds, type Point, type Rect } from "./layout.ts";
import { layoutOf, type Note } from "./route.ts";
import type { Arrow, Doc, Element } from "./model.ts";

/** Right-angle route for a from/to arrow around the other boxes. A free arrow stays a straight line. */
export function arrowPoints(arrow: Arrow, elements: Element[]): Point[] {
  const layout = layoutOf(elements);
  return layout.owns(arrow) ? layout.routes.get(arrow.id)! : layout.route(arrow);
}

/** Where the arrow's label sits, or null when its line has no acceptable spot. A label that must cover another arrow is still returned; layout notes report it. */
export function arrowLabelRect(arrow: Arrow, elements: Element[]): Rect | null {
  const layout = layoutOf(elements);
  return layout.owns(arrow) ? (layout.labels.get(arrow.id) ?? null) : null;
}

export function arrowEnds(arrow: Arrow, elements: Element[]): { x1: number; y1: number; x2: number; y2: number } {
  const points = arrowPoints(arrow, elements);
  const start = points[0]!;
  const end = points[points.length - 1]!;
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

/** The box every element fits in, or null for an empty canvas. */
export function contentBounds(doc: Doc): { x: number; y: number; w: number; h: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (x: number, y: number) => {
    xs.push(x);
    ys.push(y);
  };
  for (const element of doc.elements) {
    switch (element.type) {
      case "box":
        add(element.x, element.y);
        add(element.x + element.w, element.y + element.h);
        break;
      case "text": {
        const bounds = textBounds(element.x, element.y, element.text);
        add(bounds.x, bounds.y);
        add(bounds.x + bounds.w, bounds.y + bounds.h);
        break;
      }
      case "arrow": {
        for (const point of arrowPoints(element, doc.elements)) add(point.x, point.y);
        // A label sits beside its line, so it can reach wider than either end.
        const label = arrowLabelRect(element, doc.elements);
        if (label !== null) {
          add(label.x, label.y);
          add(label.x + label.w, label.y + label.h);
        }
        break;
      }
      case "path":
        for (const [x, y] of element.points) add(x, y);
        break;
    }
  }
  if (xs.length === 0) return null;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const r = (n: number) => Math.round(n);

/** One line per element. What the agent reads. */
export function exportText(doc: Doc): string {
  if (doc.elements.length === 0) return `(empty canvas "${doc.name}")`;
  const lines = doc.elements.map((element) => {
    const tint = element.color && element.color !== "default" ? ` ${element.color}` : "";
    switch (element.type) {
      case "box":
        return `${element.id} box ${r(element.x)},${r(element.y)} ${r(element.w)}x${r(element.h)}${tint}${element.label ? ` ${JSON.stringify(element.label)}` : ""}`;
      case "arrow": {
        const ends = arrowEnds(element, doc.elements);
        const link = element.from || element.to ? ` ${element.from ?? "?"}->${element.to ?? "?"}` : "";
        const kind = element.heads === "none" ? "line" : "arrow";
        // "line" already says there is no head, and "end" is the default.
        const heads =
          element.heads === undefined || element.heads === "end" || element.heads === "none"
            ? ""
            : ` heads ${element.heads}`;
        return `${element.id} ${kind} ${r(ends.x1)},${r(ends.y1)} -> ${r(ends.x2)},${r(ends.y2)}${link}${heads}${tint}${element.label ? ` ${JSON.stringify(element.label)}` : ""}`;
      }
      case "text":
        return `${element.id} text ${r(element.x)},${r(element.y)}${tint} ${JSON.stringify(element.text)}`;
      case "path": {
        const xs = element.points.map((p) => p[0]);
        const ys = element.points.map((p) => p[1]);
        return `${element.id} freehand ${element.points.length} points, bounds ${r(Math.min(...xs))},${r(Math.min(...ys))} to ${r(Math.max(...xs))},${r(Math.max(...ys))}${tint}`;
      }
    }
  });
  return lines.join("\n");
}

/** Everything a person would see collide: text, boxes, lines, and labels. Nested boxes are allowed. */
export function layoutNotes(doc: Doc): Note[] {
  return layoutOf(doc.elements).notes;
}

export function layoutReport(notes: Note[]): string {
  return notes.length === 0 ? "" : `layout: ${notes.map((note) => note.text).join("; ")}`;
}
