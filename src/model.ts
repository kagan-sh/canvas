import { z } from "zod";

import { COLORS, WORLD_LIMIT } from "./constants.ts";
import { textBounds, type Point, type Rect } from "./layout.ts";
import { layoutOf, type Note } from "./route.ts";
export { COLORS } from "./constants.ts";
export type { Color } from "./constants.ts";

const coord = z.number().finite().min(-WORLD_LIMIT).max(WORLD_LIMIT);
const color = z.enum(COLORS).optional();
const id = z.string().regex(/^[batp]\d+$/);
/** An id (`b1`) or an alias named earlier in the same batch (`web`). */
const ref = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/).max(60);
const alias = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
  .max(60)
  .refine((value) => !/^[batp]\d+$/.test(value), "An alias must not look like an id");

const boxInput = z.object({
  type: z.literal("box"),
  x: coord,
  y: coord,
  w: coord.positive(),
  h: coord.positive(),
  label: z.string().max(200).optional(),
  color,
});
const heads = z.enum(["none", "start", "end", "both"]);
const arrowInput = z.object({
  type: z.literal("arrow"),
  x1: coord,
  y1: coord,
  x2: coord,
  y2: coord,
  /** Which ends carry an arrowhead. "none" draws a plain line. Default "end". */
  heads: heads.optional(),
  from: ref.optional(),
  to: ref.optional(),
  label: z.string().max(200).optional(),
  color,
});
const textInput = z.object({
  type: z.literal("text"),
  x: coord,
  y: coord,
  text: z.string().min(1).max(500),
  color,
});
const pathInput = z.object({
  type: z.literal("path"),
  points: z.array(z.tuple([coord, coord])).min(2).max(2000),
  color,
});

export const elementInputSchema = z.discriminatedUnion("type", [
  boxInput,
  arrowInput,
  textInput,
  pathInput,
]);
export type ElementInput = z.infer<typeof elementInputSchema>;
export type Element = ElementInput & { id: string };
export type Box = Extract<Element, { type: "box" }>;
export type Arrow = Extract<Element, { type: "arrow" }>;

export const elementSchema = z.discriminatedUnion("type", [
  boxInput.extend({ id }),
  arrowInput.extend({ id }),
  textInput.extend({ id }),
  pathInput.extend({ id }),
]);

export const docSchema = z.object({
  name: z.string(),
  rev: z.number().int(),
  next: z.number().int(),
  elements: z.array(elementSchema),
});
export type Doc = z.infer<typeof docSchema>;

const patch = z
  .object({
    x: coord,
    y: coord,
    w: coord.positive(),
    h: coord.positive(),
    x1: coord,
    y1: coord,
    x2: coord,
    y2: coord,
    from: ref.nullable(),
    to: ref.nullable(),
    label: z.string().max(200),
    text: z.string().min(1).max(500),
    color: z.enum(COLORS),
    heads,
  })
  .partial();

export const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), element: elementInputSchema, as: alias.optional() }),
  z.object({ op: z.literal("update"), id: ref, patch }),
  z.object({ op: z.literal("move"), id: ref, dx: coord, dy: coord }),
  z.object({ op: z.literal("delete"), id: ref }),
  z.object({ op: z.literal("clear") }),
]);
export type Op = z.infer<typeof opSchema>;

export function emptyDoc(name: string): Doc {
  return { name, rev: 0, next: 1, elements: [] };
}

/** One canvas per name, however the name was typed. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

const PREFIX = { box: "b", arrow: "a", text: "t", path: "p" } as const;

/** What `update` may set per type. A box with no label yet has no `label`
 * key, so testing the element for the key would silently drop the change. */
const PATCHABLE: Record<Element["type"], readonly string[]> = {
  box: ["x", "y", "w", "h", "label", "color"],
  arrow: ["x1", "y1", "x2", "y2", "label", "color", "heads"],
  text: ["x", "y", "text", "color"],
  path: ["color"],
};

/** Applies every op or none. Returns the new doc and the ids of added elements. */
export function applyOps(doc: Doc, ops: Op[]): { doc: Doc; added: string[] } {
  let elements = doc.elements.map((element) => ({ ...element }));
  let next = doc.next;
  const added: string[] = [];
  // An id only exists after the op runs, so a batch names what it creates.
  const aliases = new Map<string, string>();
  const resolve = (reference: string) => aliases.get(reference) ?? reference;
  const find = (elementId: string) => {
    const element = elements.find((candidate) => candidate.id === elementId);
    if (element === undefined) throw new Error(`no element ${elementId}`);
    return element;
  };
  const assertBox = (elementId: string | null | undefined) => {
    if (elementId == null) return;
    if (find(elementId).type !== "box") throw new Error(`${elementId} is not a box`);
  };
  for (const op of ops) {
    switch (op.op) {
      case "add": {
        // Spread only the keys that are present: an explicit `from: undefined`
        // is not a JSON value and fails the RPC boundary on the way back out.
        const element =
          op.element.type === "arrow"
            ? {
                ...op.element,
                ...(op.element.from === undefined ? {} : { from: resolve(op.element.from) }),
                ...(op.element.to === undefined ? {} : { to: resolve(op.element.to) }),
              }
            : op.element;
        if (element.type === "arrow") {
          assertBox(element.from);
          assertBox(element.to);
          if (element.from !== undefined && element.from === element.to)
            throw new Error("arrow needs two different boxes");
        }
        const elementId = `${PREFIX[element.type]}${next++}`;
        if (op.as !== undefined) {
          if (aliases.has(op.as)) throw new Error(`alias "${op.as}" is used twice`);
          aliases.set(op.as, elementId);
        }
        elements.push({ ...element, id: elementId } as Element);
        added.push(elementId);
        break;
      }
      case "update": {
        const element = find(resolve(op.id));
        const { from: rawFrom, to: rawTo, ...rest } = op.patch;
        const from = rawFrom == null ? rawFrom : resolve(rawFrom);
        const to = rawTo == null ? rawTo : resolve(rawTo);
        if (element.type === "arrow") {
          assertBox(from);
          assertBox(to);
          if (from === null) delete element.from;
          else if (from !== undefined) element.from = from;
          if (to === null) delete element.to;
          else if (to !== undefined) element.to = to;
        }
        for (const [key, value] of Object.entries(rest)) {
          if (!PATCHABLE[element.type].includes(key))
            throw new Error(`${op.id} is a ${element.type}; it has no "${key}"`);
          (element as Record<string, unknown>)[key] = value;
        }
        break;
      }
      case "move": {
        const element = find(resolve(op.id));
        if (element.type === "arrow" && (element.from !== undefined || element.to !== undefined))
          throw new Error(`${op.id} is attached to a box; move the box instead`);
        switch (element.type) {
          case "box":
          case "text":
            element.x += op.dx;
            element.y += op.dy;
            break;
          case "arrow":
            element.x1 += op.dx;
            element.y1 += op.dy;
            element.x2 += op.dx;
            element.y2 += op.dy;
            break;
          case "path":
            element.points = element.points.map(([x, y]) => [x + op.dx, y + op.dy]);
            break;
        }
        break;
      }
      case "delete": {
        const target = resolve(op.id);
        find(target);
        elements = elements.filter(
          (element) =>
            element.id !== target &&
            !(element.type === "arrow" && (element.from === target || element.to === target)),
        );
        break;
      }
      case "clear":
        elements = [];
        break;
    }
  }
  return { doc: { ...doc, rev: doc.rev + 1, next, elements }, added };
}

/** Right-angle route for a from/to arrow around the other boxes. A free arrow stays a straight line. */
export function arrowPoints(arrow: Arrow, elements: Element[]): Point[] {
  const layout = layoutOf(elements);
  return layout.owns(arrow) ? layout.routes.get(arrow.id)! : layout.route(arrow);
}

/** Where the arrow's label sits, or null when its line has no clean spot for it. */
export function arrowLabelRect(arrow: Arrow, elements: Element[]): Rect | null {
  const layout = layoutOf(elements);
  return layout.owns(arrow) ? (layout.labels.get(arrow.id) ?? null) : null;
}

/** First and last points of the route. */
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
