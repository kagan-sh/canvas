import { test } from "node:test";
import assert from "node:assert/strict";

import { CREATE_DIAGRAMS, createSqlRows, type SqlDatabase } from "./sql.ts";

function fake() {
  const calls: { sql: string; params: unknown[] }[] = [];
  let rows: Record<string, unknown>[] = [];
  const db: SqlDatabase = {
    async migrate(statements) {
      calls.push({ sql: statements.join("\n"), params: [] });
    },
    async query(sql, params) {
      calls.push({ sql, params });
      return rows;
    },
    async transaction(statements) {
      calls.push(...statements);
    },
  };
  return { db, calls, setRows: (next: Record<string, unknown>[]) => (rows = next) };
}

test("migration creates the 0.1.6 table with the columns old rows use", async () => {
  const { db, calls } = fake();
  await createSqlRows(db).migrate();
  assert.match(calls[0]?.sql ?? "", /CREATE TABLE IF NOT EXISTS diagrams/);
  for (const column of ["name TEXT PRIMARY KEY", "doc TEXT NOT NULL", "history TEXT NOT NULL", "future TEXT NOT NULL", "updated_at INTEGER NOT NULL"]) {
    assert.ok(CREATE_DIAGRAMS.includes(column), column);
  }
});

test("a row is read by name, and names come back in update order", async () => {
  const { db, calls, setRows } = fake();
  const rows = createSqlRows(db);
  setRows([{ doc: "{}", history: "[]", future: "[]" }]);
  assert.deepEqual(await rows.get("board"), { doc: "{}", history: "[]", future: "[]" });
  assert.deepEqual(calls[0]?.params, ["board"]);
  setRows([{ name: "b" }, { name: "a" }]);
  assert.deepEqual(await rows.names(), ["b", "a"]);
  assert.match(calls[1]?.sql ?? "", /ORDER BY updated_at DESC/);
});

test("a save upserts the document, both stacks, and the time", async () => {
  const { db, calls } = fake();
  await createSqlRows(db).save("board", "{}", "[]", "[]", 42);
  const call = calls[0];
  assert.match(call?.sql ?? "", /ON CONFLICT\(name\) DO UPDATE/);
  assert.deepEqual(call?.params, ["board", "{}", "[]", "[]", 42]);
});

test("a delete removes every name it is given, in one transaction", async () => {
  const { db, calls } = fake();
  await createSqlRows(db).remove(["My App", "my-app"]);
  assert.deepEqual(calls.map((call) => call.params), [["My App"], ["my-app"]]);
  assert.ok(calls.every((call) => /DELETE FROM diagrams WHERE name = \?/.test(call.sql)));
});
