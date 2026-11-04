import type { ReactNode } from "react";

/** Toolbar and action icons copied from excalidraw.com (MIT). The open lock, check, fit, and arrowhead icons are drawn to match. */
function Svg({ viewBox = "0 0 24 24", strokeWidth, children }: { viewBox?: string; strokeWidth?: number; children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      {children}
    </svg>
  );
}

export const LockOpenIcon = () => (
  <Svg viewBox="0 0 20 20" strokeWidth={1.25}>
    <path d="M13.542 8.542H6.458a2.5 2.5 0 0 0-2.5 2.5v3.75a2.5 2.5 0 0 0 2.5 2.5h7.084a2.5 2.5 0 0 0 2.5-2.5v-3.75a2.5 2.5 0 0 0-2.5-2.5Z" />
    <path d="M10 13.958a1.042 1.042 0 1 0 0-2.083 1.042 1.042 0 0 0 0 2.083Z" />
    <path d="M6.667 8.333V5.417C6.667 3.806 8.159 2.5 10 2.5c1.13 0 2.13.492 2.733 1.245" />
  </Svg>
);

export const LockIcon = () => (
  <Svg viewBox="0 0 20 20" strokeWidth={1.25}>
    <path d="M13.542 8.542H6.458a2.5 2.5 0 0 0-2.5 2.5v3.75a2.5 2.5 0 0 0 2.5 2.5h7.084a2.5 2.5 0 0 0 2.5-2.5v-3.75a2.5 2.5 0 0 0-2.5-2.5Z" />
    <path d="M10 13.958a1.042 1.042 0 1 0 0-2.083 1.042 1.042 0 0 0 0 2.083Z" />
    <path d="M6.667 8.333V5.417C6.667 3.806 8.159 2.5 10 2.5c1.841 0 3.333 1.306 3.333 2.917v2.916" />
  </Svg>
);

export const HandIcon = () => (
  <Svg strokeWidth={1.25}>
    <path d="M8 13v-7.5a1.5 1.5 0 0 1 3 0v6.5" />
    <path d="M11 5.5v-2a1.5 1.5 0 1 1 3 0v8.5" />
    <path d="M14 5.5a1.5 1.5 0 0 1 3 0v6.5" />
    <path d="M17 7.5a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7a69.74 69.74 0 0 1 -.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47" />
  </Svg>
);

export const SelectIcon = () => (
  <Svg viewBox="0 0 22 22" strokeWidth={1.25}>
    <path d="M6 6l4.153 11.793a0.365 .365 0 0 0 .331 .207a0.366 .366 0 0 0 .332 -.207l2.184 -4.793l4.787 -1.994a0.355 .355 0 0 0 .213 -.323a0.355 .355 0 0 0 -.213 -.323l-11.787 -4.36z" />
    <path d="M13.5 13.5l4.5 4.5" />
  </Svg>
);

export const RectangleIcon = () => (
  <Svg strokeWidth={1.5}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </Svg>
);

export const ArrowIcon = () => (
  <Svg strokeWidth={1.5}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <line x1="15" y1="16" x2="19" y2="12" />
    <line x1="15" y1="8" x2="19" y2="12" />
  </Svg>
);

export const LineIcon = () => (
  <Svg viewBox="0 0 20 20" strokeWidth={1.5}>
    <path d="M4.167 10h11.666" />
  </Svg>
);

export const DrawIcon = () => (
  <Svg viewBox="0 0 20 20" strokeWidth={1.25}>
    <path clipRule="evenodd" d="m7.643 15.69 7.774-7.773a2.357 2.357 0 1 0-3.334-3.334L4.31 12.357a3.333 3.333 0 0 0-.977 2.357v1.953h1.953c.884 0 1.732-.352 2.357-.977Z" />
    <path d="m11.25 5.417 3.333 3.333" />
  </Svg>
);

export const TextIcon = () => (
  <Svg strokeWidth={1.5}>
    <line x1="4" y1="20" x2="7" y2="20" />
    <line x1="14" y1="20" x2="21" y2="20" />
    <line x1="6.9" y1="15" x2="13.8" y2="15" />
    <line x1="10.2" y1="6.3" x2="16" y2="20" />
    <polyline points="5 20 11 4 13 4 20 20" />
  </Svg>
);

export const EraserIcon = () => (
  <Svg strokeWidth={1.5}>
    <path d="M19 20h-10.5l-4.21 -4.3a1 1 0 0 1 0 -1.41l10 -10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3" />
    <path d="M18 13.3l-6.3 -6.3" />
  </Svg>
);

export const MenuIcon = () => (
  <Svg strokeWidth={1.5}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </Svg>
);

export const ZoomOutIcon = () => (
  <Svg viewBox="0 0 20 20" strokeWidth={1.25}>
    <path d="M5 10h10" />
  </Svg>
);

export const ZoomInIcon = () => (
  <Svg viewBox="0 0 20 20" strokeWidth={1.25}>
    <path d="M10 4.167v11.666M4.167 10h11.666" />
  </Svg>
);

export const UndoIcon = () => (
  <Svg viewBox="0 0 20 20" strokeWidth={1.25}>
    <path d="M7.5 10.833 4.167 7.5 7.5 4.167M4.167 7.5h9.166a3.333 3.333 0 0 1 0 6.667H12.5" />
  </Svg>
);

export const RedoIcon = () => (
  <Svg viewBox="0 0 20 20" strokeWidth={1.25}>
    <path d="M12.5 10.833 15.833 7.5 12.5 4.167M15.833 7.5H6.667a3.333 3.333 0 1 0 0 6.667H7.5" />
  </Svg>
);

export const DuplicateIcon = () => (
  <Svg viewBox="0 0 20 20" strokeWidth={1.25}>
    <path d="M14.375 6.458H8.958a2.5 2.5 0 0 0-2.5 2.5v5.417a2.5 2.5 0 0 0 2.5 2.5h5.417a2.5 2.5 0 0 0 2.5-2.5V8.958a2.5 2.5 0 0 0-2.5-2.5Z" />
    <path clipRule="evenodd" d="M11.667 3.125c.517 0 .986.21 1.325.55.34.338.55.807.55 1.325v1.458H8.333c-.485 0-.927.185-1.26.487-.343.312-.57.75-.609 1.24l-.005 5.357H5a1.87 1.87 0 0 1-1.326-.55 1.87 1.87 0 0 1-.549-1.325V5c0-.518.21-.987.55-1.326.338-.34.807-.549 1.325-.549h6.667Z" />
  </Svg>
);

export const TrashIcon = () => (
  <Svg viewBox="0 0 20 20" strokeWidth={1.25}>
    <path d="M3.333 5.833h13.334M8.333 9.167v5M11.667 9.167v5M4.167 5.833l.833 10c0 .92.746 1.667 1.667 1.667h6.666c.92 0 1.667-.746 1.667-1.667l.833-10M7.5 5.833v-2.5c0-.46.373-.833.833-.833h3.334c.46 0 .833.373.833.833v2.5" />
  </Svg>
);

export const CheckIcon = () => (
  <Svg strokeWidth={1.5}>
    <path d="M5 12l5 5l10 -10" />
  </Svg>
);

export const FitIcon = () => (
  <Svg strokeWidth={1.5}>
    <path d="M4 8v-2a2 2 0 0 1 2 -2h2" />
    <path d="M4 16v2a2 2 0 0 0 2 2h2" />
    <path d="M16 4h2a2 2 0 0 1 2 2v2" />
    <path d="M16 20h2a2 2 0 0 0 2 -2v-2" />
  </Svg>
);

/** Arrowhead choices: a short shaft with a head on neither, one, or both ends. */
export const HeadsIcon = ({ heads }: { heads: "none" | "start" | "end" | "both" }) => (
  <Svg strokeWidth={1.5}>
    <line x1="4" y1="12" x2="20" y2="12" />
    {heads === "end" || heads === "both" ? <polyline points="16 8 20 12 16 16" /> : null}
    {heads === "start" || heads === "both" ? <polyline points="8 8 4 12 8 16" /> : null}
  </Svg>
);
