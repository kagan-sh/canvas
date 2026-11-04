import { applyOps, emptyDoc, type Doc, type Op } from "../model.ts";
import { docOf, stepsOf, type CanvasRows, type Row, type Steps } from "./rows.ts";
import { normalizeName } from "../text.ts";

/** Undo steps kept per canvas. Matches bb's canvas. */
export const UNDO_DEPTH = 25;

export type Store = ReturnType<typeof createStore>;

/** The canvas store over any row source: kagan's database in the app, a Map in tests. */
export function createStore(rows: CanvasRows) {
  let migrated: Promise<unknown> | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  /** Runs one store call after the one before it, so two edits never interleave. */
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = chain.then(run);
    chain = next.catch(() => undefined);
    return next;
  }

  function ready(): Promise<unknown> {
    // A failed migration is not cached: the next call retries instead of failing forever.
    migrated ??= rows.migrate().catch((error: unknown) => {
      migrated = null;
      throw error;
    });
    return migrated;
  }

  async function save(doc: Doc, steps: Steps): Promise<void> {
    await rows.save(
      doc.name,
      JSON.stringify(doc),
      JSON.stringify(steps.history.slice(-UNDO_DEPTH)),
      JSON.stringify(steps.future.slice(-UNDO_DEPTH)),
      Date.now(),
    );
  }

  async function requireRow(name: string): Promise<{ found: Row; doc: Doc }> {
    const found = await rows.get(name);
    if (found === undefined) {
      const known = await rows.names();
      throw new Error(
        `No canvas named "${name}". ${known.length === 0 ? "There are no canvases yet." : `Known canvases: ${known.join(", ")}.`}`,
      );
    }
    return { found, doc: docOf(found, name) };
  }

  function listNames(): Promise<string[]> {
    return serial(async () => {
      await ready();
      return rows.names();
    });
  }

  /** Reads a canvas, creating it empty the first time the panel asks for it. */
  function open(name: string): Promise<Doc> {
    return serial(async () => {
      await ready();
      const found = await rows.get(name);
      if (found !== undefined) return docOf(found, name);
      const doc = emptyDoc(name);
      await save(doc, { history: [], future: [] });
      return doc;
    });
  }

  /** Applies every op or none. Agents and the panel both write through here. */
  function edit(name: string, ops: Op[]): Promise<{ before: Doc; after: Doc; added: string[] }> {
    return serial(async () => {
      await ready();
      const { found, doc: before } = await requireRow(name);
      const result = applyOps(before, ops);
      const steps = stepsOf(found);
      await save(result.doc, { history: [...steps.history, before.elements], future: [] });
      return { before, after: result.doc, added: result.added };
    });
  }

  /** Moves one step through the undo stacks. Ids never go back, so a redo cannot clash. */
  function step(name: string, direction: "undo" | "redo"): Promise<Doc> {
    return serial(async () => {
      await ready();
      const { found, doc: current } = await requireRow(name);
      const steps = stepsOf(found);
      const [from, to] = direction === "undo" ? [steps.history, steps.future] : [steps.future, steps.history];
      const target = from.pop();
      if (target === undefined) throw new Error(`Nothing to ${direction} on "${current.name}"`);
      to.push(current.elements);
      const doc: Doc = { ...current, rev: current.rev + 1, elements: target };
      await save(doc, steps);
      return doc;
    });
  }

  function remove(name: string): Promise<string[]> {
    return serial(async () => {
      await ready();
      // A row written before names were normalized still carries its raw spelling, so delete both.
      await rows.remove([...new Set([name, normalizeName(name)])]);
      return rows.names();
    });
  }

  /** Reads a canvas that must already exist. Used by the agent tools and the CLI. */
  function read(name: string): Promise<Doc> {
    return serial(async () => {
      await ready();
      return (await requireRow(name)).doc;
    });
  }

  return { listNames, open, edit, step, remove, read };
}
