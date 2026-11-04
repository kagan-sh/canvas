import { test } from "node:test";
import assert from "node:assert/strict";

// Imported without a page, then connected to a stand-in: the order the real page uses.
const listeners: ((event: { detail: unknown }) => void)[] = [];
const posted: unknown[] = [];
const { call, connect, onPush, CALL_TIMEOUT_MS } = await import("./client.ts");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    addEventListener(type: string, listener: (event: { detail: unknown }) => void) {
      if (type === "kagan") listeners.push(listener);
    },
    kagan: {
      post(message: unknown) {
        posted.push(message);
        return true;
      },
    },
  },
});
connect();
connect();

/** The host answers a call, as the page hears it. */
const answer = (detail: unknown) => {
  for (const listener of listeners) listener({ detail });
};

test("connecting twice installs one listener", () => {
  assert.equal(listeners.length, 1);
});

test("a call posts its request and resolves with a checked answer", async () => {
  const pending = call({ call: "list" });
  const request = posted.at(-1) as { id: number; call: string };
  assert.equal(request.call, "list");
  answer({ reply: request.id, ok: true, value: { names: ["board"] } });
  assert.deepEqual(await pending, { names: ["board"] });
});

test("a host error rejects the call with its message", async () => {
  const pending = call({ call: "undo", name: "board" });
  const request = posted.at(-1) as { id: number };
  answer({ reply: request.id, ok: false, error: "Nothing to undo on \"board\"" });
  await assert.rejects(pending, /Nothing to undo/);
});

test("an answer that does not fit the protocol fails the call at once", async () => {
  const pending = call({ call: "list" });
  const request = posted.at(-1) as { id: number };
  answer({ reply: request.id, ok: true, value: { names: "oops" } });
  await assert.rejects(pending, /does not understand/);
});

test("pushes reach a listener, and a malformed push reaches nobody", () => {
  const seen: string[] = [];
  const stop = onPush((push) => seen.push(push.push));
  answer({ push: "changed", name: "board", rev: 2 });
  answer({ push: "changed", name: 5, rev: "x" });
  assert.deepEqual(seen, ["changed"]);
  stop();
  answer({ push: "deleted", name: "board" });
  assert.deepEqual(seen, ["changed"]);
});

test("a host that never answers fails after the timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = call({ call: "list" });
  t.mock.timers.tick(CALL_TIMEOUT_MS);
  await assert.rejects(pending, /No answer from kagan/);
});
