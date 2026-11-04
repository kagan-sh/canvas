import { test } from "node:test";
import assert from "node:assert/strict";

import { parseRequest } from "./bridge.ts";
import { pluginMessageSchema, valueSchemas } from "./protocol.ts";
import { PngUploads } from "./upload.ts";

test("a missing message is refused and has no id to answer", () => {
  const parsed = parseRequest(null);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.ok === false && parsed.id, null);
});

test("an unknown call is refused, and still answered by its id", () => {
  const parsed = parseRequest({ id: 4, call: "bogus" });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.ok === false && parsed.id, 4);
});

test("a request with an extra field is refused", () => {
  assert.equal(parseRequest({ id: 4, call: "list", extra: 1 }).ok, false);
  assert.equal(parseRequest({ id: "4", call: "list" }).ok, false);
});

test("a well-formed request is accepted, with its fields", () => {
  const parsed = parseRequest({ id: 4, call: "undo", name: "board" });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok && parsed.request, { id: 4, call: "undo", name: "board" });
});

test("a picture piece with a string index is refused", () => {
  assert.equal(parseRequest({ id: 9, call: "pngChunk", upload: "u", index: "0", last: true, data: "AAAA" }).ok, false);
});

test("picture pieces must come in order, from 0", () => {
  const uploads = new PngUploads();
  assert.throws(() => uploads.accept("u", 1, false, "AAAA"), /out of order: expected piece 0, got 1/);
  assert.equal(uploads.accept("u", 0, false, "AAAA"), null);
  assert.throws(() => uploads.accept("u", 2, true, "AAAA"), /expected piece 1, got 2/);
});

test("an in-order picture joins its pieces on the last one, and a repeat index is refused", () => {
  const uploads = new PngUploads();
  assert.equal(uploads.accept("u", 0, false, "QUJD"), null);
  assert.equal(uploads.accept("u", 1, true, "REVG"), "QUJDREVG");
  // The upload finished, so a new piece 1 under the same id is out of order: a new upload must begin at 0.
  assert.throws(() => uploads.accept("u", 1, true, "REVG"), /expected piece 0, got 1/);
});

test("a plugin message with an extra field, or a push with a wrong type, is refused", () => {
  assert.equal(pluginMessageSchema.safeParse({ push: "changed", name: "board", rev: 2, extra: true }).success, false);
  assert.equal(pluginMessageSchema.safeParse({ push: "changed", name: "board", rev: "2" }).success, false);
  assert.equal(pluginMessageSchema.safeParse({ push: "context", threadId: "t", projectId: null }).success, true);
});

test("an open answer must carry a real document", () => {
  assert.equal(valueSchemas.open.safeParse({ name: 5, doc: null }).success, false);
  assert.equal(valueSchemas.list.safeParse({ names: ["a"], more: 1 }).success, false);
});
