import type { PageRequest, PluginMessage } from "../protocol.ts";

declare global {
  interface Window {
    kagan: { post(message: unknown): unknown };
  }
}

type Call = PageRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;
export type Push = Extract<PluginMessage, { push: string }>;

export const CALL_TIMEOUT_MS = 10_000;

type Waiting = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

const waiting = new Map<number, Waiting>();
const listeners = new Set<(push: Push) => void>();
let nextId = 1;

window.addEventListener("kagan", (event) => {
  const message = (event as CustomEvent<PluginMessage | null>).detail;
  if (message === null || typeof message !== "object") return;
  if ("reply" in message) {
    const entry = waiting.get(message.reply);
    if (entry === undefined) return;
    waiting.delete(message.reply);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.value);
    else entry.reject(new Error(message.error));
  } else if ("push" in message) {
    for (const listener of listeners) listener(message);
  }
});

export function call<T>(request: Call): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextId++;
    const fail = (cause: unknown) => {
      const entry = waiting.get(id);
      if (entry === undefined) return;
      waiting.delete(id);
      clearTimeout(entry.timer);
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    };
    const timer = setTimeout(() => fail(new Error("No answer from kagan. Try again.")), CALL_TIMEOUT_MS);
    waiting.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
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
