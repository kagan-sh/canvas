import { MAX_SCALE, MIN_SCALE } from "./constants.ts";

/** Below this panel width the chrome stacks and touch targets grow. Phones in both orientations sit under it. */
export const NARROW_CANVAS = 720;

export type CanvasView = { x: number; y: number; scale: number };
export type ScreenPoint = { x: number; y: number };
export type PinchStart = { view: CanvasView; a: ScreenPoint; b: ScreenPoint };

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export type FrameInset = { top: number; right: number; bottom: number; left: number };
export const NO_INSET: FrameInset = { top: 0, right: 0, bottom: 0, left: 0 };
/** Menu, tool row, zoom, and the one-line send bar. The fit keeps the drawing in the clear band between them. */
export const PHONE_CHROME: FrameInset = { top: 112, right: 12, bottom: 112, left: 12 };

/** The view that puts `bounds` on screen, inside `inset`, with room around it, never past 100%. `floor` stops a huge drawing opening unreadably small. */
export function fitView(
  bounds: { x: number; y: number; w: number; h: number } | null,
  width: number,
  height: number,
  inset: FrameInset = NO_INSET,
  floor = MIN_SCALE,
): CanvasView {
  const viewW = Math.max(1, width - inset.left - inset.right);
  const viewH = Math.max(1, height - inset.top - inset.bottom);
  const cx = inset.left + viewW / 2;
  const cy = inset.top + viewH / 2;
  if (bounds === null || bounds.w + bounds.h === 0) return { x: -cx, y: -cy, scale: 1 };
  const pad = 80;
  const scale = clampScale(Math.max(floor, Math.min(1, viewW / (bounds.w + pad * 2), viewH / (bounds.h + pad * 2))));
  return {
    scale,
    x: bounds.x + bounds.w / 2 - cx / scale,
    y: bounds.y + bounds.h / 2 - cy / scale,
  };
}

/**
 * The view after a two-finger gesture. `start` is the view and the two fingers
 * when the pinch began; `a` and `b` are where those fingers are now, in the same
 * screen space. The world point under the original midpoint stays under the new one.
 */
export function pinchView(start: PinchStart, a: ScreenPoint, b: ScreenPoint): CanvasView {
  const startDist = Math.hypot(start.b.x - start.a.x, start.b.y - start.a.y);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const scale = clampScale(startDist < 1 || dist < 1 ? start.view.scale : start.view.scale * (dist / startDist));
  const mid0x = (start.a.x + start.b.x) / 2;
  const mid0y = (start.a.y + start.b.y) / 2;
  const midx = (a.x + b.x) / 2;
  const midy = (a.y + b.y) / 2;
  const worldX = start.view.x + mid0x / start.view.scale;
  const worldY = start.view.y + mid0y / start.view.scale;
  return { scale, x: worldX - midx / scale, y: worldY - midy / scale };
}
