import { NUNITO_URL } from "./fonts/nunito.ts";

const ISLAND_SHADOW =
  "0 0 1px 0 rgba(0, 0, 0, 0.17), 0 0 3px 0 rgba(0, 0, 0, 0.08), 0 7px 14px 0 rgba(0, 0, 0, 0.05)";

/** Excalidraw's UI, restated for the panel. Colors come from THEME_VARS on `.ex-root`. */
export const CANVAS_CSS = `
@font-face { font-family: "Nunito"; src: url(${NUNITO_URL}) format("woff2"); font-weight: 500; font-display: swap; }
.ex-root { color: var(--ex-text); background: var(--ex-canvas); font-size: 14px; }
.ex-root button { font: inherit; }
.ex-root button:focus-visible, .ex-root select:focus-visible { outline: 2px solid var(--ex-primary); outline-offset: 1px; }
.ex-island { background: var(--ex-island); border-radius: 8px; box-shadow: ${ISLAND_SHADOW}; }
.ex-toolbar { gap: 2px; }
.ex-root svg text { font-weight: 500; }
.ex-tool, .ex-square {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; flex: none; border: 0; border-radius: 8px; padding: 0;
  color: var(--ex-text); background: transparent; cursor: pointer;
}
.ex-tool:hover { background: var(--ex-hover); }
.ex-tool[aria-pressed="true"] { background: var(--ex-primary-light); color: var(--ex-on-primary-container); }
.ex-key { position: absolute; right: 3px; bottom: 1px; font-size: 10px; line-height: 1; color: var(--ex-muted); }
.ex-tool[aria-pressed="true"] .ex-key { color: var(--ex-on-primary-container); }
.ex-divider { width: 1px; height: 24px; margin: 0 4px; background: var(--ex-surface-low); flex: none; }
.ex-square { background: var(--ex-surface-low); }
.ex-square:hover { background: var(--ex-hover); }
.ex-square:disabled { cursor: default; color: var(--ex-hint); }
.ex-group { display: inline-flex; align-items: center; height: 36px; border-radius: 8px; background: var(--ex-surface-low); }
.ex-group .ex-square { background: transparent; }
.ex-group .ex-square:hover { background: var(--ex-hover); }
.ex-zoom { min-width: 60px; height: 36px; border: 0; background: transparent; color: var(--ex-text); cursor: pointer; font-size: 14px; }
.ex-panel h3 { margin: 0 0 4px; font-size: 12px; font-weight: 400; color: var(--ex-text); }
.ex-panel section + section { margin-top: 0; }
.ex-swatch { width: 22px; height: 22px; flex: none; border: 0; border-radius: 4px; padding: 0; cursor: pointer; }
.ex-swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--ex-island), 0 0 0 3px var(--ex-primary); }
.ex-swatch-current { width: 28px; height: 28px; border-radius: 6px; }
.ex-option {
  display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
  border: 0; border-radius: 8px; padding: 0; cursor: pointer; color: var(--ex-text); background: var(--ex-surface-low);
}
.ex-option:hover { background: var(--ex-hover); }
.ex-option[aria-pressed="true"] { background: var(--ex-primary-light); color: var(--ex-on-primary-container); }
.ex-menu-item {
  display: flex; align-items: center; gap: 10px; width: 100%; height: 32px; padding: 0 8px;
  border: 0; border-radius: 6px; background: transparent; color: var(--ex-text); cursor: pointer; text-align: left;
}
.ex-menu-item:hover { background: var(--ex-hover); }
.ex-menu-item[aria-current="true"] { color: var(--ex-primary); font-weight: 600; }
.ex-menu-label { padding: 4px 8px; font-size: 12px; color: var(--ex-muted); }
.ex-menu-sep { height: 1px; margin: 6px 4px; background: var(--ex-surface-low); }
.ex-shortcut { margin-left: auto; font-size: 12px; color: var(--ex-muted); }
.ex-input { min-width: 0; flex: 1; height: 32px; padding: 0 8px; border: 0; outline: 0; background: transparent; color: var(--ex-text); font-size: 14px; }
.ex-input::placeholder { color: var(--ex-muted); }
.ex-select {
  width: 100%; max-width: 100%; min-width: 0; height: 32px; padding: 0 6px; border: 0; border-radius: 8px;
  background: var(--ex-surface-low); color: var(--ex-text); font-size: 13px;
}
.ex-send .ex-input { flex: 1 1 150px; }
.ex-send .ex-select { flex: 1 1 100%; }
.ex-primary {
  height: 32px; padding: 0 12px; border: 0; border-radius: 8px; flex: none;
  background: var(--ex-primary); color: var(--ex-canvas); font-weight: 600; cursor: pointer;
}
.ex-primary:hover { background: var(--ex-primary-darker); }
.ex-primary:disabled { opacity: 0.5; cursor: default; }
.ex-pill { height: 32px; padding: 0 14px; border: 0; border-radius: 8px; color: var(--ex-primary); cursor: pointer; }
.ex-hint { font-size: 12px; color: var(--ex-muted); text-align: center; }
.ex-editor {
  position: absolute; z-index: 10; margin: 0; padding: 0; border: 0; outline: 0; resize: none; overflow: hidden;
  background: transparent; white-space: pre; font-family: Nunito, ui-sans-serif, system-ui; font-weight: 500;
}
.ex-root svg { -webkit-touch-callout: none; }
.ex-narrow .ex-key, .ex-narrow .ex-shortcut { display: none; }
.ex-narrow .ex-tool, .ex-narrow .ex-square, .ex-narrow .ex-zoom, .ex-narrow .ex-option, .ex-narrow .ex-group, .ex-narrow .ex-pill { height: 44px; }
.ex-narrow .ex-tool, .ex-narrow .ex-square, .ex-narrow .ex-option { width: 44px; }
.ex-narrow .ex-menu-item { height: 44px; }
.ex-narrow .ex-swatch { width: 28px; height: 28px; }
.ex-narrow .ex-swatch-current { width: 36px; height: 36px; }
.ex-narrow .ex-input, .ex-narrow .ex-select, .ex-narrow .ex-primary { height: 40px; font-size: 16px; }
`;
