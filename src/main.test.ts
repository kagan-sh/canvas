import { test } from "node:test";
import assert from "node:assert/strict";

import * as host from "../test/kagan-stub.mjs";
import Plugin from "./main.ts";

/** Starts the plugin's two loops and returns once they are waiting for work. */
async function start() {
  host.clear();
  const plugin = new Plugin();
  plugin.init(
    {},
    {
      spawn(task) {
        void task().catch(() => undefined);
      },
      notify() {},
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  return plugin;
}

const page = (id: number, call: string, fields: Record<string, unknown> = {}) => ({
  id: String(id),
  kind: "page",
  message: { id, call, ...fields },
});

test("a CLI job and an agent tool answer through the real dispatch", async () => {
  await start();
  host.enqueue({ id: "1", kind: "cli", command: "list", argv: [], cwd: "/", projectId: "proj_1" });
  await host.until(() => host.snapshot().replies.length === 1);
  assert.deepEqual(host.snapshot().replies[0], { id: "1", value: { exitCode: 0, stdout: "No canvases yet." } });

  host.enqueue(page(1, "open", { name: "board" }));
  await host.until(() => host.snapshot().posted.some((item) => item.message?.reply === 1));
  const open = host.snapshot().posted.find((item) => item.message?.reply === 1)?.message;
  assert.equal(open?.ok, true);
  assert.equal(open?.value.name, "board");

  host.enqueue({
    id: "2",
    kind: "tool",
    name: "canvas_edit",
    input: { name: "board", ops: [{ op: "add", element: { type: "box", x: 0, y: 0, w: 100, h: 80, label: "web" } }] },
    threadId: "thr_1",
  });
  await host.until(() => host.snapshot().replies.some((item) => item.id === "2"));
  const edited = host.snapshot().replies.find((item) => item.id === "2")?.value;
  assert.match(edited.text, /added: b1/);

  host.enqueue({ id: "3", kind: "tool", name: "canvas_read", input: {}, threadId: "thr_1" });
  await host.until(() => host.snapshot().replies.some((item) => item.id === "3"));
  assert.equal(host.snapshot().replies.find((item) => item.id === "3")?.value.text, "board");

  host.enqueue({ id: "4", kind: "cli", command: "show", argv: ["Board"], cwd: "/", projectId: "proj_1" });
  await host.until(() => host.snapshot().replies.some((item) => item.id === "4"));
  assert.match(host.snapshot().replies.find((item) => item.id === "4")?.value.stdout, /b1 box 0,0 100x80 "web"/);
});

test("a page reply, a command, a send, and a picture reach the host", async () => {
  await start();
  host.enqueue(page(10, "open", { name: "board" }));
  await host.until(() => host.snapshot().posted.length > 0);

  host.enqueue(page(11, "send", { name: "board", threadId: "thr_1", note: "tidy up" }));
  await host.until(() => host.snapshot().posted.some((item) => item.message?.reply === 11));
  assert.equal(host.snapshot().pastes.length, 1);
  assert.match(host.snapshot().pastes[0].text, /tidy up/);
  assert.match(host.snapshot().pastes[0].text, /kg canvas show board/);

  host.enqueue({ id: "12", kind: "command", command: "open" });
  await host.until(() => host.snapshot().panels.includes("canvas"));

  host.enqueue(page(13, "pngChunk", { upload: "u", index: 0, last: true, data: "QUJD" }));
  await host.until(() => host.snapshot().clipboard.length === 1);
  assert.deepEqual(host.snapshot().clipboard, ["QUJD"]);
});

test("a malformed page message is answered, and a failed job is reported", async () => {
  await start();
  host.enqueue({ id: "20", kind: "page", message: { id: 5, call: "bogus" } });
  await host.until(() => host.snapshot().posted.some((item) => item.message?.reply === 5));
  const refused = host.snapshot().posted.find((item) => item.message?.reply === 5)?.message;
  assert.equal(refused.ok, false);
  assert.match(refused.error, /does not understand/);

  host.enqueue({ id: "21", kind: "tool", name: "canvas_read", input: { name: "nope" }, threadId: "thr_1" });
  await host.until(() => host.snapshot().replies.some((item) => item.id === "21"));
  assert.equal(host.snapshot().replies.find((item) => item.id === "21")?.value.isError, true);
  assert.match(host.snapshot().replies.find((item) => item.id === "21")?.value.text, /No canvas named "nope"/);
});
