import { z } from "zod";

// zod compiles its fast parsers with `new Function`, which the web panel's CSP refuses. Parse without it.
z.config({ jitless: true });

import { COLORS, WORLD_LIMIT } from "./constants.ts";
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

const boxInput = z.strictObject({
  type: z.literal("box"),
  x: coord,
  y: coord,
  w: coord.positive(),
  h: coord.positive(),
  label: z.string().max(200).optional(),
  color,
});
const heads = z.enum(["none", "start", "end", "both"]);
const arrowInput = z.strictObject({
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
const textInput = z.strictObject({
  type: z.literal("text"),
  x: coord,
  y: coord,
  text: z.string().min(1).max(500),
  color,
});
const pathInput = z.strictObject({
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
  .strictObject({
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
  z.strictObject({ op: z.literal("add"), element: elementInputSchema, as: alias.optional() }),
  z.strictObject({ op: z.literal("update"), id: ref, patch }),
  z.strictObject({ op: z.literal("move"), id: ref, dx: coord, dy: coord }),
  z.strictObject({ op: z.literal("delete"), id: ref }),
  z.strictObject({ op: z.literal("clear") }),
]);
export type Op = z.infer<typeof opSchema>;

export function emptyDoc(name: string): Doc {
  return { name, rev: 0, next: 1, elements: [] };
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

/** Checks a batch before anything in it runs. Throws one plain message naming the first problem. */
export function parseOps(batch: unknown): Op[] {
  const result = z.array(opSchema).min(1).max(500).safeParse(batch);
  if (!result.success) throw new Error(plainIssue(result.error));
  return result.data;
}

function plainIssue(error: z.ZodError): string {
  const issue = error.issues[0]!;
  const where = issue.path.length === 0 ? "" : ` (${issue.path.map(String).join(" › ")})`;
  return `That change is not valid${where}: ${issue.message}`;
}

/** Names the element a document-level range error belongs to. */
function rangeMessage(error: z.ZodError, elements: Element[]): string {
  const issue = error.issues[0]!;
  const index = issue.path[1];
  const id = issue.path[0] === "elements" && typeof index === "number" ? elements[index]?.id : undefined;
  if (id !== undefined)
    return `That change would move ${id} past the canvas edge. Coordinates stay between -${WORLD_LIMIT} and ${WORLD_LIMIT}.`;
  return `That change is not valid: ${issue.message}`;
}

/**
 * Applies every op or none. Returns the new doc and the ids of added elements.
 * The batch is checked first, and the result is checked before it is returned, so a bad batch
 * changes nothing: the caller saves only what this returns.
 */
export function applyOps(doc: Doc, batch: Op[]): { doc: Doc; added: string[] } {
  const ops = parseOps(batch);
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
        if (element.type !== "arrow" && (rawFrom !== undefined || rawTo !== undefined))
          throw new Error(`${op.id} is a ${element.type}; only an arrow has "from" and "to"`);
        const from = rawFrom == null ? rawFrom : resolve(rawFrom);
        const to = rawTo == null ? rawTo : resolve(rawTo);
        if (element.type === "arrow") {
          assertBox(from);
          assertBox(to);
          if (from === null) delete element.from;
          else if (from !== undefined) element.from = from;
          if (to === null) delete element.to;
          else if (to !== undefined) element.to = to;
          if (element.from !== undefined && element.from === element.to)
            throw new Error("arrow needs two different boxes");
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
  const result: Doc = { ...doc, rev: doc.rev + 1, next, elements };
  const checked = docSchema.safeParse(result);
  if (!checked.success) throw new Error(rangeMessage(checked.error, elements));
  return { doc: result, added };
}
