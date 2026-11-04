import rough from "roughjs";
import type { Options } from "roughjs/bin/core";
import getStroke from "perfect-freehand";

import { ARROWHEAD_ANGLE, ARROWHEAD_SIZE, ROUGHNESS, STROKE_WIDTH } from "../constants.ts";
import type { Point } from "../layout.ts";

/** One stroke of a hand-drawn shape. `fill` is set only for the filled pen outline. */
export type SketchPath = { d: string; fill?: string; stroke?: string; strokeWidth?: number };

const generator = rough.generator();

/** A stable seed per element id, so a shape keeps its wobble across renders and reloads. */
export function seedOf(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0) % 2 ** 31 || 1;
}

/** Excalidraw calms the wobble on small shapes so they do not dissolve into scribbles. */
function roughnessFor(w: number, h: number, linear: boolean): number {
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  if ((short >= 20 && long >= 50) || (short >= 15 && !linear) || (linear && long >= 50)) return ROUGHNESS;
  return Math.min(ROUGHNESS / (long < 10 ? 3 : 2), 2.5);
}

function options(seed: number, stroke: string, roughness: number): Options {
  return { seed, roughness, stroke, strokeWidth: STROKE_WIDTH, preserveVertices: true, fillWeight: STROKE_WIDTH / 2 };
}

function strokes(drawable: ReturnType<typeof generator.path>): SketchPath[] {
  return generator.toPaths(drawable).map(({ d, stroke, strokeWidth }) => ({ d, stroke, strokeWidth }));
}

/** Excalidraw's adaptive corner: a quarter of the short side, capped at 32. */
function cornerRadius(w: number, h: number): number {
  const short = Math.min(w, h);
  return short <= 128 ? short * 0.25 : 32;
}

/** A rounded box drawn at the origin; the caller translates it. */
export function sketchBox(w: number, h: number, seed: number, stroke: string): SketchPath[] {
  const r = cornerRadius(w, h);
  const d = `M ${r} 0 L ${w - r} 0 Q ${w} 0, ${w} ${r} L ${w} ${h - r} Q ${w} ${h}, ${w - r} ${h} L ${r} ${h} Q 0 ${h}, 0 ${h - r} L 0 ${r} Q 0 0, ${r} 0`;
  return strokes(generator.path(d, options(seed, stroke, roughnessFor(w, h, false))));
}

function span(points: Point[]): { w: number; h: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** The two wings of an open arrowhead at `tip`, pointing away from `from`. */
function arrowhead(tip: Point, from: Point, seed: number, stroke: string): SketchPath[] {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [];
  const size = Math.min(ARROWHEAD_SIZE, length / 2);
  const back = Math.atan2(-dy, -dx);
  const angle = (ARROWHEAD_ANGLE * Math.PI) / 180;
  const wing = (turn: number): [number, number] => [
    tip.x + Math.cos(back + turn) * size,
    tip.y + Math.sin(back + turn) * size,
  ];
  return strokes(generator.linearPath([wing(angle), [tip.x, tip.y], wing(-angle)], options(seed, stroke, roughnessFor(size, size, true))));
}

export function sketchArrow(
  points: Point[],
  heads: "none" | "start" | "end" | "both",
  seed: number,
  stroke: string,
): SketchPath[] {
  if (points.length < 2) return [];
  const { w, h } = span(points);
  const paths = strokes(
    generator.linearPath(
      points.map((p) => [p.x, p.y]),
      options(seed, stroke, roughnessFor(w, h, true)),
    ),
  );
  if (heads === "end" || heads === "both")
    paths.push(...arrowhead(points[points.length - 1]!, points[points.length - 2]!, seed + 1, stroke));
  if (heads === "start" || heads === "both") paths.push(...arrowhead(points[0]!, points[1]!, seed + 2, stroke));
  return paths;
}

/** Pen strokes are filled outlines with simulated pressure, as Excalidraw's freedraw. */
export function sketchFreehand(points: [number, number][], stroke: string, last: boolean): SketchPath {
  const outline = getStroke(points, {
    simulatePressure: true,
    size: STROKE_WIDTH * 4.25,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t) => Math.sin((t * Math.PI) / 2),
    last,
  });
  return { d: outlinePath(outline), fill: stroke };
}

function outlinePath(outline: number[][]): string {
  if (outline.length < 2) return "";
  const mid = (a: number[], b: number[]) => [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2];
  const [first] = outline;
  let d = `M ${first![0]} ${first![1]} Q`;
  for (let i = 0; i < outline.length; i++) {
    const point = outline[i]!;
    const next = outline[(i + 1) % outline.length]!;
    const [mx, my] = mid(point, next);
    d += ` ${point[0]} ${point[1]} ${mx} ${my}`;
  }
  return `${d} Z`;
}
