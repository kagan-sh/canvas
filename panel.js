// @ts-check

import { h_flex, v_flex } from "gpui-base";
import { div, View } from "gpui-kit";
import { Input, InputState, KgButton, Select } from "gpui-component";
import { log, toast, context, onContextChanged } from "kagan/host";
import * as host from "kagan/host";
import { list as listThreads } from "kagan/threads";
import { clipCenter, copyElements, decodeClip, encodeClip, isBound, pasteOps, translated } from "./clip.js";
import { boxHeightForLabel, contentOffscreen } from "./layout.js";
import { boundsOf, renderScene } from "./paint.js";
import { contentBounds, normalizeName } from "./model.js";
import { currentGeneration, edit, list, nextChange, open, peek, projectCanvasName, remove, step } from "./store.js";

const COLORS = [
  ["default", "Ink"],
  ["blue", "Blue"],
  ["green", "Green"],
  ["yellow", "Yellow"],
  ["red", "Red"],
  ["gray", "Gray"],
  ["magenta", "Magenta"],
  ["cyan", "Cyan"],
];

const TOOLS = [
  ["hand", "H", "Hand (panning tool) — H", "icons/hand.svg"],
  ["select", "V", "Selection — V or 1", "icons/mouse-pointer-2.svg"],
  ["rect", "R", "Rectangle — drag on the board · R or 2", "icons/square.svg"],
  ["arrow", "A", "Arrow — A or 5", "icons/arrow-right.svg"],
  ["line", "L", "Line — L or 6", "icons/minus.svg"],
  ["pen", "P", "Draw — P or 7", "icons/pencil.svg"],
  ["text", "T", "Text — T or 8", "icons/type.svg"],
  ["erase", "E", "Eraser — E or 0", "icons/eraser.svg"],
];

/** Right-sidebar default is 320px. Under this, shortcut letters hide and tool targets grow. */
const NARROW_PANEL = 420;
/** `cx.write_to_clipboard` stores a string. It cannot place an image/png. */
const COPY_IMAGE_REASON = "Copy as image needs a PNG on the clipboard. This host only accepts text.";

/** Stroke colors drawn with PathBuilder (shipping kagan has no Sketch). */
const SWATCH = {
  light: {
    default: "#1e1e1e",
    red: "#e03131",
    green: "#2f9e44",
    yellow: "#f08c00",
    blue: "#1971c2",
    magenta: "#9c36b5",
    cyan: "#0c8599",
    gray: "#868e96",
  },
  dark: {
    default: "#d3d3d3",
    red: "#ff8383",
    green: "#39994b",
    yellow: "#b86200",
    blue: "#56a2e8",
    magenta: "#e28af8",
    cyan: "#3da5b6",
    gray: "#8c8c93",
  },
};

const TOP_PICKS = ["default", "red", "green", "blue", "yellow"];
const HEADS = [
  ["none", "icons/minus.svg"],
  ["end", "icons/arrow-right.svg"],
  ["start", "icons/arrow-left.svg"],
  ["both", "icons/arrow-left-right.svg"],
];
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const BIND_SLOP = 14;
const MIN_BOX = 16;

export class CanvasPanel extends View {
  /** @param {import("gpui-shell").Props | undefined} _props @param {import("gpui-kit").AsyncContext} cx */
  init(_props, cx) {
    this.focus = cx.focus_handle();
    this.nameInput = InputState("Canvas name");
    this.noteInput = InputState("What should the agent do with this?");
    this.labelInput = InputState("Label");
    this.tool = "rect";
    this.color = "default";
    this.sticky = false;
    this.viewX = 32;
    this.viewY = 32;
    this.scale = 1;
    /** @type {import("./model.js").Doc | null} */
    this.doc = null;
    this.name = "";
    this.names = /** @type {string[]} */ ([]);
    this.selected = /** @type {string[]} */ ([]);
    this.hidden = new Set();
    /** @type {{ ids: Set<string>, dx: number, dy: number } | null} */
    this.preview = null;
    /** @type {import("./model.js").ElementRecord | null} */
    this.draft = null;
    /** @type {null | { kind: string, x: number, y: number, moved?: boolean, points?: number[][], id?: string, handle?: string, ox?: number, oy?: number, ow?: number, oh?: number }} */
    this.gesture = null;
    this.pointer = { x: 80, y: 80 };
    this.space = false;
    this.pinned = false;
    this.projectId = "";
    this.projectName = "canvas";
    this.threadId = /** @type {string | undefined} */ (undefined);
    /** @type {{ w: number, h: number } | null} */
    this.viewport = null;
    this.menu = false;
    this.palette = false;
    this.naming = false;
    this.editing = false;
    /** @type {{ id: string, x: number, y: number, w: number, h: number } | null} */
    this.resize = null;
    this.alive = true;
    this.confirmDelete = false;
    this.confirmName = "";
    this.wantEdit = false;
    this.narrow = true;
    this.sending = false;
    this.sendTarget = "";
    /** @type {{ id: string, title: string }[]} */
    this.threads = [];
    this.threadsError = "";
    cx.spawn(async () => {
      await this.follow(context());
      cx.notify();
      let seen = currentGeneration();
      for (;;) {
        seen = await nextChange(seen);
        if (!this.alive || this.name === "") continue;
        const doc = await peek(this.name);
        this.names = await list();
        if (doc === null) {
          // Do not recreate a deleted canvas; fall back to the project default.
          const fallback = this.projectName || "canvas";
          if (this.name !== fallback) {
            toast(`Canvas "${this.name}" was deleted.`);
            this.resetSession(fallback);
            this.doc = await open(fallback);
            this.nameInput.set_value(this.name);
          } else {
            this.doc = null;
          }
        } else {
          this.doc = doc;
        }
        seen = currentGeneration();
        cx.notify();
      }
    });
    cx.spawn(async () => {
      for (;;) {
        const next = await onContextChanged();
        if (!this.alive) return;
        this.threadId = next.threadId;
        if (!this.pinned && next.projectId !== this.projectId) await this.follow(next);
        else await this.refreshThreads();
        cx.notify();
      }
    });
  }

  /** @param {string} [name] */
  resetSession(name) {
    if (name !== undefined) this.name = name;
    this.wantEdit = false;
    this.editing = false;
    this.gesture = null;
    this.preview = null;
    this.draft = null;
    this.resize = null;
    this.selected = [];
    this.hidden = new Set();
    this.confirmDelete = false;
    this.confirmName = "";
  }

  /** @param {ReturnType<typeof context>} ctx */
  async follow(ctx) {
    this.projectId = ctx.projectId ?? "";
    this.threadId = ctx.threadId;
    this.projectName = await projectCanvasName(ctx.projectId);
    await this.refreshThreads();
    if (this.pinned) return;
    this.resetSession(this.projectName);
    this.nameInput.set_value(this.name);
    this.doc = await open(this.name);
    this.names = await list();
  }

  async refreshThreads() {
    const projectId = this.projectId;
    if (projectId === "") {
      this.threads = [];
      return;
    }
    try {
      const threads = await listThreads({ projectId, archived: false, limit: 50 });
      if (!this.alive || this.projectId !== projectId) return;
      this.threads = threads.map((thread) => ({ id: thread.id, title: thread.title ?? "" }));
      this.threadsError = "";
      const open = this.threadId ?? "";
      if (this.sendTarget !== "" && this.sendTarget !== open && !this.threads.some((thread) => thread.id === this.sendTarget)) {
        this.sendTarget = "";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.threadsError !== message) {
        this.threadsError = message;
        log("warn", message);
        toast(message);
      }
    }
  }

  threadChoices() {
    const open = this.threadId ?? "";
    /** @type {{ id: string, label: string, disabled?: boolean }[]} */
    const rows = [];
    if (open !== "") rows.push({ id: open, label: "This thread" });
    for (const thread of this.threads) {
      if (thread.id === open) continue;
      const title = thread.title.trim();
      rows.push({ id: thread.id, label: title !== "" ? title : thread.id });
    }
    if (rows.length === 0) rows.push({ id: "none", label: "This thread", disabled: true });
    return rows;
  }

  chosenThread() {
    const open = this.threadId || context().threadId || "";
    if (this.sendTarget !== "" && (this.sendTarget === open || this.threads.some((thread) => thread.id === this.sendTarget))) return this.sendTarget;
    return open;
  }

  sync() {
    // Drawing is rebuilt in render via PathBuilder; notify only.
  }

  shown() {
    if (this.doc === null) return /** @type {import("./model.js").ElementRecord[]} */ ([]);
    let elements = this.doc.elements.filter((element) => {
      if (this.hidden.has(element.id ?? "")) return false;
      if (element.type === "arrow" && ((element.from && this.hidden.has(element.from)) || (element.to && this.hidden.has(element.to)))) return false;
      return true;
    });
    if (this.preview) {
      const preview = this.preview;
      elements = elements.map((element) => (preview.ids.has(element.id ?? "") && !isBound(element) ? translated(element, preview.dx, preview.dy) : element));
    }
    if (this.resize) {
      const resize = this.resize;
      elements = elements.map((element) => (element.id === resize.id && element.type === "box" ? { ...element, x: resize.x, y: resize.y, w: resize.w, h: resize.h } : element));
    }
    if (this.editing && this.selected.length === 1) {
      const value = this.labelInput.value();
      elements = elements.map((element) => {
        if (element.id !== this.selected[0]) return element;
        if (element.type === "box" || element.type === "arrow") return { ...element, label: value };
        if (element.type === "text" && value.trim() !== "") return { ...element, text: value };
        return element;
      });
    }
    return elements;
  }

  /**
   * @param {unknown[]} ops
   * @param {import("gpui-kit").Context} cx
   * @param {boolean} drawn
   */
  apply(ops, cx, drawn) {
    if (this.doc === null || this.name === "" || ops.length === 0) return;
    const name = this.name;
    cx.spawn(async (taskCx) => {
      try {
        const result = await edit(name, ops);
        if (!this.alive || this.name !== name) {
          this.wantEdit = false;
          return;
        }
        this.doc = result.doc;
        if (result.added.length > 0) this.selected = result.added;
        if (this.wantEdit) {
          this.wantEdit = false;
          this.editing = true;
        }
        if (drawn && !this.sticky) this.tool = "select";
        this.preview = null;
        this.draft = null;
        this.hidden = new Set();
        this.fillLabel();
        this.sync();
        taskCx.notify();
      } catch (error) {
        this.preview = null;
        this.draft = null;
        this.hidden = new Set();
        this.sync();
        const message = error instanceof Error ? error.message : String(error);
        log("error", message);
        toast(message);
        taskCx.notify();
      }
    });
  }

  fillLabel() {
    const element = this.only();
    if (element === undefined) {
      this.labelInput.set_value("");
      return;
    }
    if (element.type === "text") this.labelInput.set_value(element.text);
    else if (element.type === "box" || element.type === "arrow") this.labelInput.set_value(element.label ?? "");
    else this.labelInput.set_value("");
  }

  only() {
    if (this.doc === null || this.selected.length !== 1) return undefined;
    return this.doc.elements.find((element) => element.id === this.selected[0]);
  }

  /** @param {import("gpui-kit").Context} cx */
  commitLabel(cx) {
    const element = this.only();
    if (element === undefined || element.id === undefined) return;
    const value = this.labelInput.value();
    if (element.type === "text") {
      const text = value.trim();
      if (text === "" || text === element.text) return;
      this.apply([{ op: "update", id: element.id, patch: { text } }], cx, false);
      return;
    }
    if (element.type === "box" || element.type === "arrow") {
      if ((element.label ?? "") === value) return;
      const grown = element.type === "box" ? Math.max(element.h, boxHeightForLabel(element.w, value)) : element.h;
      const patch = element.type === "box" && grown > element.h ? { label: value, h: grown } : { label: value };
      this.apply([{ op: "update", id: element.id, patch }], cx, false);
    }
  }

  /** @param {{ x: number, y: number }} local */
  toWorld(local) {
    return { x: (local.x - this.viewX) / this.scale, y: (local.y - this.viewY) / this.scale };
  }

  /** @param {{ x: number, y: number }} local @param {number} next */
  zoomAt(local, next) {
    const world = this.toWorld(local);
    this.scale = Math.min(30, Math.max(0.1, next));
    this.viewX = local.x - world.x * this.scale;
    this.viewY = local.y - world.y * this.scale;
  }

  /**
   * @param {import("gpui-kit").MouseMoveEvent | import("gpui-kit").MouseButtonEvent | import("gpui-kit").ScrollWheelEvent} event
   * @param {import("gpui-kit").Context} [cx]
   */
  remember(event, cx) {
    if (!event.bounds) return;
    this.viewport = { w: event.bounds.width, h: event.bounds.height };
    const narrow = event.bounds.width < NARROW_PANEL;
    if (narrow !== this.narrow) {
      this.narrow = narrow;
      cx?.notify();
    }
  }

  /** @param {import("gpui-kit").MouseButtonEvent} event @param {import("gpui-kit").Context} cx */
  down(event, cx) {
    const local = event.local_position;
    if (local === undefined || this.doc === null) return;
    this.focus.focus();
    this.remember(event, cx);
    const world = this.toWorld(local);
    this.pointer = world;
    if (event.click_count >= 2) {
      this.double(world, cx);
      return;
    }
    if (this.space || this.tool === "hand") {
      this.gesture = { kind: "pan", x: local.x, y: local.y };
      return;
    }
    if (this.tool === "select") {
      const handle = this.handleAt(world);
      if (handle) {
        this.gesture = { kind: "resize", x: world.x, y: world.y, ...handle };
        return;
      }
      const hit = hitTest(this.doc, world.x, world.y, this.scale);
      if (hit?.id === undefined) {
        if (!event.modifiers.shift) this.selected = [];
        this.gesture = { kind: "marquee", x: world.x, y: world.y };
        this.draft = { type: "box", id: "draft", x: world.x, y: world.y, w: 0, h: 0, color: "gray" };
      } else {
        if (event.modifiers.shift) {
          this.selected = this.selected.includes(hit.id) ? this.selected.filter((id) => id !== hit.id) : [...this.selected, hit.id];
        } else if (!this.selected.includes(hit.id)) this.selected = [hit.id];
        this.gesture = { kind: "move", x: world.x, y: world.y, moved: false };
        this.fillLabel();
      }
      this.sync();
      cx.notify();
      return;
    }
    if (this.tool === "erase") {
      this.gesture = { kind: "erase", x: world.x, y: world.y };
      this.hidden = new Set();
      this.eraseAt(world);
      this.sync();
      cx.notify();
      return;
    }
    if (this.tool === "text") {
      this.wantEdit = true;
      this.apply([{ op: "add", element: { type: "text", x: world.x, y: world.y, text: "text", color: this.color } }], cx, true);
      return;
    }
    this.gesture = { kind: "draw", x: world.x, y: world.y, points: [[world.x, world.y]] };
  }

  /** @param {import("gpui-kit").MouseMoveEvent} event @param {import("gpui-kit").Context} cx */
  move(event, cx) {
    const local = event.local_position;
    if (local === undefined) return;
    this.remember(event, cx);
    const world = this.toWorld(local);
    this.pointer = world;
    const gesture = this.gesture;
    if (gesture === null) return;
    if (gesture.kind === "pan") {
      this.viewX += local.x - gesture.x;
      this.viewY += local.y - gesture.y;
      gesture.x = local.x;
      gesture.y = local.y;
      this.sync();
      cx.notify();
      return;
    }
    if (gesture.kind === "move") {
      const dx = world.x - gesture.x;
      const dy = world.y - gesture.y;
      if (Math.hypot(dx, dy) > 2 / this.scale) gesture.moved = true;
      this.preview = { ids: new Set(this.selected), dx, dy };
      cx.notify();
      return;
    }
    if (gesture.kind === "marquee") {
      const rect = boxBetween(gesture.x, gesture.y, world.x, world.y, false);
      this.draft = { type: "box", id: "draft", ...rect, color: "gray" };
      cx.notify();
      return;
    }
    if (gesture.kind === "erase") {
      this.eraseAt(world);
      cx.notify();
      return;
    }
    if (gesture.kind === "resize") {
      this.resize = resized(gesture, world);
      cx.notify();
      return;
    }
    if (gesture.kind === "draw") {
      this.previewDraw(gesture, world, event.modifiers.shift);
      cx.notify();
    }
  }

  /** @param {import("gpui-kit").MouseButtonEvent} event @param {import("gpui-kit").Context} cx */
  up(event, cx) {
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture === null || this.doc === null) return;
    const local = event.local_position;
    const world = local ? this.toWorld(local) : this.pointer;
    if (gesture.kind === "pan") return;
    if (gesture.kind === "move") {
      this.preview = null;
      if (gesture.moved) {
        const dx = world.x - gesture.x;
        const dy = world.y - gesture.y;
        const ops = this.selected
          .filter((id) => {
            const element = this.doc?.elements.find((item) => item.id === id);
            return element !== undefined && !isBound(element);
          })
          .map((id) => ({ op: "move", id, dx, dy }));
        if (ops.length > 0) this.apply(ops, cx, false);
        else {
          this.sync();
          cx.notify();
        }
      } else {
        this.sync();
        cx.notify();
      }
      return;
    }
    if (gesture.kind === "marquee") {
      const rect = boxBetween(gesture.x, gesture.y, world.x, world.y, false);
      this.selected = this.doc.elements.filter((element) => intersects(rect, boundsOf(element, this.doc?.elements ?? []))).map((element) => element.id ?? "");
      this.draft = null;
      this.fillLabel();
      this.sync();
      cx.notify();
      return;
    }
    if (gesture.kind === "resize") {
      const rect = resized(gesture, world);
      this.resize = null;
      this.apply([{ op: "update", id: gesture.id, patch: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } }], cx, false);
      return;
    }
    if (gesture.kind === "erase") {
      const ops = deleteOps(this.doc.elements, [...this.hidden]);
      this.hidden = new Set();
      if (ops.length > 0) this.apply(ops, cx, false);
      else {
        this.sync();
        cx.notify();
      }
      return;
    }
    if (gesture.kind === "draw") {
      const ops = this.drawOps(gesture, world, event.modifiers.shift);
      this.draft = null;
      if (ops.length > 0) this.apply(ops, cx, true);
      else {
        this.sync();
        cx.notify();
      }
    }
  }

  /** @param {boolean} hovered @param {import("gpui-kit").Context} cx */
  hover(hovered, cx) {
    if (!hovered && this.gesture !== null) {
      this.up({ local_position: undefined, modifiers: { shift: false, control: false, alt: false, platform: false, function: false }, button: "left", click_count: 1, position: { x: 0, y: 0 } }, cx);
    }
  }

  /** @param {{ x: number, y: number }} world @param {import("gpui-kit").Context} cx */
  double(world, cx) {
    if (this.doc === null) return;
    const hit = hitTest(this.doc, world.x, world.y, this.scale);
    if (hit?.id === undefined) {
      this.apply([{ op: "add", element: { type: "text", x: world.x, y: world.y, text: "text", color: this.color } }], cx, true);
      return;
    }
    this.selected = [hit.id];
    this.tool = "select";
    this.editing = hit.type !== "path";
    this.fillLabel();
    this.sync();
    cx.notify();
  }

  /** @param {{ kind: string, x: number, y: number, points?: number[][] }} gesture @param {{ x: number, y: number }} world @param {boolean} shift */
  previewDraw(gesture, world, shift) {
    if (this.tool === "rect") {
      this.draft = { type: "box", id: "draft", ...boxBetween(gesture.x, gesture.y, world.x, world.y, shift), color: this.color };
    } else if (this.tool === "arrow" || this.tool === "line") {
      const end = shift ? snap(gesture.x, gesture.y, world.x, world.y) : world;
      const linked = this.linkedArrow(gesture.x, gesture.y, end.x, end.y);
      this.draft = {
        type: "arrow",
        id: "draft",
        x1: linked.x1,
        y1: linked.y1,
        x2: linked.x2,
        y2: linked.y2,
        ...(linked.from ? { from: linked.from } : {}),
        ...(linked.to ? { to: linked.to } : {}),
        heads: this.tool === "line" ? "none" : "end",
        color: this.color,
      };
    } else if (this.tool === "pen" && gesture.points) {
      const last = gesture.points[gesture.points.length - 1];
      if (gesture.points.length < 2000 && (!last || Math.hypot(world.x - last[0], world.y - last[1]) >= 1.5)) gesture.points.push([world.x, world.y]);
      const points = gesture.points.length < 2 ? [gesture.points[0], gesture.points[0]] : gesture.points;
      this.draft = { type: "path", id: "draft", points, color: this.color };
    }
  }

  /**
   * @param {{ kind: string, x: number, y: number, points?: number[][] }} gesture
   * @param {{ x: number, y: number }} world
   * @param {boolean} shift
   */
  drawOps(gesture, world, shift) {
    if (this.doc === null) return [];
    if (this.tool === "rect") {
      const rect = boxBetween(gesture.x, gesture.y, world.x, world.y, shift);
      if (rect.w < 4 || rect.h < 4) return [];
      return [{ op: "add", element: { type: "box", ...rect, color: this.color } }];
    }
    if (this.tool === "arrow" || this.tool === "line") {
      const end = shift ? snap(gesture.x, gesture.y, world.x, world.y) : world;
      if (Math.hypot(end.x - gesture.x, end.y - gesture.y) < 4) return [];
      const heads = this.tool === "line" ? "none" : "end";
      const linked = this.linkedArrow(gesture.x, gesture.y, end.x, end.y);
      return [{ op: "add", element: { type: "arrow", x1: linked.x1, y1: linked.y1, x2: linked.x2, y2: linked.y2, ...(linked.from ? { from: linked.from } : {}), ...(linked.to ? { to: linked.to } : {}), heads, color: this.color } }];
    }
    if (this.tool === "pen" && gesture.points && gesture.points.length >= 2) {
      return [{ op: "add", element: { type: "path", points: gesture.points.slice(0, 2000), color: this.color } }];
    }
    return [];
  }

  /** @param {{ x: number, y: number }} world */
  eraseAt(world) {
    if (this.doc === null) return;
    const hit = hitTest(this.doc, world.x, world.y, this.scale);
    if (hit?.id) this.hidden.add(hit.id);
  }

  /** @param {import("gpui-kit").ScrollWheelEvent} event @param {import("gpui-kit").Context} cx */
  wheel(event, cx) {
    const local = event.local_position;
    if (local === undefined) return;
    this.remember(event, cx);
    if (event.modifiers.platform) {
      const dy = event.delta_lines?.y ?? event.delta.y / 40;
      this.zoomAt(local, this.scale * Math.exp(-dy * 0.35));
    } else {
      this.viewX += event.delta.x;
      this.viewY += event.delta.y;
    }
    this.sync();
    cx.notify();
    cx.stop_propagation();
  }

  /** @param {import("gpui-kit").KeyEvent} event @param {import("gpui-kit").Context} cx */
  key(event, cx) {
    if (this.doc === null) return;
    const chord = event.keystroke;
    if (chord === "cmd-z") return this.history("undo", cx);
    if (chord === "cmd-shift-z" || chord === "cmd-y") return this.history("redo", cx);
    if (chord === "cmd-a") {
      this.selected = this.doc.elements.map((element) => element.id ?? "").filter((id) => id !== "");
      this.sync();
      cx.notify();
      cx.stop_propagation();
      return;
    }
    if (chord === "cmd-c" || chord === "cmd-x") return this.copy(cx, chord === "cmd-x");
    if (chord === "cmd-v") return this.paste(cx);
    if (chord === "cmd-d") return this.duplicate(cx);
    if (chord === "cmd-0") {
      this.viewX = 32;
      this.viewY = 32;
      this.scale = 1;
      this.sync();
      cx.notify();
      cx.stop_propagation();
      return;
    }
    if (chord === "cmd-=" || chord === "cmd-equal" || chord === "cmd-minus" || chord === "cmd--") {
      const local = { x: (this.viewport?.w ?? 400) / 2, y: (this.viewport?.h ?? 300) / 2 };
      this.zoomAt(local, this.scale * (chord.startsWith("cmd-minus") || chord === "cmd--" ? 0.9 : 1.1));
      this.sync();
      cx.notify();
      cx.stop_propagation();
      return;
    }
    if (event.modifiers.platform || event.modifiers.control || event.modifiers.alt) return;
    if (event.key === "space") {
      this.space = true;
      cx.stop_propagation();
      return;
    }
    if (event.key === "escape") {
      if (this.confirmDelete) {
        this.confirmDelete = false;
        this.confirmName = "";
        cx.notify();
        cx.stop_propagation();
        return;
      }
      this.selected = [];
      this.draft = null;
      this.preview = null;
      this.resize = null;
      this.editing = false;
      this.gesture = null;
      this.tool = "select";
      this.sync();
      cx.notify();
      cx.stop_propagation();
      return;
    }
    if (event.key === "backspace" || event.key === "delete") {
      this.apply(deleteOps(this.doc.elements, this.selected), cx, false);
      this.selected = [];
      cx.stop_propagation();
      return;
    }
    if (event.key === "enter") {
      this.commitLabel(cx);
      cx.stop_propagation();
      return;
    }
    if (event.key === "1" && event.modifiers.shift) {
      this.fit(cx);
      cx.stop_propagation();
      return;
    }
    const nudge = event.modifiers.shift ? 20 : 4;
    if (event.key === "left" || event.key === "right" || event.key === "up" || event.key === "down") {
      const dx = event.key === "left" ? -nudge : event.key === "right" ? nudge : 0;
      const dy = event.key === "up" ? -nudge : event.key === "down" ? nudge : 0;
      const ops = this.selected
        .filter((id) => {
          const element = this.doc?.elements.find((item) => item.id === id);
          return element !== undefined && !isBound(element);
        })
        .map((id) => ({ op: "move", id, dx, dy }));
      this.apply(ops, cx, false);
      cx.stop_propagation();
      return;
    }
    if (event.is_held) return;
    const tool = toolFor(event.key);
    if (tool) {
      this.tool = tool;
      cx.notify();
      cx.stop_propagation();
      return;
    }
    if (event.key === "q") {
      this.sticky = !this.sticky;
      cx.notify();
      cx.stop_propagation();
    }
  }

  /** @param {import("gpui-kit").KeyEvent} event */
  keyUp(event) {
    if (event.key === "space") this.space = false;
  }

  /** @param {"undo" | "redo"} direction @param {import("gpui-kit").Context} cx */
  history(direction, cx) {
    if (this.name === "") return;
    const name = this.name;
    cx.spawn(async (taskCx) => {
      try {
        const doc = await step(name, direction);
        if (!this.alive || this.name !== name) return;
        this.doc = doc;
        this.selected = [];
        this.sync();
        taskCx.notify();
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error));
      }
    });
    cx.stop_propagation();
  }

  /** @param {import("gpui-kit").Context} cx @param {boolean} cut */
  copy(cx, cut) {
    if (this.doc === null || this.selected.length === 0) return;
    cx.write_to_clipboard(encodeClip(copyElements(this.selected, this.doc.elements)));
    if (cut) {
      this.apply(deleteOps(this.doc.elements, this.selected), cx, false);
      this.selected = [];
    }
    cx.stop_propagation();
  }

  /** @param {import("gpui-kit").Context} cx */
  paste(cx) {
    const text = cx.read_from_clipboard();
    if (text === undefined || this.doc === null) return;
    const clip = decodeClip(text);
    if (clip === null) {
      const body = text.trim().slice(0, 500);
      if (body !== "") this.apply([{ op: "add", element: { type: "text", x: this.pointer.x, y: this.pointer.y, text: body, color: this.color } }], cx, false);
      cx.stop_propagation();
      return;
    }
    const center = clipCenter(clip);
    this.apply(pasteOps(clip, this.pointer.x - center.x, this.pointer.y - center.y), cx, false);
    cx.stop_propagation();
  }

  /** @param {import("gpui-kit").Context} cx */
  duplicate(cx) {
    if (this.doc === null || this.selected.length === 0) return;
    this.apply(pasteOps(copyElements(this.selected, this.doc.elements), 24, 24), cx, false);
    cx.stop_propagation();
  }

  /** @param {import("gpui-kit").Context} cx */
  fit(cx) {
    if (this.doc === null || this.viewport === null) return;
    const bounds = contentBounds(this.doc);
    if (bounds === null) {
      this.viewX = 32;
      this.viewY = 32;
      this.scale = 1;
    } else {
      const pad = 32;
      const w = Math.max(bounds.w, 1);
      const h = Math.max(bounds.h, 1);
      this.scale = Math.min(30, Math.max(0.1, Math.min((this.viewport.w - pad * 2) / w, (this.viewport.h - pad * 2) / h)));
      this.viewX = pad - bounds.x * this.scale;
      this.viewY = pad - bounds.y * this.scale;
    }
    this.sync();
    cx.notify();
  }

  /** @param {import("gpui-kit").Context} cx */
  useName(cx) {
    const name = normalizeName(this.nameInput.value());
    if (name === "") {
      toast("Enter a canvas name (letters, numbers, dashes).");
      return;
    }
    this.pinned = true;
    this.resetSession(name);
    this.naming = false;
    cx.spawn(async (taskCx) => {
      try {
        this.doc = await open(name);
        this.names = await list();
        taskCx.notify();
      } catch (error) {
        log("error", error instanceof Error ? error.message : String(error));
        toast(error instanceof Error ? error.message : String(error));
      }
    });
  }

  /** @param {import("gpui-kit").Context} cx */
  makeCanvas(cx) {
    const known = new Set(this.names);
    let name = this.projectName || "canvas";
    let n = 2;
    while (known.has(name)) {
      name = `${this.projectName || "canvas"}-${n}`;
      n += 1;
    }
    this.nameInput.set_value(name);
    this.pinned = true;
    this.resetSession(name);
    this.doc = null;
    cx.spawn(async (taskCx) => {
      try {
        this.doc = await open(name);
        this.names = await list();
        taskCx.notify();
      } catch (error) {
        log("error", error instanceof Error ? error.message : String(error));
        toast(error instanceof Error ? error.message : String(error));
      }
    });
    cx.notify();
  }

  /** @param {import("gpui-kit").Context} cx */
  deleteCanvas(cx) {
    const name = this.confirmName || this.name;
    if (name === "") return;
    this.confirmDelete = false;
    this.confirmName = "";
    this.pinned = false;
    const next = this.projectName || "canvas";
    const leaving = this.name === name;
    if (leaving) {
      this.resetSession(next);
      this.nameInput.set_value(this.name);
      this.doc = null;
    }
    cx.spawn(async (taskCx) => {
      try {
        await remove(name);
        if (leaving && this.name === next) this.doc = await open(next);
        this.names = await list();
        taskCx.notify();
      } catch (error) {
        log("error", error instanceof Error ? error.message : String(error));
        toast(error instanceof Error ? error.message : String(error));
      }
    });
    cx.notify();
  }

  /** @param {import("gpui-kit").Context} cx */
  sendNote(cx) {
    if (this.sending) return;
    if (this.doc === null) {
      toast("Open Canvas from the rail, then try again.");
      return;
    }
    const threadId = this.chosenThread();
    if (!threadId) {
      toast("Open a thread on the left, then try again.");
      return;
    }
    const text = shareText(this.doc, this.noteInput.value());
    this.sending = true;
    cx.notify();
    cx.spawn(async () => {
      try {
        if (typeof host.pasteIntoThread === "function") {
          await host.pasteIntoThread(threadId, text);
        } else {
          const { run } = await import("kagan/process");
          const result = await run("kg", ["thread", "paste", threadId, text]);
          if (result.exitCode !== 0) {
            throw new Error((result.stderr || result.stdout || "kg paste failed").trim());
          }
        }
        this.noteInput.set_value("");
        toast("Pasted into the thread.");
      } catch (error) {
        cx.write_to_clipboard(text);
        toast("Could not paste into the thread. Copied the note instead.");
        log("warn", `paste failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      this.sending = false;
      cx.notify();
    });
  }

  /**
   * @param {import("gpui-kit").Context} cx
   * @param {string} color
   */
  recolor(cx, color) {
    this.color = color;
    this.palette = false;
    if (this.doc === null || this.selected.length === 0) {
      cx.notify();
      return;
    }
    this.apply(this.selected.map((id) => ({ op: "update", id, patch: { color } })), cx, false);
  }

  /**
   * @param {import("gpui-kit").Context} cx
   * @param {string} heads
   */
  setHeads(cx, heads) {
    if (this.doc === null) return;
    const ops = this.doc.elements
      .filter((element) => element.type === "arrow" && element.id !== undefined && this.selected.includes(element.id))
      .map((element) => ({ op: "update", id: element.id, patch: { heads } }));
    this.apply(ops, cx, false);
  }

  strokeColor() {
    if (this.doc === null || this.selected.length === 0) return this.color;
    const first = this.doc.elements.find((element) => element.id === this.selected[0]);
    return first?.color ?? "default";
  }

  /** @param {import("gpui-kit").Context} cx */
  render(cx) {
    const colors = cx.theme().colors;
    const root = div()
      .id("canvas-root")
      .relative()
      .size_full()
      .overflow_hidden()
      .bg(colors.background)
      .text_color(colors.foreground)
      .on_mouse_move((event, ctx) => this.remember(event, ctx))
      .child(this.surface(colors));
    root.child(this.topBar(colors));
    root.child(this.bottomBar(colors));
    if (this.menu) root.child(this.dismiss()).child(this.menuPanel(colors));
    if (this.confirmDelete) root.child(this.deleteDialog(colors));
    return root;
  }

  showStyle() {
    return this.selected.length > 0 || this.tool === "rect" || this.tool === "arrow" || this.tool === "line" || this.tool === "pen" || this.tool === "text";
  }

  /** @param {import("gpui-base").ColorTokens} colors */
  surface(colors) {
    const empty = this.doc !== null && this.doc.elements.length === 0 && this.draft === null && this.gesture === null;
    const layer = div()
      .id("canvas-surface")
      .absolute()
      .inset_0()
      .track_focus(this.focus)
      .key_context("Canvas")
      .on_mouse_down("left", (event, ctx) => this.down(event, ctx))
      .on_mouse_down("middle", (event, ctx) => {
        const local = event.local_position;
        if (local === undefined) return;
        this.gesture = { kind: "pan", x: local.x, y: local.y };
      })
      .on_mouse_up("left", (event, ctx) => this.up(event, ctx))
      .on_mouse_up("middle", (event, ctx) => this.up(event, ctx))
      .on_mouse_move((event, ctx) => this.move(event, ctx))
      .on_hover((hovered, ctx) => this.hover(hovered, ctx))
      .on_scroll_wheel((event, ctx) => this.wheel(event, ctx))
      .on_key_down((event, ctx) => this.key(event, ctx))
      .on_key_up((event) => this.keyUp(event));
    if (this.gesture?.kind === "pan" || this.space) layer.cursor_grabbing();
    else if (this.tool === "hand") layer.cursor_grab();
    else if (this.tool === "select") layer.cursor_default();
    else layer.cursor_crosshair();
    const theme = context().theme === "dark" ? "dark" : "light";
    const swatch = SWATCH[theme];
    const view = { x: this.viewX, y: this.viewY, scale: this.scale };
    /** @type {import("gpui-kit").Element[]} */
    const drawn = [];
    try {
      drawn.push(
        ...renderScene(this.shown(), view, this.selected, this.draft, swatch, swatch.blue),
      );
    } catch (error) {
      log("error", error instanceof Error ? error.message : String(error));
    }
    const frame = div().absolute().inset_0().bg(colors.background).children(drawn);
    if (empty) {
      frame.child(
        v_flex()
          .absolute()
          .inset_0()
          .items_center()
          .justify_center()
          .gap(8)
          .p(24)
          .text_color(colors.muted_foreground)
          .child(div().text_lg().child("Pick a tool and start drawing!"))
          .child(div().text_sm().child("Agents draw here too. Send the canvas to a thread below.")),
      );
    }
    return frame.child(layer);
  }

  /** @param {import("gpui-base").ColorTokens} colors */
  topBar(colors) {
    return v_flex()
      .absolute()
      .top(12)
      .left(12)
      .right(12)
      .gap(8)
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(this.square("canvas-menu", "icons/menu.svg", "Main menu", this.menu, colors, (ctx) => {
            this.menu = !this.menu;
            this.palette = false;
            this.naming = false;
            ctx.notify();
          }))
          .child(div().flex_1().min_w(0).truncate().text_xs().text_color(colors.muted_foreground).child(this.name)),
      )
      .child(h_flex().w_full().justify_center().child(this.toolIsland(colors)));
  }

  /** @param {import("gpui-base").ColorTokens} colors */
  toolIsland(colors) {
    return island(colors)
      .max_w_full()
      .flex_wrap()
      .justify_center()
      .p(4)
      .gap(2)
      .child(this.square("tool-keep", this.sticky ? "icons/lock.svg" : "icons/lock-open.svg", "Keep the tool after drawing — Q", this.sticky, colors, (ctx) => {
        this.sticky = !this.sticky;
        ctx.notify();
      }))
      .child(div().w(1).h(24).mx(4).bg(colors.border))
      .children(TOOLS.map(([tool, letter, tip, icon]) => this.toolButton(tool, letter, tip, icon, colors)));
  }

  /**
   * @param {string} tool
   * @param {string} letter
   * @param {string} tip
   * @param {string} icon
   * @param {import("gpui-base").ColorTokens} colors
   */
  toolButton(tool, letter, tip, icon, colors) {
    const button = this.square(`tool-${tool}`, icon, tip, this.tool === tool, colors, (ctx) => {
      this.tool = tool;
      this.editing = false;
      this.menu = false;
      ctx.notify();
    });
    if (this.narrow) button.size("large").min_w(44).min_h(44);
    const cell = div()
      .relative()
      .flex()
      .items_center()
      .justify_center()
      .on_mouse_down("left", (_event, ctx) => {
        this.tool = tool;
        this.editing = false;
        this.menu = false;
        ctx.notify();
      });
    if (this.narrow) cell.w(44).h(44);
    cell.child(button);
    if (!this.narrow) {
      cell.child(div().absolute().right(2).bottom(0).text_size(10).text_color(colors.muted_foreground).child(letter));
    }
    return cell;
  }

  /**
   * @param {string} id
   * @param {string} mark
   * @param {string} tip
   * @param {boolean} active
   * @param {import("gpui-base").ColorTokens} _colors
   * @param {(cx: import("gpui-kit").Context) => void} onClick
   */
  square(id, mark, tip, active, _colors, onClick) {
    const name = tip.split("—")[0].split("·")[0].trim();
    const button = new KgButton(id).tooltip(tip).ghost().compact().selected(active).on_click((_event, ctx) => onClick(ctx));
    if (mark.endsWith(".svg")) button.icon(mark).label(name);
    else button.label(mark);
    return button;
  }

  dismiss() {
    return div()
      .absolute()
      .inset_0()
      .on_mouse_down("left", (_event, ctx) => {
        this.menu = false;
        this.naming = false;
        ctx.notify();
        ctx.stop_propagation();
      });
  }

  /** @param {import("gpui-base").ColorTokens} colors */
  menuPanel(colors) {
    const names = this.doc !== null && !this.names.includes(this.name) ? [this.name, ...this.names] : this.names;
    const panel = island(colors)
      .absolute()
      .top(104)
      .left(12)
      .w(240)
      .p(8)
      .flex_col()
      .gap(2)
      .child(div().px(8).py(4).text_xs().text_color(colors.muted_foreground).child("Canvases"));
    for (const name of names) {
      panel.child(this.menuRow(`canvas-pick-${name}`, name, name === this.name, colors, (ctx) => {
        this.menu = false;
        this.nameInput.set_value(name);
        this.useName(ctx);
      }));
    }
    if (this.naming) {
      panel.child(
        h_flex()
          .gap(4)
          .p(4)
          .child(div().flex_1().child(new Input(this.nameInput)))
          .child(this.square("canvas-create", "icons/plus.svg", "Create this canvas", false, colors, (ctx) => this.useName(ctx))),
      );
    } else {
      panel.child(this.menuRow("canvas-new", "New canvas…", false, colors, (ctx) => {
        this.naming = true;
        this.nameInput.set_value("");
        ctx.notify();
      }));
    }
    panel.child(div().h(1).my(4).bg(colors.border));
    panel.child(this.menuRow("canvas-fit", "Zoom to fit", false, colors, (ctx) => {
      this.menu = false;
      this.fit(ctx);
    }));
    panel.child(this.copyImageRow());
    panel.child(this.menuRow("canvas-clear", "Reset the canvas", false, colors, (ctx) => {
      this.menu = false;
      this.selected = [];
      this.apply([{ op: "clear" }], ctx, false);
    }));
    panel.child(this.menuRow("canvas-delete", "Delete this canvas", false, colors, (ctx) => {
      this.menu = false;
      if (this.name === "") return;
      this.confirmName = this.name;
      this.confirmDelete = true;
      ctx.notify();
    }));
    return panel;
  }

  /**
   * @param {string} id
   * @param {string} label
   * @param {boolean} current
   * @param {import("gpui-base").ColorTokens} _colors
   * @param {(cx: import("gpui-kit").Context) => void} onClick
   */
  menuRow(id, label, current, _colors, onClick) {
    return new KgButton(id).label(current ? `✓ ${label}` : label).ghost().compact().w_full().on_click((_event, ctx) => onClick(ctx));
  }

  copyImageRow() {
    const row = this.menuRow("canvas-copy-image", "Copy as image", false, /** @type {import("gpui-base").ColorTokens} */ ({}), () => {});
    row.disabled(true).tooltip(COPY_IMAGE_REASON);
    return div()
      .relative()
      .w_full()
      .child(row)
      .child(
        div()
          .absolute()
          .inset_0()
          .on_mouse_down("left", (_event, ctx) => {
            this.menu = false;
            toast(COPY_IMAGE_REASON);
            ctx.notify();
            ctx.stop_propagation();
          }),
      );
  }

  /** @param {import("gpui-base").ColorTokens} colors */
  deleteDialog(colors) {
    const name = this.confirmName || this.name;
    return div()
      .absolute()
      .inset_0()
      .flex()
      .items_center()
      .justify_center()
      .child(
        div()
          .absolute()
          .inset_0()
          .bg(colors.foreground)
          .opacity(0.35)
          .on_mouse_down("left", (_event, ctx) => {
            this.confirmDelete = false;
            this.confirmName = "";
            ctx.notify();
            ctx.stop_propagation();
          }),
      )
      .child(
        v_flex()
          .relative()
          .w(320)
          .max_w_full()
          .m(16)
          .p(16)
          .gap(8)
          .bg(colors.background)
          .border(1)
          .border_color(colors.border)
          .rounded_lg()
          .shadow_lg()
          .on_mouse_down("left", (_event, ctx) => ctx.stop_propagation())
          .child(div().text_base().font_semibold().child(`Delete “${name}”?`))
          .child(div().text_sm().text_color(colors.muted_foreground).child("Its shapes will be removed. Deleting a canvas cannot be undone."))
          .child(
            h_flex()
              .justify_end()
              .gap(8)
              .mt(8)
              .child(
                new KgButton("canvas-keep").label("Keep canvas").outline().compact().on_click((_event, ctx) => {
                  this.confirmDelete = false;
                  this.confirmName = "";
                  ctx.notify();
                }),
              )
              .child(new KgButton("canvas-delete-confirm").label("Delete canvas").danger().compact().on_click((_event, ctx) => this.deleteCanvas(ctx))),
          ),
      );
  }

  offscreen() {
    if (this.viewport === null || this.doc === null) return false;
    return contentOffscreen(contentBounds(this.doc), this.viewX, this.viewY, this.scale, this.viewport.w, this.viewport.h);
  }

  threadPicker() {
    return new Select(
      "canvas-thread",
      () => this.threadChoices(),
      () => null,
      (value, ctx) => {
        if (value === "none") return;
        this.sendTarget = value;
        ctx.notify();
      },
    )
      .placeholder("This thread")
      .accessibility_label("Send to")
      .w_full();
  }

  /** @param {import("gpui-base").ColorTokens} colors */
  stylePanel(colors) {
    const theme = context().theme === "dark" ? "dark" : "light";
    const ink = SWATCH[theme];
    const current = this.strokeColor();
    const arrows = this.doc?.elements.filter((element) => element.type === "arrow" && element.id !== undefined && this.selected.includes(element.id)) ?? [];
    const panel = v_flex()
      .w(220)
      .p(12)
      .gap(12)
      .bg(colors.background)
      .border(1)
      .border_color(colors.border)
      .rounded_lg()
      .shadow_md()
      .child(div().text_xs().child("Stroke"))
      .child(
        h_flex()
          .gap(4)
          .items_center()
          .children(TOP_PICKS.map((color) => this.swatch(`color-${color}`, color, ink[color], current === color, colors)))
          .child(div().w(1).h(24).mx(4).bg(colors.border))
          .child(this.swatch("color-more", current, ink[current] ?? ink.default, this.palette, colors, true)),
      );
    if (this.palette) {
      panel.child(
        h_flex()
          .flex_wrap()
          .gap(8)
          .p(8)
          .rounded_md()
          .bg(colors.secondary)
          .children(COLORS.map(([color]) => this.swatch(`color-all-${color}`, color, ink[color], current === color, colors))),
      );
    }
    if (arrows.length > 0) {
      panel.child(div().text_xs().child("Arrowheads")).child(
        h_flex().gap(4).children(HEADS.map(([heads, mark]) => this.square(`heads-${heads}`, mark, heads, arrows.every((arrow) => (arrow.heads ?? "end") === heads), colors, (ctx) => this.setHeads(ctx, heads)))),
      );
    }
    if (this.selected.length === 1) {
      const element = this.only();
      if (element && element.type !== "path") {
        panel.child(div().text_xs().child("Label")).child(new Input(this.labelInput).on_change(() => this.sync())).child(this.square("canvas-label", "icons/check.svg", "Set the label", false, colors, (ctx) => this.commitLabel(ctx)));
      }
      panel.child(div().text_xs().child("Actions")).child(
        h_flex()
          .gap(4)
          .child(this.square("canvas-duplicate", "icons/copy.svg", "Duplicate — Cmd+D", false, colors, (ctx) => this.duplicate(ctx)))
          .child(this.square("canvas-remove", "icons/trash.svg", "Delete", false, colors, (ctx) => {
            if (this.doc === null) return;
            this.apply(deleteOps(this.doc.elements, this.selected), ctx, false);
            this.selected = [];
          })),
      );
    }
    return panel;
  }

  /**
   * @param {string} id
   * @param {string} color
   * @param {string} hex
   * @param {boolean} pressed
   * @param {import("gpui-base").ColorTokens} colors
   * @param {boolean} [more]
   */
  swatch(id, color, hex, pressed, colors, more) {
    const chip = div()
      .id(id)
      .w(more ? 28 : 22)
      .h(more ? 28 : 22)
      .flex_none()
      .rounded_sm()
      .cursor_pointer()
      .tooltip(more ? "More colors" : color)
      .bg(/** @type {import("gpui-kit").Color} */ (hex))
      .on_click((_event, ctx) => {
        if (more) {
          this.palette = !this.palette;
          ctx.notify();
          return;
        }
        this.recolor(ctx, color);
      });
    if (pressed) chip.border(2).border_color(colors.primary);
    return chip;
  }

  /** @param {import("gpui-base").ColorTokens} colors */
  bottomBar(colors) {
    const bar = v_flex()
      .absolute()
      .bottom(12)
      .left(12)
      .right(12)
      .gap(8);
    if (this.offscreen()) {
      bar.child(
        h_flex()
          .justify_center()
          .child(new KgButton("canvas-scroll-back").label("Scroll back to content").outline().compact().on_click((_event, ctx) => this.fit(ctx))),
      );
    }
    if (!this.menu && this.showStyle()) bar.child(this.stylePanel(colors));
    return bar.child(h_flex()
      .flex_wrap()
      .items_end()
      .gap(8)
      .child(
        island(colors).child(this.square("canvas-zoom-out", "icons/zoom-out.svg", "Zoom out", false, colors, (ctx) => this.zoomBy(0.9, ctx))).child(
          h_flex()
            .id("canvas-zoom")
            .h(36)
            .px(8)
            .items_center()
            .justify_center()
            .cursor_pointer()
            .tooltip("Reset zoom")
            .on_click((_event, ctx) => {
              const local = { x: (this.viewport?.w ?? 400) / 2, y: (this.viewport?.h ?? 300) / 2 };
              this.zoomAt(local, 1);
              this.sync();
              ctx.notify();
            })
            .child(`${Math.round(this.scale * 100)}%`),
        ).child(this.square("canvas-zoom-in", "icons/zoom-in.svg", "Zoom in", false, colors, (ctx) => this.zoomBy(1.1, ctx))),
      )
      .child(
        island(colors)
          .child(this.square("canvas-undo", "icons/undo-2.svg", "Undo", false, colors, (ctx) => this.history("undo", ctx)))
          .child(this.square("canvas-redo", "icons/redo-2.svg", "Redo", false, colors, (ctx) => this.history("redo", ctx))),
      )
      .child(
        v_flex()
          .flex_1()
          .min_w("10rem")
          .p(4)
          .gap(4)
          .bg(colors.background)
          .border(1)
          .border_color(colors.border)
          .rounded_lg()
          .shadow_md()
          .child(this.threadPicker())
          .child(
            h_flex()
              .gap(4)
              .items_center()
              .child(div().flex_1().min_w("8rem").child(new Input(this.noteInput).aria_label("Note for the agent")))
              .child(new KgButton("canvas-send").label("Send").primary().compact().disabled(this.sending).on_click((_event, ctx) => this.sendNote(ctx))),
          ),
      ));
  }

  /** @param {{ x: number, y: number }} world */
  handleAt(world) {
    if (this.doc === null || this.selected.length !== 1) return null;
    const element = this.doc.elements.find((item) => item.id === this.selected[0]);
    if (element === undefined || element.type !== "box" || element.id === undefined) return null;
    const slop = 10 / this.scale;
    for (const handle of HANDLES) {
      const [hx, hy] = handlePoint(element, handle);
      if (Math.abs(world.x - hx) <= slop && Math.abs(world.y - hy) <= slop) {
        return { id: element.id, handle, ox: element.x, oy: element.y, ow: element.w, oh: element.h };
      }
    }
    return null;
  }

  /**
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   */
  linkedArrow(x1, y1, x2, y2) {
    if (this.doc === null) return { x1, y1, x2, y2 };
    const start = hitBox(this.doc, x1, y1, BIND_SLOP);
    const finish = hitBox(this.doc, x2, y2, BIND_SLOP);
    if (start?.id && finish?.id && start.id !== finish.id) return { x1: 0, y1: 0, x2: 0, y2: 0, from: start.id, to: finish.id };
    return { x1, y1, x2, y2 };
  }

  zoomBy(factor, cx) {
    const local = { x: (this.viewport?.w ?? 400) / 2, y: (this.viewport?.h ?? 300) / 2 };
    this.zoomAt(local, this.scale * factor);
    this.sync();
    cx.notify();
  }
}

/** @param {import("gpui-base").ColorTokens} colors */
function island(colors) {
  return h_flex().items_center().bg(colors.background).border(1).border_color(colors.border).rounded_lg().shadow_md();
}

/** @param {string} key */
function toolFor(key) {
  if (key === "v" || key === "1") return "select";
  if (key === "h") return "hand";
  if (key === "r" || key === "2") return "rect";
  if (key === "a" || key === "5") return "arrow";
  if (key === "l" || key === "6") return "line";
  if (key === "p" || key === "7") return "pen";
  if (key === "t" || key === "8") return "text";
  if (key === "e" || key === "0") return "erase";
  return "";
}

/** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {boolean} square */
function boxBetween(x1, y1, x2, y2, square) {
  let right = x2;
  let bottom = y2;
  if (square) {
    const side = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    right = x1 + Math.sign(x2 - x1 || 1) * side;
    bottom = y1 + Math.sign(y2 - y1 || 1) * side;
  }
  return { x: Math.min(x1, right), y: Math.min(y1, bottom), w: Math.abs(right - x1), h: Math.abs(bottom - y1) };
}

/** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
function snap(x1, y1, x2, y2) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const step = Math.PI / 12;
  const snapped = Math.round(angle / step) * step;
  const length = Math.hypot(x2 - x1, y2 - y1);
  return { x: x1 + Math.cos(snapped) * length, y: y1 + Math.sin(snapped) * length };
}

/** @param {import("./model.js").Doc} doc @param {number} x @param {number} y @param {number} scale */
function hitTest(doc, x, y, scale) {
  const slop = 8 / scale;
  for (let index = doc.elements.length - 1; index >= 0; index -= 1) {
    const element = doc.elements[index];
    if (hits(element, doc.elements, x, y, slop)) return element;
  }
  return undefined;
}

/** @param {import("./model.js").Doc} doc @param {number} x @param {number} y @param {number} [slop] */
function hitBox(doc, x, y, slop = 0) {
  for (let index = doc.elements.length - 1; index >= 0; index -= 1) {
    const element = doc.elements[index];
    if (element.type === "box" && x >= element.x - slop && y >= element.y - slop && x <= element.x + element.w + slop && y <= element.y + element.h + slop) return element;
  }
  return undefined;
}

/**
 * @param {{ x: number, y: number, handle?: string, ox?: number, oy?: number, ow?: number, oh?: number, id?: string }} gesture
 * @param {{ x: number, y: number }} world
 */
function resized(gesture, world) {
  const dx = world.x - gesture.x;
  const dy = world.y - gesture.y;
  let x = gesture.ox ?? 0;
  let y = gesture.oy ?? 0;
  let w = gesture.ow ?? MIN_BOX;
  let h = gesture.oh ?? MIN_BOX;
  const handle = gesture.handle ?? "";
  if (handle.includes("w")) {
    x += dx;
    w -= dx;
  }
  if (handle.includes("e")) w += dx;
  if (handle.includes("n")) {
    y += dy;
    h -= dy;
  }
  if (handle.includes("s")) h += dy;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  return { id: gesture.id ?? "", x, y, w: Math.max(MIN_BOX, w), h: Math.max(MIN_BOX, h) };
}

/** @param {{ x: number, y: number, w: number, h: number }} box @param {string} handle */
function handlePoint(box, handle) {
  const x = handle.includes("w") ? box.x : handle.includes("e") ? box.x + box.w : box.x + box.w / 2;
  const y = handle.includes("n") ? box.y : handle.includes("s") ? box.y + box.h : box.y + box.h / 2;
  return [x, y];
}

/**
 * @param {import("./model.js").ElementRecord} element
 * @param {import("./model.js").ElementRecord[]} elements
 * @param {number} x
 * @param {number} y
 * @param {number} slop
 */
function hits(element, elements, x, y, slop) {
  const bounds = boundsOf(element, elements);
  if (element.type === "box" || element.type === "text" || element.type === "path") {
    return x >= bounds.x - slop && y >= bounds.y - slop && x <= bounds.x + bounds.w + slop && y <= bounds.y + bounds.h + slop;
  }
  const points = element.type === "arrow"
    ? [[element.x1, element.y1], [element.x2, element.y2]]
    : [];
  if (element.type === "arrow") {
    const route = bounds;
    if (route.w === 0 && route.h === 0) return Math.hypot(x - route.x, y - route.y) <= slop;
  }
  // Distance to the straight chord is enough to grab a free arrow; bound arrows use their bounds inflated by slop.
  return x >= bounds.x - slop && y >= bounds.y - slop && x <= bounds.x + Math.max(bounds.w, 1) + slop && y <= bounds.y + Math.max(bounds.h, 1) + slop && (points.length === 0 || nearSegment(x, y, points[0][0], points[0][1], points[1][0], points[1][1], slop) || bounds.w > slop || bounds.h > slop);
}

/** @param {number} px @param {number} py @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {number} slop */
function nearSegment(px, py, x1, y1, x2, y2, slop) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / length));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)) <= slop;
}

/** @param {{ x: number, y: number, w: number, h: number }} a @param {{ x: number, y: number, w: number, h: number }} b */
function intersects(a, b) {
  return a.w > 0 && a.h > 0 && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** @param {import("./model.js").ElementRecord[]} elements @param {string[]} ids */
function deleteOps(elements, ids) {
  const chosen = new Set(ids);
  return ids
    .filter((id) => {
      const element = elements.find((item) => item.id === id);
      if (element === undefined) return false;
      if (element.type === "arrow" && ((element.from && chosen.has(element.from)) || (element.to && chosen.has(element.to)))) return false;
      return true;
    })
    .map((id) => ({ op: "delete", id }));
}

/** @param {import("./model.js").Doc} doc @param {string} note */
function shareText(doc, note) {
  const body = note.trim();
  const word = /^[\w.][\w.-]*$/.test(doc.name) ? doc.name : `'${doc.name.split("'").join("'\\''")}'`;
  return [
    ...(body === "" ? [] : [body, ""]),
    `The canvas beside you is "${doc.name}". Run this to see what is on it:`,
    "",
    `kg canvas show ${word}`,
    "",
    "Draw on it with the canvas_edit tool; the canvas skill says how.",
    body === "" ? "In one or two sentences, tell me what you see. Ask whether I want to draw or change anything." : "Then do what I asked.",
  ].join("\n");
}
