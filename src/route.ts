import { ARROW_FONT, ARROWHEAD_SIZE } from "./constants.ts";
import { boxHeightForLabel, boxLabelRect, textBounds, textInk, textWidth, type Point, type Rect } from "./layout.ts";
import type { Element } from "./model.ts";

type Box = Extract<Element, { type: "box" }>;
type Arrow = Extract<Element, { type: "arrow" }>;
type ArrowLike = Omit<Arrow, "id"> & { id: string };

/** One problem a person would see, naming every element involved. */
export type Note = { ids: string[]; text: string };

export type Layout = {
  routes: Map<string, Point[]>;
  /** Where each shown arrow label sits. A label with no clean spot is missing here. */
  labels: Map<string, Rect>;
  notes: Note[];
  /** Routes an arrow that is not on the canvas yet, such as the one being drawn. */
  route(arrow: ArrowLike): Point[];
  owns(element: Element): boolean;
};

/** A route keeps this far from a box it passes. */
const CLEAR = 16;
/** Spare lanes beside the middle of a wide gap, for a second arrow through it. */
const LANE = 14;
const FRAME = 48;
const REACH = 200;
/** Two lines closer than this read as one. */
const SHARE_TOL = 8;
/** Two lines closer than this read as a pair that is hard to follow. */
const NEAR_TOL = 28;

const BEND = 40;
const PORT_OFF = 24;
const CROSS = 30;
const SHARE_BASE = 2_000;
const SHARE_PX = 50;
const BOX_HIT = 100_000;
const TEXT_HIT = 20_000;
/** A run hugging a box costs more than one down the middle of the gap. */
const KIND_COST = [0, 0.1, 0.25] as const;

const LABEL_H = ARROW_FONT * 1.5;
const LABEL_PAD = 12;
const LABEL_CLEAR = 4;
const LABEL_END = 8;
const LABEL_HEAD_END = ARROWHEAD_SIZE;
const LABEL_STEP = 16;

type Dir = 0 | 1 | 2 | 3;
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;
const [RIGHT, DOWN, LEFT, UP] = [0, 1, 2, 3] as const;
const reverse = (d: Dir) => ((d + 2) % 4) as Dir;

type Obstacle = { id: string; rect: Rect; cost: number };
/** An axis-aligned stretch of a route: `at` is its fixed coordinate. */
type Run = { id: string; horizontal: boolean; at: number; lo: number; hi: number };
type Port = { x: number; y: number; dir: Dir; cost: number };

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });
const around = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const snap = (n: number) => Math.round(n * 2) / 2;

function runCrosses(run: Omit<Run, "id">, r: Rect): boolean {
  return run.horizontal
    ? r.y < run.at && run.at < r.y + r.h && Math.max(run.lo, r.x) < Math.min(run.hi, r.x + r.w)
    : r.x < run.at && run.at < r.x + r.w && Math.max(run.lo, r.y) < Math.min(run.hi, r.y + r.h);
}

function runsOf(id: string, points: Point[]): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i]!;
    const q = points[i + 1]!;
    if (Math.abs(p.y - q.y) < 0.5 && Math.abs(p.x - q.x) >= 0.5)
      runs.push({ id, horizontal: true, at: p.y, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) });
    else if (Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) >= 0.5)
      runs.push({ id, horizontal: false, at: p.x, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y) });
  }
  return runs;
}

/** What laying a run costs on top of its length: boxes and text it enters, lines it rides or crosses. */
function penalty(run: Omit<Run, "id">, obstacles: Obstacle[], used: Run[]): number {
  let cost = 0;
  for (const o of obstacles) if (runCrosses(run, o.rect)) cost += o.cost;
  for (const u of used) {
    if (u.horizontal === run.horizontal) {
      const apart = Math.abs(u.at - run.at);
      if (apart >= NEAR_TOL) continue;
      const overlap = Math.min(u.hi, run.hi) - Math.max(u.lo, run.lo);
      if (overlap <= 1) continue;
      cost += apart < SHARE_TOL ? SHARE_BASE + SHARE_PX * overlap : overlap;
    } else if (u.at >= run.lo && u.at < run.hi && run.at >= u.lo && run.at <= u.hi) cost += CROSS;
  }
  return cost;
}

function portsOf(r: Rect, other: Rect): Port[] {
  const along = (lo: number, len: number, otherLo: number, otherLen: number) => {
    const spots = [
      { at: lo + len / 2, cost: 0 },
      { at: lo + len / 4, cost: PORT_OFF },
      { at: lo + (len * 3) / 4, cost: PORT_OFF },
    ];
    const from = Math.max(lo, otherLo);
    const to = Math.min(lo + len, otherLo + otherLen);
    if (to - from > 1) spots.push({ at: (from + to) / 2, cost: 0 });
    return spots.map((spot) => ({ at: snap(spot.at), cost: spot.cost }));
  };
  const ports: Port[] = [];
  for (const { at, cost } of along(r.x, r.w, other.x, other.w)) {
    ports.push({ x: at, y: r.y, dir: UP, cost });
    ports.push({ x: at, y: r.y + r.h, dir: DOWN, cost });
  }
  for (const { at, cost } of along(r.y, r.h, other.y, other.h)) {
    ports.push({ x: r.x, y: at, dir: LEFT, cost });
    ports.push({ x: r.x + r.w, y: at, dir: RIGHT, cost });
  }
  return ports;
}

class Heap {
  private f: number[] = [];
  private s: number[] = [];
  get size() {
    return this.f.length;
  }
  peek() {
    return this.f[0]!;
  }
  push(f: number, s: number) {
    const fs = this.f;
    const ss = this.s;
    let i = fs.length;
    fs.push(f);
    ss.push(s);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fs[p]! <= f) break;
      fs[i] = fs[p]!;
      ss[i] = ss[p]!;
      i = p;
    }
    fs[i] = f;
    ss[i] = s;
  }
  pop(): number {
    const fs = this.f;
    const ss = this.s;
    const top = ss[0]!;
    const lastF = fs.pop()!;
    const lastS = ss.pop()!;
    if (fs.length > 0) {
      let i = 0;
      const n = fs.length;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const c = l + 1 < n && fs[l + 1]! < fs[l]! ? l + 1 : l;
        if (fs[c]! >= lastF) break;
        fs[i] = fs[c]!;
        ss[i] = ss[c]!;
        i = c;
      }
      fs[i] = lastF;
      ss[i] = lastS;
    }
    return top;
  }
}

function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last !== undefined && Math.abs(last.x - p.x) + Math.abs(last.y - p.y) < 0.5) continue;
    const prev = out[out.length - 2];
    if (prev !== undefined && last !== undefined) {
      const straight = (prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y);
      if (straight) out.pop();
    }
    out.push(p);
  }
  return out.length >= 2 ? out : [points[0]!, points[points.length - 1]!];
}

/** Cheapest right-angle route between two boxes over a grid of lanes through the gaps
 * (orthogonal connector routing, as in libavoid). Entering a box or text, or riding a line
 * already taken, costs so much that it only happens when nothing else gets through. */
function routeBetween(a: Rect, b: Rect, others: Obstacle[], used: Run[]): Point[] {
  const obstacles = [{ id: "", rect: a, cost: BOX_HIT }, { id: "", rect: b, cost: BOX_HIT }, ...others];
  const xKind = new Map<number, number>();
  const yKind = new Map<number, number>();
  const put = (m: Map<number, number>, v: number, kind: number) => {
    const key = snap(v);
    const was = m.get(key);
    if (was === undefined || kind < was) m.set(key, kind);
  };
  const rects = obstacles.map((o) => o.rect);
  const lanes = (m: Map<number, number>, edges: number[]) => {
    const sorted = [...new Set(edges)].sort((p, q) => p - q);
    put(m, sorted[0]! - FRAME, 1);
    put(m, sorted[sorted.length - 1]! + FRAME, 1);
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1]! - sorted[i]!;
      const mid = (sorted[i]! + sorted[i + 1]!) / 2;
      if (gap >= CLEAR * 2) put(m, mid, 0);
      if (gap >= (CLEAR + LANE) * 2) {
        put(m, mid - LANE, 1);
        put(m, mid + LANE, 1);
      }
    }
  };
  for (const r of rects) {
    put(xKind, r.x - CLEAR, 2);
    put(xKind, r.x + r.w + CLEAR, 2);
    put(yKind, r.y - CLEAR, 2);
    put(yKind, r.y + r.h + CLEAR, 2);
  }
  lanes(
    xKind,
    rects.flatMap((r) => [r.x, r.x + r.w]),
  );
  lanes(
    yKind,
    rects.flatMap((r) => [r.y, r.y + r.h]),
  );
  const starts = portsOf(a, b);
  const ends = portsOf(b, a);
  for (const p of [...starts, ...ends]) {
    if (p.dir === UP || p.dir === DOWN) put(xKind, p.x, 0);
    else put(yKind, p.y, 0);
  }
  const xs = [...xKind.keys()].sort((p, q) => p - q);
  const ys = [...yKind.keys()].sort((p, q) => p - q);
  const xk = xs.map((x) => xKind.get(x)!);
  const yk = ys.map((y) => yKind.get(y)!);
  const nx = xs.length;
  const ny = ys.length;
  const xIndex = new Map(xs.map((x, i) => [x, i]));
  const yIndex = new Map(ys.map((y, i) => [y, i]));

  /** The first grid node straight out from a port. */
  const approach = (p: Port): number | null => {
    if (p.dir === UP || p.dir === DOWN) {
      const i = xIndex.get(p.x)!;
      let j = -1;
      if (p.dir === UP)
        for (let k = ny - 1; k >= 0; k--)
          if (ys[k]! < p.y - 0.25) {
            j = k;
            break;
          }
      if (p.dir === DOWN)
        for (let k = 0; k < ny; k++)
          if (ys[k]! > p.y + 0.25) {
            j = k;
            break;
          }
      return j < 0 ? null : j * nx + i;
    }
    const j = yIndex.get(p.y)!;
    let i = -1;
    if (p.dir === LEFT)
      for (let k = nx - 1; k >= 0; k--)
        if (xs[k]! < p.x - 0.25) {
          i = k;
          break;
        }
    if (p.dir === RIGHT)
      for (let k = 0; k < nx; k++)
        if (xs[k]! > p.x + 0.25) {
          i = k;
          break;
        }
    return i < 0 ? null : j * nx + i;
  };
  const stubCost = (p: Port, node: number) => {
    const x = xs[node % nx]!;
    const y = ys[Math.floor(node / nx)]!;
    const run =
      p.dir === UP || p.dir === DOWN
        ? { horizontal: false, at: x, lo: Math.min(y, p.y), hi: Math.max(y, p.y) }
        : { horizontal: true, at: y, lo: Math.min(x, p.x), hi: Math.max(x, p.x) };
    return run.hi - run.lo + penalty(run, obstacles, used) + p.cost;
  };

  const hCost = new Float64Array((nx - 1) * ny).fill(NaN);
  const vCost = new Float64Array(nx * (ny - 1)).fill(NaN);
  const edgeCost = (i: number, j: number, d: Dir): number => {
    if (d === RIGHT || d === LEFT) {
      const lo = d === RIGHT ? i : i - 1;
      const k = j * (nx - 1) + lo;
      if (Number.isNaN(hCost[k]!)) {
        const run = { horizontal: true, at: ys[j]!, lo: xs[lo]!, hi: xs[lo + 1]! };
        hCost[k] = (run.hi - run.lo) * (1 + KIND_COST[yk[j]!]!) + penalty(run, obstacles, used);
      }
      return hCost[k]!;
    }
    const lo = d === DOWN ? j : j - 1;
    const k = lo * nx + i;
    if (Number.isNaN(vCost[k]!)) {
      const run = { horizontal: false, at: xs[i]!, lo: ys[lo]!, hi: ys[lo + 1]! };
      vCost[k] = (run.hi - run.lo) * (1 + KIND_COST[xk[i]!]!) + penalty(run, obstacles, used);
    }
    return vCost[k]!;
  };

  const goals = new Map<number, Array<{ port: Port; cost: number }>>();
  for (const port of ends) {
    const node = approach(port);
    if (node === null) continue;
    const list = goals.get(node) ?? [];
    list.push({ port, cost: stubCost(port, node) });
    goals.set(node, list);
  }
  const h = (node: number) => {
    const x = xs[node % nx]!;
    const y = ys[Math.floor(node / nx)]!;
    let best = Infinity;
    for (const p of ends) best = Math.min(best, Math.abs(p.x - x) + Math.abs(p.y - y));
    return best;
  };

  const g = new Float64Array(nx * ny * 4).fill(Infinity);
  const parent = new Int32Array(nx * ny * 4).fill(-1);
  const startOf = new Map<number, Port>();
  const heap = new Heap();
  for (const port of starts) {
    const node = approach(port);
    if (node === null) continue;
    const s = node * 4 + port.dir;
    const cost = stubCost(port, node);
    if (cost < g[s]!) {
      g[s] = cost;
      startOf.set(s, port);
      heap.push(cost + h(node), s);
    }
  }
  let best = Infinity;
  let bestState = -1;
  let bestPort: Port | null = null;
  while (heap.size > 0 && heap.peek() < best) {
    const s = heap.pop();
    const node = s >> 2;
    const d = (s & 3) as Dir;
    const here = g[s]!;
    for (const goal of goals.get(node) ?? []) {
      const inward = reverse(goal.port.dir);
      if (d === goal.port.dir) continue;
      const total = here + goal.cost + (d === inward ? 0 : BEND);
      if (total < best) {
        best = total;
        bestState = s;
        bestPort = goal.port;
      }
    }
    const i = node % nx;
    const j = (node - i) / nx;
    for (const nd of [d, ((d + 1) % 4) as Dir, ((d + 3) % 4) as Dir]) {
      const ni = i + DX[nd];
      const nj = j + DY[nd];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const next = (nj * nx + ni) * 4 + nd;
      const cost = here + edgeCost(i, j, nd) + (nd === d ? 0 : BEND);
      if (cost < g[next]!) {
        g[next] = cost;
        parent[next] = s;
        heap.push(cost + h(next >> 2), next);
      }
    }
  }
  if (bestPort === null) {
    const from = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const to = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    return [clipToBox(a, from, to), clipToBox(b, to, from)];
  }
  const nodes: Point[] = [];
  let s = bestState;
  let first = s;
  while (s >= 0) {
    const node = s >> 2;
    nodes.push({ x: xs[node % nx]!, y: ys[Math.floor(node / nx)]! });
    first = s;
    s = parent[s]!;
  }
  nodes.reverse();
  const start = startOf.get(first)!;
  return simplify([{ x: start.x, y: start.y }, ...nodes, { x: bestPort.x, y: bestPort.y }]);
}

function clipToBox(rect: Rect, from: Point, toward: Point): Point {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const sx = dx === 0 ? Infinity : rect.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : rect.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: from.x + dx * s, y: from.y + dy * s };
}

/** Whether segment p-q passes through the open inside of r (Liang–Barsky). */
function segmentEnters(p: Point, q: Point, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const edges: Array<[number, number]> = [
    [-dx, p.x - r.x],
    [dx, r.x + r.w - p.x],
    [-dy, p.y - r.y],
    [dy, r.y + r.h - p.y],
  ];
  for (const [step, room] of edges) {
    if (step === 0) {
      if (room <= 0) return false;
      continue;
    }
    const t = room / step;
    if (step < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return (t1 - t0) * Math.hypot(dx, dy) > 0.5;
}

function pathEnters(points: Point[], r: Rect): boolean {
  for (let i = 0; i < points.length - 1; i++) if (segmentEnters(points[i]!, points[i + 1]!, r)) return true;
  return false;
}

const cache = new WeakMap<readonly Element[], Layout>();

/** Routes, label spots, and the overlaps a person would see, worked out once per drawing. */
export function layoutOf(elements: readonly Element[]): Layout {
  const hit = cache.get(elements);
  if (hit !== undefined) return hit;
  const boxes = elements.filter((e): e is Box => e.type === "box");
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  const texts = elements.flatMap((e) =>
    e.type === "text" ? [{ id: e.id, rect: textBounds(e.x, e.y, e.text), ink: textInk(e.x, e.y, e.text) }] : [],
  );
  const arrows = elements.filter((e): e is Arrow => e.type === "arrow");
  const obstacles: Obstacle[] = [
    ...boxes.map((box) => ({ id: box.id, rect: box as Rect, cost: BOX_HIT })),
    ...texts.map((text) => ({ id: text.id, rect: inflate(text.rect, LABEL_CLEAR), cost: TEXT_HIT })),
  ];
  const routes = new Map<string, Point[]>();

  /** Boxes that hold an end, and whatever an end holds, are not in the way. */
  const outOfTheWay = (ends: Rect[]) => (o: Obstacle) =>
    ends.some((end) => end === o.rect || (contains(o.rect, end) && o.rect !== end) || contains(end, o.rect));

  const routeOne = (arrow: ArrowLike, used: Run[]): Point[] => {
    const a = arrow.from === undefined ? undefined : boxById.get(arrow.from);
    const b = arrow.to === undefined ? undefined : boxById.get(arrow.to);
    if (a === undefined || b === undefined) {
      const start = a ? { x: a.x + a.w / 2, y: a.y + a.h / 2 } : { x: arrow.x1, y: arrow.y1 };
      const end = b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: arrow.x2, y: arrow.y2 };
      return [a ? clipToBox(a, start, end) : start, b ? clipToBox(b, end, start) : end];
    }
    const skip = outOfTheWay([a, b]);
    const relevant = obstacles.filter((o) => o.rect !== a && o.rect !== b && !skip(o));
    const near = inflate(around(a, b), REACH);
    const local = relevant.filter((o) => intersects(o.rect, near));
    const path = routeBetween(a, b, local, used);
    const missed = relevant.some((o) => !local.includes(o) && o.cost === BOX_HIT && pathEnters(path, o.rect));
    return missed ? routeBetween(a, b, relevant, used) : path;
  };

  // Free arrows are fixed where they were drawn, so bound arrows route around them. The second
  // pass reroutes each bound arrow against every other route, so the first one drawn does not
  // take the line a later one needs.
  const bound = (arrow: Arrow) =>
    arrow.from !== undefined && arrow.to !== undefined && boxById.has(arrow.from) && boxById.has(arrow.to);
  const runs = new Map<string, Run[]>();
  const others = (id: string) => [...runs].flatMap(([other, list]) => (other === id ? [] : list));
  const lay = (arrow: Arrow) => {
    const path = routeOne(arrow, others(arrow.id));
    routes.set(arrow.id, path);
    runs.set(arrow.id, runsOf(arrow.id, path));
  };
  for (const arrow of arrows.filter((a) => !bound(a))) lay(arrow);
  for (const arrow of arrows.filter(bound)) lay(arrow);
  for (const arrow of arrows.filter(bound)) lay(arrow);
  const used = [...runs.values()].flat();

  const notes: Note[] = [];
  const note = (ids: string[], text: string) => notes.push({ ids, text });

  for (const box of boxes) {
    if (box.label !== undefined && box.label !== "" && boxHeightForLabel(box.w, box.label) > box.h + 0.5)
      note([box.id], `${box.id} label clipped`);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (intersects(a, b) && !contains(a, b) && !contains(b, a)) note([a.id, b.id], `${a.id} overlaps ${b.id}`);
    }
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]!;
      const b = texts[j]!;
      if (intersects(a.ink, b.ink)) note([a.id, b.id], `${a.id} overlaps ${b.id}`);
    }
  }
  for (const text of texts) {
    for (const box of boxes) {
      if (!intersects(text.ink, box)) continue;
      if (!contains(box, text.ink)) {
        note([text.id, box.id], `${text.id} overlaps ${box.id}`);
        continue;
      }
      const label = boxLabelRect(box);
      if (label !== null && intersects(text.ink, label)) note([text.id, box.id], `${text.id} covers ${box.id}'s label`);
    }
  }
  for (const arrow of arrows) {
    const path = routes.get(arrow.id)!;
    const ends = [arrow.from, arrow.to].flatMap((id) => {
      const box = id === undefined ? undefined : boxById.get(id);
      return box === undefined ? [] : [box as Rect];
    });
    const tips = [path[0]!, path[path.length - 1]!];
    for (const box of boxes) {
      if (ends.includes(box) || ends.some((end) => contains(box, end))) continue;
      if (tips.some((tip) => tip.x > box.x && tip.x < box.x + box.w && tip.y > box.y && tip.y < box.y + box.h)) continue;
      if (pathEnters(path, inflate(box, -2))) note([arrow.id, box.id], `${arrow.id} runs through ${box.id}`);
    }
    for (const text of texts) if (pathEnters(path, text.ink)) note([arrow.id, text.id], `${arrow.id} runs through ${text.id}`);
  }
  for (let i = 0; i < arrows.length; i++) {
    for (let j = i + 1; j < arrows.length; j++) {
      const a = arrows[i]!.id;
      const b = arrows[j]!.id;
      const shared = runs
        .get(a)!
        .some((p) =>
          runs
            .get(b)!
            .some(
              (q) =>
                p.horizontal === q.horizontal &&
                Math.abs(p.at - q.at) < SHARE_TOL &&
                Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo) > 4,
            ),
        );
      if (shared) note([a, b], `${a} and ${b} share a line`);
    }
  }

  const labels = new Map<string, Rect>();
  const placed: Rect[] = [];
  const blockers = [...boxes.map((box) => inflate(box, LABEL_CLEAR)), ...texts.map((text) => inflate(text.ink, LABEL_CLEAR))];
  for (const arrow of arrows) {
    if (arrow.label === undefined || arrow.label === "") continue;
    const path = routes.get(arrow.id)!;
    const w = textWidth(arrow.label, ARROW_FONT) + LABEL_PAD;
    const heads = arrow.heads ?? "end";
    const headAtStart = heads === "start" || heads === "both";
    const headAtEnd = heads === "end" || heads === "both";
    const segments = path.slice(0, -1).map((p, i) => ({ p, q: path[i + 1]!, i }));
    segments.sort((s, t) => Math.hypot(t.q.x - t.p.x, t.q.y - t.p.y) - Math.hypot(s.q.x - s.p.x, s.q.y - s.p.y));
    let clean: Rect | null = null;
    let covering: { rect: Rect; over: string } | null = null;
    for (const { p, q, i } of segments) {
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      const horizontal = Math.abs(q.x - p.x) >= Math.abs(q.y - p.y);
      const startRoom = i === 0 && headAtStart ? LABEL_HEAD_END : LABEL_END;
      const endRoom = i === path.length - 2 && headAtEnd ? LABEL_HEAD_END : LABEL_END;
      const span = horizontal ? w : LABEL_H;
      const slack = length - span - startRoom - endRoom;
      if (slack < 0) continue;
      const centre = startRoom + span / 2 + slack / 2;
      const offsets = [0];
      for (let k = LABEL_STEP; k <= slack / 2; k += LABEL_STEP) offsets.push(-k, k);
      for (const offset of offsets) {
        const t = (centre + offset) / length;
        const at = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
        const rect = { x: at.x - w / 2, y: at.y - LABEL_H / 2, w, h: LABEL_H };
        if (blockers.some((b) => intersects(rect, b)) || placed.some((b) => intersects(rect, inflate(b, LABEL_CLEAR)))) continue;
        const over = arrows.find((other) => other.id !== arrow.id && runs.get(other.id)!.some((run) => runCrosses(run, rect)));
        if (over === undefined) {
          clean = rect;
          break;
        }
        covering ??= { rect, over: over.id };
      }
      if (clean !== null) break;
    }
    const chosen = clean ?? covering?.rect ?? null;
    if (chosen === null) {
      const need = Math.ceil(w + LABEL_END + (headAtEnd || headAtStart ? LABEL_HEAD_END : LABEL_END));
      note([arrow.id], `${arrow.id} label ${JSON.stringify(arrow.label)} hidden: needs ${need}px of clear line`);
      continue;
    }
    if (clean === null && covering !== null) note([arrow.id, covering.over], `${arrow.id} label covers ${covering.over}`);
    labels.set(arrow.id, chosen);
    placed.push(chosen);
  }

  const members = new WeakSet<Element>(elements);
  const layout: Layout = {
    routes,
    labels,
    notes,
    route: (arrow) => routeOne(arrow, used),
    owns: (element) => members.has(element),
  };
  cache.set(elements, layout);
  return layout;
}
