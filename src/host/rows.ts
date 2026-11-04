import { z } from "zod";

import { docSchema, elementSchema, type Doc, type Element } from "../model.ts";

/** One saved canvas row. `doc` is JSON; the two stacks are JSON arrays of element lists. */
export type Row = { doc: string; history: string; future: string };
export type Steps = { history: Element[][]; future: Element[][] };

/** Where the store keeps its rows: kagan's database in the app, a Map in tests. */
export type CanvasRows = {
  migrate(): Promise<unknown>;
  get(name: string): Promise<Row | undefined>;
  names(): Promise<string[]>;
  save(name: string, doc: string, history: string, future: string, updatedAt: number): Promise<void>;
  remove(names: string[]): Promise<void>;
};

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The saved document. A corrupt row fails with a sentence a person can act on. */
export function docOf(found: Row, name: string): Doc {
  const parsed = docSchema.safeParse(json(found.doc));
  if (!parsed.success) throw new Error(`canvas "${name}" could not be read: ${parsed.error.issues[0]?.message ?? "bad data"}`);
  return parsed.data;
}

/**
 * The undo and redo stacks. A stack written by an older version, or a corrupt one, degrades to
 * no steps: the drawing still opens, it just has nothing to undo.
 */
export function stepsOf(found: Row): Steps {
  const steps = z.array(z.array(elementSchema));
  const history = steps.safeParse(json(found.history));
  const future = steps.safeParse(json(found.future));
  return { history: history.success ? history.data : [], future: future.success ? future.data : [] };
}
