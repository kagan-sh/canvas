import type { Rect } from "./layout.ts";

const PAD = 32;

// The drawing as a self-contained SVG: cropped to its content, with the theme's CSS variables
// written in as colors and the font embedded, so it renders the same outside bb.
export function standaloneSvg(inner: string, bounds: Rect, resolve: (name: string) => string, background: string, fontCss: string): string {
  const x = bounds.x - PAD;
  const y = bounds.y - PAD;
  const w = bounds.w + PAD * 2;
  const h = bounds.h + PAD * 2;
  const body = inner.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_match, name: string, fallback?: string) => resolve(name) || fallback?.trim() || "currentColor");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">`
    + `<style>${fontCss}</style><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${background}"/>${body}</svg>`;
}
