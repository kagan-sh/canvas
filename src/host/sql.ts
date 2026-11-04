import type { CanvasRows, Row } from "./rows.ts";

/** The kagan database calls the canvas adapter needs. Tests pass a stand-in. */
export type SqlDatabase = {
  migrate(statements: string[]): Promise<unknown>;
  query(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
  transaction(statements: { sql: string; params: unknown[] }[]): Promise<void>;
};

/**
 * The table 0.1.6 created. Keep this statement exactly: `migrate` is append-only, and saved
 * canvases load from this table. Its columns are the same ones bb's canvas uses.
 */
export const CREATE_DIAGRAMS = `CREATE TABLE IF NOT EXISTS diagrams (
      name TEXT PRIMARY KEY,
      doc TEXT NOT NULL,
      history TEXT NOT NULL,
      future TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`;

/** kagan's SQLite as the canvas store's row source. */
export function createSqlRows(db: SqlDatabase): CanvasRows {
  return {
    migrate: () => db.migrate([CREATE_DIAGRAMS]),
    async get(name) {
      const rows = await db.query("SELECT doc, history, future FROM diagrams WHERE name = ?", [name]);
      return rows[0] as Row | undefined;
    },
    async names() {
      const rows = await db.query("SELECT name FROM diagrams ORDER BY updated_at DESC", []);
      return rows.map((item) => String(item.name));
    },
    save(name, doc, history, future, updatedAt) {
      return db.transaction([
        {
          sql: `INSERT INTO diagrams (name, doc, history, future, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET doc = excluded.doc, history = excluded.history, future = excluded.future, updated_at = excluded.updated_at`,
          params: [name, doc, history, future, updatedAt],
        },
      ]);
    },
    remove(names) {
      return db.transaction(names.map((name) => ({ sql: "DELETE FROM diagrams WHERE name = ?", params: [name] })));
    },
  };
}
