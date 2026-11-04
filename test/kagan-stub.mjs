// A stand-in for the kagan host modules main.ts imports. The test loader maps `kagan/*` and
// `gpui-kit` here, so the production job dispatch, store, and SQL adapter run in node:test.
const state = {
  queue: [],
  waiter: null,
  replies: [],
  failures: [],
  posted: [],
  panels: [],
  pastes: [],
  clipboard: [],
  context: { threadId: "thr_1", projectId: "proj_1", focused: true, theme: "light" },
  rows: new Map(),
  threads: [{ id: "thr_1", projectId: "proj_1", title: "This thread", status: "idle" }],
  projects: [{ id: "proj_1", name: "My App" }],
};

export class View {}

export function next() {
  if (state.queue.length > 0) return Promise.resolve(state.queue.shift());
  return new Promise((resolve) => {
    state.waiter = resolve;
  });
}

export function reply(id, value) {
  state.replies.push({ id, value });
}

export function fail(id, message) {
  state.failures.push({ id, message });
}

export async function post(panelId, message) {
  state.posted.push({ panelId, message });
}

export function context() {
  return state.context;
}

export function onContextChanged() {
  return new Promise(() => {});
}

export async function openPanel(panelId) {
  state.panels.push(panelId);
}

export async function pasteIntoThread(threadId, text) {
  state.pastes.push({ threadId, text });
}

export function writeClipboardPng(base64) {
  state.clipboard.push(base64);
}

export function log() {}

export async function get(id) {
  const thread = state.threads.find((candidate) => candidate.id === id);
  if (thread === undefined) throw new Error(`no thread ${id}`);
  return thread;
}

export async function list() {
  return state.threads;
}

export async function project(id) {
  const found = state.projects.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no project ${id}`);
  return found;
}

export async function projects() {
  return state.projects;
}

export async function migrate() {}

export async function query(sql, params) {
  if (sql.includes("SELECT doc, history, future")) {
    const row = state.rows.get(params[0]);
    return row === undefined ? [] : [row];
  }
  if (sql.includes("SELECT name")) return [...state.rows.keys()].map((name) => ({ name }));
  return [];
}

export async function transaction(statements) {
  for (const { sql, params } of statements) {
    if (sql.includes("INSERT INTO diagrams")) {
      state.rows.set(params[0], { doc: params[1], history: params[2], future: params[3] });
    } else if (sql.includes("DELETE FROM diagrams")) {
      state.rows.delete(params[0]);
    }
  }
}

/** Test control: put one job in the plugin's queue. */
export function enqueue(job) {
  if (state.waiter !== null) {
    const wake = state.waiter;
    state.waiter = null;
    wake(job);
    return;
  }
  state.queue.push(job);
}

export function snapshot() {
  return {
    replies: [...state.replies],
    failures: [...state.failures],
    posted: [...state.posted],
    panels: [...state.panels],
    pastes: [...state.pastes],
    clipboard: [...state.clipboard],
    rows: new Map(state.rows),
  };
}

export function clear() {
  state.queue.length = 0;
  state.replies.length = 0;
  state.failures.length = 0;
  state.posted.length = 0;
  state.panels.length = 0;
  state.pastes.length = 0;
  state.clipboard.length = 0;
  state.rows.clear();
}

/** Waits for a condition the plugin reaches after a few microtasks. */
export async function until(check, timeoutMs = 1000) {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for the plugin");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
