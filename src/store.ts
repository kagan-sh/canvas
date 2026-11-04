import { migrate, query, transaction } from "kagan/database";

import { applyOps, docSchema, emptyDoc, type Doc, type Element, type Op } from "./model.ts";
import { normalizeName } from "./text.ts";

/** Undo steps kept per canvas. Matches bb's canvas. */
export const UNDO_DEPTH = 25;

/**
 * The table 0.1.6 created. Keep this statement exactly: `migrate` is append-only, and saved
 * canvases load from this table. Its columns are the same ones bb's canvas uses.
 */
const CREATE_DIAGRAMS = `CREATE TABLE IF NOT EXISTS diagrams (
      name TEXT PRIMARY KEY,
      doc TEXT NOT NULL,
      history TEXT NOT NULL,
      future TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`;

let migrated: Promise<unknown> | null = null;
let chain: Promise<unknown> = Promise.resolve();

/** Runs one store call after the one before it, so two edits never interleave. */
function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = chain.then(run);
  chain = next.catch(() => undefined);
  return next;
}

function ready(): Promise<unknown> {
  migrated ??= migrate([CREATE_DIAGRAMS]);
  return migrated;
}

type Row = { doc: string; history: string; future: string };
type Steps = { history: Element[][]; future: Element[][] };

async function row(name: string): Promise<Row | undefined> {
  const rows = await query("SELECT doc, history, future FROM diagrams WHERE name = ?", [name]);
  return rows[0] as Row | undefined;
}

function docOf(found: Row, name: string): Doc {
  const parsed = docSchema.safeParse(JSON.parse(found.doc));
  if (!parsed.success) throw new Error(`canvas "${name}" could not be read: ${parsed.error.issues[0]?.message ?? "bad data"}`);
  return parsed.data;
}

function stepsOf(found: Row, name: string): Steps {
  const history: unknown = JSON.parse(found.history);
  const future: unknown = JSON.parse(found.future);
  if (!Array.isArray(history) || !Array.isArray(future)) throw new Error(`canvas "${name}" history is unreadable`);
  return { history: history as Element[][], future: future as Element[][] };
}

async function save(doc: Doc, steps: Steps): Promise<void> {
  await transaction([
    {
      sql: `INSERT INTO diagrams (name, doc, history, future, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET doc = excluded.doc, history = excluded.history, future = excluded.future, updated_at = excluded.updated_at`,
      params: [
        doc.name,
        JSON.stringify(doc),
        JSON.stringify(steps.history.slice(-UNDO_DEPTH)),
        JSON.stringify(steps.future.slice(-UNDO_DEPTH)),
        Date.now(),
      ],
    },
  ]);
}

async function knownNames(): Promise<string[]> {
  const rows = await query("SELECT name FROM diagrams ORDER BY updated_at DESC", []);
  return rows.map((item) => String(item.name));
}

async function requireRow(name: string): Promise<{ found: Row; doc: Doc }> {
  const found = await row(name);
  if (found === undefined) {
    const known = await knownNames();
    throw new Error(
      `No canvas named "${name}". ${known.length === 0 ? "There are no canvases yet." : `Known canvases: ${known.join(", ")}.`}`,
    );
  }
  return { found, doc: docOf(found, name) };
}

export function listNames(): Promise<string[]> {
  return serial(async () => {
    await ready();
    return knownNames();
  });
}

/** Reads a canvas, creating it empty the first time the panel asks for it. */
export function open(name: string): Promise<Doc> {
  return serial(async () => {
    await ready();
    const found = await row(name);
    if (found !== undefined) return docOf(found, name);
    const doc = emptyDoc(name);
    await save(doc, { history: [], future: [] });
    return doc;
  });
}

/** Applies every op or none. Agents and the panel both write through here. */
export function edit(name: string, ops: Op[]): Promise<{ before: Doc; after: Doc; added: string[] }> {
  return serial(async () => {
    await ready();
    const { found, doc: before } = await requireRow(name);
    const result = applyOps(before, ops);
    const steps = stepsOf(found, name);
    await save(result.doc, { history: [...steps.history, before.elements], future: [] });
    return { before, after: result.doc, added: result.added };
  });
}

/** Moves one step through the undo stacks. Ids never go back, so a redo cannot clash. */
export function step(name: string, direction: "undo" | "redo"): Promise<Doc> {
  return serial(async () => {
    await ready();
    const { found, doc: current } = await requireRow(name);
    const steps = stepsOf(found, name);
    const [from, to] = direction === "undo" ? [steps.history, steps.future] : [steps.future, steps.history];
    const target = from.pop();
    if (target === undefined) throw new Error(`Nothing to ${direction} on "${current.name}"`);
    to.push(current.elements);
    const doc: Doc = { ...current, rev: current.rev + 1, elements: target };
    await save(doc, steps);
    return doc;
  });
}

export function remove(name: string): Promise<string[]> {
  return serial(async () => {
    await ready();
    await transaction([{ sql: "DELETE FROM diagrams WHERE name = ?", params: [name] }]);
    return knownNames();
  });
}

/** Reads a canvas that must already exist. Used by the agent tools and the CLI. */
export function read(name: string): Promise<Doc> {
  return serial(async () => {
    await ready();
    return (await requireRow(name)).doc;
  });
}
