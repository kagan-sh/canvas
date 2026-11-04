import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultName, type NamePorts } from "./names.ts";

const ports = (overrides: Partial<NamePorts> = {}): NamePorts => ({
  async thread() {
    return { projectId: "proj_1" };
  },
  async project() {
    return { name: "My App" };
  },
  async projects() {
    return [{ id: "proj_1", name: "My App" }];
  },
  ...overrides,
});

test("a thread's canvas is its project's name as a slug", async () => {
  assert.equal(await defaultName("thr_1", ports()), "my-app");
  assert.equal(await defaultName(undefined, ports()), "canvas");
});

test("the personal project falls back to its id slug", async () => {
  assert.equal(
    await defaultName(
      "thr_1",
      ports({
        async thread() {
          return { projectId: "proj_personal" };
        },
        async project() {
          throw new Error("no project row");
        },
        async projects() {
          return [];
        },
      }),
    ),
    "personal",
  );
});

test("a lookup failure for a project that exists is raised, not hidden", async () => {
  await assert.rejects(
    defaultName(
      "thr_1",
      ports({
        async project() {
          throw new Error("database is locked");
        },
      }),
    ),
    /database is locked/,
  );
});

test("a project list failure is raised too", async () => {
  await assert.rejects(
    defaultName(
      "thr_1",
      ports({
        async project() {
          throw new Error("no row");
        },
        async projects() {
          throw new Error("database is locked");
        },
      }),
    ),
    /database is locked/,
  );
});
