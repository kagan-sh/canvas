import type { z } from "zod";

import { pluginMessageSchema, valueSchemas, type PageRequest, type PluginMessage } from "../protocol.ts";

declare global {
  interface Window {
    kagan: { post(message: unknown): unknown };
  }
}

type Call = PageRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;
export type Push = Extract<PluginMessage, { push: string }>;

export const CALL_TIMEOUT_MS = 10_000;

const UNDERSTOOD = "kagan sent an answer the page does not understand.";

type Waiting = {
  schema: z.ZodType;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const waiting = new Map<number, Waiting>();

function settle(id: number): Waiting | undefined {
  const entry = waiting.get(id);
  if (entry === undefined) return undefined;
  waiting.delete(id);
  clearTimeout(entry.timer);
  return entry;
}

const listeners = new Set<(push: Push) => void>();
let nextId = 1;
let connected = false;

/** Wires the page to the plugin's messages. The page calls it before rendering; call() also ensures it. */
export function connect(): void {
  if (connected || typeof window === "undefined") return;
  connected = true;
  window.addEventListener("kagan", (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    const parsed = pluginMessageSchema.safeParse(detail);
    if (!parsed.success) {
      // A reply that does not fit fails its call at once. Anything else is dropped.
      const id = typeof detail === "object" && detail !== null && "reply" in detail ? detail.reply : undefined;
      if (typeof id === "number") settle(id)?.reject(new Error(UNDERSTOOD));
      console.warn("canvas: dropped a message from kagan that does not fit the protocol", parsed.error.issues[0]?.message);
      return;
    }
    const message = parsed.data;
    if ("reply" in message) {
      const entry = settle(message.reply);
      if (entry === undefined) return;
      if (!message.ok) return entry.reject(new Error(message.error));
      const checked = entry.schema.safeParse(message.value);
      if (checked.success) entry.resolve(checked.data);
      else entry.reject(new Error(UNDERSTOOD));
    } else if ("push" in message) {
      for (const listener of listeners) listener(message);
    }
  });
}

export function call<R extends Call>(request: R): Promise<z.infer<(typeof valueSchemas)[R["call"]]>> {
  const schema = valueSchemas[request.call] as z.ZodType;
  connect();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const fail = (cause: unknown) => {
      const entry = settle(id);
      if (entry === undefined) return;
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    };
    const timer = setTimeout(() => fail(new Error("No answer from kagan. Try again.")), CALL_TIMEOUT_MS);
    waiting.set(id, { schema, resolve: resolve as (value: unknown) => void, reject, timer });
    try {
      Promise.resolve(window.kagan.post({ id, ...request })).catch(fail);
    } catch (cause) {
      fail(cause);
    }
  });
}

export function onPush(listener: (push: Push) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
