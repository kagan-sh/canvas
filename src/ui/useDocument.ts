import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "../errors.ts";
import { applyOps, type Doc, type Op } from "../model.ts";
import { call, onPush } from "./client.ts";
import { toast } from "./toast.tsx";

type Callbacks = {
  /** Clears a selection that belongs to the canvas being left. */
  beforeLoad(): void;
  /** Freezes a fitted view before an edit changes the chrome's height. */
  beforeApply(): void;
  /** Pans or zooms to work an agent just changed. */
  reveal(before: Doc, after: Doc): void;
};

export type DocumentSession = {
  doc: Doc | null;
  names: string[];
  threadId: string | null;
  /** Opens a canvas, or the thread's own when no name is given. */
  load(name?: string): void;
  /** Opens a named canvas and stops following the thread. */
  pick(name: string): void;
  /** New ids, or null when the edit belongs to a canvas the person has left or failed. */
  apply(ops: Op[]): Promise<string[] | null>;
  step(direction: "undo" | "redo"): void;
  remove(name: string): Promise<string[]>;
};

/**
 * Owns the open document: loading, optimistic edits, revision reconciliation, and undo.
 * The editor owns the view and the drawing; this hook owns what is saved and what is in flight.
 */
export function useDocument(callbacks: Callbacks): DocumentSession {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const nameRef = useRef<string | null>(null);
  const threadRef = useRef<string | null>(null);
  const docRef = useRef<Doc | null>(null);
  // Plugin calls still out, per canvas. While any is out the page shows its own edits,
  // and a fetched doc, which predates them, would snap the drawing back.
  const pendingRef = useRef(new Map<string, number>());
  // Bumped on every doc the page shows from its own edits, so a fetch sent earlier is dropped.
  const epochRef = useRef(0);
  // Bumped on every explicit canvas choice, so a late answer for the previous choice is dropped.
  const navRef = useRef(0);
  // The newest rev a push announced, and whether a failed call left the page unsure.
  const seenRevRef = useRef(0);
  const staleRef = useRef(false);
  // Set when a push says an agent changed the canvas, so the next load brings that work into view.
  const revealRef = useRef(false);
  // Once the person picks a canvas, a thread change no longer switches it.
  const pickedRef = useRef(false);
  const handlers = useRef(callbacks);
  handlers.current = callbacks;

  const show = useCallback((next: Doc) => {
    docRef.current = next;
    setDoc(next);
  }, []);
  const refreshNames = useCallback(() => {
    call({ call: "list" }).then(
      (result) => setNames(result.names),
      (cause) => toast.error("Couldn't list the canvases", errorMessage(cause)),
    );
  }, []);

  const refetch = useCallback(
    (name?: string, generation = navRef.current) => {
      const epoch = epochRef.current;
      const thread = threadRef.current;
      call(name !== undefined ? { call: "open", name } : thread !== null ? { call: "open", threadId: thread } : { call: "open" }).then((next) => {
        // A newer canvas choice owns the panel now; this answer is for the one before it.
        if (generation !== navRef.current) return;
        if (next.name === nameRef.current) {
          // `settle` fetches again once the calls still out are in.
          if ((pendingRef.current.get(next.name) ?? 0) > 0) {
            staleRef.current = true;
            return;
          }
          if (epoch !== epochRef.current) {
            refetch(next.name, generation);
            return;
          }
        }
        if (next.name !== nameRef.current) {
          seenRevRef.current = 0;
          staleRef.current = false;
        }
        nameRef.current = next.name;
        const reveal = revealRef.current;
        revealRef.current = false;
        const before = docRef.current;
        show(next.doc);
        if (reveal && before !== null && before.name === next.doc.name) handlers.current.reveal(before, next.doc);
      }, (cause) => toast.error("Couldn't load the canvas", errorMessage(cause)));
      refreshNames();
    },
    [show, refreshNames],
  );

  const load = useCallback(
    (name?: string) => {
      navRef.current++;
      handlers.current.beforeLoad();
      refetch(name, navRef.current);
    },
    [refetch],
  );
  const pick = useCallback(
    (name: string) => {
      pickedRef.current = true;
      load(name);
    },
    [load],
  );

  const takeContext = useCallback(
    (threadOnScreen: string | null) => {
      threadRef.current = threadOnScreen;
      setThreadId(threadOnScreen);
      if (!pickedRef.current) load();
    },
    [load],
  );

  useEffect(() => {
    load();
    call({ call: "context" }).then(
      (current) => takeContext(current.threadId),
      (cause) => toast.error("Couldn't read the thread on screen", errorMessage(cause)),
    );
  }, [load, takeContext]);

  useEffect(
    () =>
      onPush((push) => {
        if (push.push === "context") {
          takeContext(push.threadId);
        } else if (push.push === "changed") {
          const name = nameRef.current;
          if (name !== null && push.name === name) {
            seenRevRef.current = Math.max(seenRevRef.current, push.rev);
            if ((pendingRef.current.get(name) ?? 0) === 0 && push.rev !== docRef.current?.rev) {
              revealRef.current = true;
              refetch(name);
            }
          } else refreshNames();
        } else if (push.push === "deleted") {
          if (push.name === nameRef.current) {
            pickedRef.current = false;
            load();
          } else refreshNames();
        }
      }),
    [takeContext, refetch, refreshNames, load],
  );

  const settle = useCallback(
    async <T,>(name: string, request: Promise<T>, docFrom: (result: T) => Doc): Promise<T | null> => {
      pendingRef.current.set(name, (pendingRef.current.get(name) ?? 0) + 1);
      try {
        const result = await request;
        if (pendingRef.current.get(name) === 1 && nameRef.current === name) {
          epochRef.current++;
          show(docFrom(result));
        }
        return result;
      } catch (cause) {
        toast.error("Couldn't save the canvas", errorMessage(cause));
        staleRef.current = true;
        return null;
      } finally {
        const left = (pendingRef.current.get(name) ?? 1) - 1;
        pendingRef.current.set(name, left);
        if (left === 0 && nameRef.current === name && (staleRef.current || seenRevRef.current > (docRef.current?.rev ?? 0))) {
          staleRef.current = false;
          refetch(name);
        }
      }
    },
    [show, refetch],
  );

  const apply = useCallback(
    async (ops: Op[]): Promise<string[] | null> => {
      const current = docRef.current;
      if (current === null || ops.length === 0) return [];
      const generation = navRef.current;
      try {
        const local = applyOps(current, ops).doc;
        epochRef.current++;
        show(local);
        handlers.current.beforeApply();
      } catch (cause) {
        toast.error("Couldn't apply the change", errorMessage(cause));
        return null;
      }
      const result = await settle(current.name, call({ call: "apply", name: current.name, ops }), (r) => r.doc);
      // The person may have opened another canvas while this edit was out, or the save failed.
      // Its ids belong to a document the editor is no longer showing, so the editor must not
      // select them or finish its tool here.
      if (generation !== navRef.current || result === null) return null;
      return result.added;
    },
    [show, settle],
  );

  const step = useCallback(
    (direction: "undo" | "redo") => {
      const name = nameRef.current;
      if (name === null) return;
      handlers.current.beforeApply();
      void settle(name, call({ call: direction, name }), (next) => next.doc);
    },
    [settle],
  );

  const remove = useCallback(
    async (name: string) => {
      const result = await call({ call: "delete", name });
      setNames(result.names);
      if (nameRef.current === name) {
        pickedRef.current = false;
        load(result.names[0]);
      }
      return result.names;
    },
    [load],
  );

  return { doc, names, threadId, load, pick, apply, step, remove };
}
