// Only the kagan calls this plugin uses. Source: docs/plugin-api.md on kagan's feat/web-panel branch.
// `kg plugin types` writes the full set; keep these in line with it.

declare module "gpui-kit" {
  export interface AsyncContext {
    spawn(task: () => Promise<void>): void;
    notify(): void;
  }
  export class View {
    init(props: unknown, cx: AsyncContext): void;
    render(cx?: unknown): unknown;
  }
}

declare module "kagan/jobs" {
  export type Job = { id: string; kind: string; [field: string]: unknown };
  export function next(): Promise<Job>;
  export function reply(id: string, value: unknown): void;
  export function fail(id: string, message: string): void;
}

declare module "kagan/panel" {
  export function post(panelId: string, message: unknown): Promise<void>;
}

declare module "kagan/host" {
  export type Context = { threadId?: string; projectId?: string; focused: boolean; theme: "light" | "dark" };
  export function context(): Context;
  export function onContextChanged(): Promise<Context>;
  export function openPanel(panelId: string, props?: unknown): Promise<void>;
  export function pasteIntoThread(threadId: string, text: string): Promise<void>;
  export function writeClipboardPng(pngBase64: string): void;
  export function log(level: string, message: string): void;
}

declare module "kagan/threads" {
  export type Thread = { id: string; projectId: string; title: string; status: string };
  export type Project = { id: string; name: string };
  export function get(id: string): Promise<Thread>;
  export function list(options?: { projectId?: string; limit?: number }): Promise<Thread[]>;
  export function project(id: string): Promise<Project>;
}

declare module "kagan/database" {
  export function migrate(statements: string[]): Promise<void>;
  export function query(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
  export function transaction(statements: { sql: string; params: unknown[] }[]): Promise<void>;
}
