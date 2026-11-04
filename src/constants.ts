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

/** Excalidraw's UI tokens, read off excalidraw.com. */
export const THEME_VARS: Record<Theme, Record<string, string>> = {
  light: {
    "--ex-canvas": "#ffffff",
    "--ex-island": "#ffffff",
    "--ex-surface-low": "#ececf4",
    "--ex-hover": "#f1f0ff",
    "--ex-primary": "#6965db",
    "--ex-primary-darker": "#5b57d1",
    "--ex-primary-light": "#e3e2fe",
    "--ex-on-primary-container": "#030064",
    "--ex-selection": "#6965db",
    "--ex-text": "#1b1b1f",
    "--ex-muted": "#999999",
    "--ex-hint": "#b8b8b8",
  },
  dark: {
    "--ex-canvas": "#121212",
    "--ex-island": "#232329",
    "--ex-surface-low": "hsl(240, 8%, 15%)",
    "--ex-hover": "#2e2d39",
    "--ex-primary": "#a8a5ff",
    "--ex-primary-darker": "#b2aeff",
    "--ex-primary-light": "#4f4d6f",
    "--ex-on-primary-container": "#e0dfff",
    "--ex-selection": "#b4b0ff",
    "--ex-text": "#e3e3e8",
    "--ex-muted": "#7a7a7a",
    "--ex-hint": "#5c5c5c",
  },
};

/** Excalidraw's element defaults: "artist" sloppiness, medium stroke, its arrowhead. */
export const ROUGHNESS = 1;
export const STROKE_WIDTH = 2;
export const ARROWHEAD_SIZE = 25;
export const ARROWHEAD_ANGLE = 20;

export const CANVAS_CHANGED = "canvas-changed";
/** Another plugin asked a window showing the thread to open its Canvas tab on one canvas. */
export const CANVAS_SHOW = "canvas-show";
export const PANEL_ACTION_ID = "canvas";

/** Type that fits inside a box instead of spilling out of it. */
export const LABEL_FONT = 18;
export const ARROW_FONT = 16;
export const LINE_H = 20;
export const BOX_PAD = 12;
export const TEXT_MAX_W = 640;
export const FONT_FAMILY = "Nunito, 'Segoe UI Emoji', ui-sans-serif, system-ui";
