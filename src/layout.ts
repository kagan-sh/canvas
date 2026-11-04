import { BOX_PAD, LABEL_FONT, LINE_H, TEXT_MAX_W } from "./constants.ts";
import { advance, ASCENT, DESCENT, INK_BOTTOM, INK_TOP } from "./fonts/metrics.ts";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Rendered width in Nunito at `size` px, from the font's own advance widths. */
export function textWidth(text: string, size: number): number {
  let units = 0;
  for (const char of text) units += advance(char);
  return (units / 1000) * size;
}

/** Word-wrap to maxWidth. Newlines stay. A word wider than the line is split. */
export function wrapLines(text: string, maxWidth: number, size: number): string[] {
  const fits = (line: string) => textWidth(line, size) <= maxWidth;
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = current === "" ? word : `${current} ${word}`;
      if (fits(next)) {
        current = next;
        continue;
      }
      if (current !== "") lines.push(current);
      current = "";
      for (const char of word) {
        if (current !== "" && !fits(current + char)) {
          lines.push(current);
          current = "";
        }
        current += char;
      }
    }
    if (current !== "") lines.push(current);
  }
  return lines.length === 0 ? [""] : lines;
}

export function boxLabelLines(label: string, w: number): string[] {
  return wrapLines(label, Math.max(LABEL_FONT, w - BOX_PAD * 2), LABEL_FONT);
}

/** Lines that fit inside the box. Lines past its height are dropped. */
export function visibleBoxLines(label: string, w: number, h: number): string[] {
  const lines = boxLabelLines(label, w);
  const maxLines = Math.max(1, Math.floor((h - BOX_PAD * 2) / LINE_H));
  return lines.slice(0, maxLines);
}

export function boxHeightForLabel(w: number, label: string | undefined): number {
  if (label === undefined || label === "") return 0;
  return BOX_PAD * 2 + boxLabelLines(label, w).length * LINE_H;
}

/** Where a box's label ink sits, centred as the panel draws it. */
export function boxLabelRect(box: Rect & { label?: string }): Rect | null {
  if (box.label === undefined || box.label === "") return null;
  const lines = visibleBoxLines(box.label, box.w, box.h);
  const w = Math.max(...lines.map((line) => textWidth(line, LABEL_FONT)));
  const h = (lines.length - 1) * LINE_H + LABEL_FONT * (INK_TOP + INK_BOTTOM);
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

export function textLines(text: string): string[] {
  return wrapLines(text, TEXT_MAX_W, LABEL_FONT);
}

/** The ink of a text element: `y` is the first line's baseline. */
export function textBounds(x: number, y: number, text: string): Rect {
  const lines = textLines(text);
  const width = Math.max(...lines.map((line) => textWidth(line, LABEL_FONT)), LABEL_FONT / 2);
  return {
    x,
    y: y - LABEL_FONT * ASCENT,
    w: width,
    h: LABEL_FONT * (ASCENT + DESCENT) + (lines.length - 1) * LINE_H,
  };
}

/** The inked part of textBounds. Collision checks use this, since that is what a person sees. */
export function textInk(x: number, y: number, text: string): Rect {
  const bounds = textBounds(x, y, text);
  const top = y - LABEL_FONT * INK_TOP;
  return { x, y: top, w: bounds.w, h: (textLines(text).length - 1) * LINE_H + LABEL_FONT * (INK_TOP + INK_BOTTOM) };
}

export function longestSegment(points: Point[]): { mid: Point; length: number; horizontal: boolean } {
  let best = { mid: points[0] ?? { x: 0, y: 0 }, length: 0, horizontal: true };
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length > best.length)
      best = { mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, length, horizontal: Math.abs(dx) >= Math.abs(dy) };
  }
  return best;
}
