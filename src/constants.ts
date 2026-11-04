/** The canvas is unbounded; this is only the area the panel shows at 100%. */
export const DEFAULT_VIEW_WIDTH = 1600;
export const DEFAULT_VIEW_HEIGHT = 1200;
/** A sane world limit, so a bad number cannot break the view. */
export const WORLD_LIMIT = 1_000_000;
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 30;

export const COLORS = ["default", "red", "green", "yellow", "blue", "magenta", "cyan", "gray"] as const;
export type Color = (typeof COLORS)[number];

export type Theme = "light" | "dark";

/** Excalidraw's stroke palette. Dark values are what Excalidraw paints after its dark-mode filter. */
export const COLOR_CSS: Record<Theme, Record<Color, string>> = {
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

/** Excalidraw's element defaults: "artist" sloppiness, medium stroke, its arrowhead. */
export const ROUGHNESS = 1;
export const STROKE_WIDTH = 2;
export const ARROWHEAD_SIZE = 25;
export const ARROWHEAD_ANGLE = 20;

export const CANVAS_CHANGED = "canvas-changed";

/** Type that fits inside a box instead of spilling out of it. */
export const LABEL_FONT = 18;
export const ARROW_FONT = 16;
export const LINE_H = 20;
export const BOX_PAD = 12;
export const TEXT_MAX_W = 640;
export const FONT_FAMILY = "Nunito, 'Segoe UI Emoji', ui-sans-serif, system-ui";
