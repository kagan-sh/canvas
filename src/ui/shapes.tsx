import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Doc, Element } from "../model.ts";
import { arrowLabelRect, arrowPoints } from "../model.ts";
import { boxLabelLines, longestSegment, textBounds, textLines, textWidth, visibleBoxLines, type Point, type Rect } from "../layout.ts";
import { ARROW_FONT, BOX_PAD, COLOR_CSS, FONT_FAMILY, LABEL_FONT, LINE_H, type Color, type Theme } from "../constants.ts";
import { seedOf, sketchArrow, sketchBox, sketchFreehand, type SketchPath } from "../sketch.ts";
import type { Heads, View } from "./geometry.ts";
import type { Editing } from "./geometry.ts";

function Lines({ x, y, lines, fill, anchor, centered }: { x: number; y: number; lines: string[]; fill: string; anchor: "middle" | "start"; centered?: boolean }) {
  if (lines.length === 0) return null;
  const startY = centered ? y - ((lines.length - 1) * LINE_H) / 2 : y;
  return (
    <text fill={fill} fontSize={LABEL_FONT} fontFamily={FONT_FAMILY} textAnchor={anchor}>
      {lines.map((line, i) => (
        <tspan key={i} x={x} y={startY + i * LINE_H} dominantBaseline={centered ? "central" : "auto"}>
          {line || " "}
        </tspan>
      ))}
    </text>
  );
}

export function Strokes({ paths }: { paths: SketchPath[] }) {
  return (
    <>
      {paths.map((path, i) =>
        path.fill ? (
          <path key={i} d={path.d} fill={path.fill} />
        ) : (
          <path key={i} d={path.d} fill="none" stroke={path.stroke} strokeWidth={path.strokeWidth} strokeLinecap="round" />
        ),
      )}
    </>
  );
}

/** Sits on the line over a patch of canvas. The patch is measured, not estimated: handwriting capitals run wider than an average character. */
function ArrowLabel({ at, label, fill }: { at: Point; label: string; fill: string }) {
  const textRef = useRef<SVGTextElement>(null);
  const [width, setWidth] = useState(label.length * ARROW_FONT * 0.55);
  useLayoutEffect(() => {
    const measure = () => {
      if (textRef.current !== null) setWidth(textRef.current.getBBox().width);
    };
    measure();
    void document.fonts.ready.then(measure);
  }, [label]);
  const padded = width + 12;
  return (
    <>
      <rect x={at.x - padded / 2} y={at.y - ARROW_FONT * 0.75} width={padded} height={ARROW_FONT * 1.5} fill="var(--bg)" />
      <text ref={textRef} x={at.x} y={at.y} textAnchor="middle" dominantBaseline="central" fill={fill} fontSize={ARROW_FONT} fontFamily={FONT_FAMILY}>
        {label}
      </text>
    </>
  );
}

type ShapeProps = {
  element: Element;
  route: Point[] | null;
  labelAt: Rect | null;
  theme: Theme;
  faded: boolean;
  hideText: boolean;
  movable: boolean;
};

const routeKey = (route: Point[] | null) => (route === null ? "" : route.map((p) => `${p.x},${p.y}`).join(" "));

/** Sketched once per geometry: rough.js is too slow to rerun for every element on every frame. */
export const Shape = memo(
  function Shape({ element, route, labelAt, theme, faded, hideText, movable }: ShapeProps) {
    const stroke = COLOR_CSS[theme][element.color ?? "default"];
    const seed = seedOf(element.id);
    const w = element.type === "box" ? element.w : 0;
    const h = element.type === "box" ? element.h : 0;
    const heads: Heads = element.type === "arrow" ? (element.heads ?? "end") : "end";
    const points = element.type === "path" ? element.points : null;
    const key = routeKey(route);
    const paths = useMemo((): SketchPath[] => {
      if (element.type === "box") return sketchBox(w, h, seed, stroke);
      if (element.type === "arrow") return route === null ? [] : sketchArrow(route, heads, seed, stroke);
      if (points !== null) return [sketchFreehand(points, stroke, true)];
      return [];
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [element.type, w, h, seed, stroke, heads, key, points]);
    const common = {
      "data-id": element.id,
      opacity: faded ? 0.3 : 1,
      style: movable ? ({ cursor: "move" } as CSSProperties) : undefined,
    };

    switch (element.type) {
      case "box":
        return (
          <g {...common} transform={`translate(${element.x} ${element.y})`}>
            <rect width={element.w} height={element.h} fill="transparent" />
            <Strokes paths={paths} />
            {element.label && !hideText ? (
              <Lines x={element.w / 2} y={element.h / 2} lines={visibleBoxLines(element.label, element.w, element.h)} fill={stroke} anchor="middle" centered />
            ) : null}
          </g>
        );
      case "arrow": {
        const line = route ?? [];
        return (
          <g {...common}>
            <polyline points={line.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="transparent" strokeWidth={16} />
            <Strokes paths={paths} />
            {labelAt && element.label && !hideText ? (
              <ArrowLabel at={{ x: labelAt.x + labelAt.w / 2, y: labelAt.y + labelAt.h / 2 }} label={element.label} fill={stroke} />
            ) : null}
          </g>
        );
      }
      case "text": {
        const bounds = textBounds(element.x, element.y, element.text);
        return (
          <g {...common}>
            <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} fill="transparent" />
            {hideText ? null : <Lines x={element.x} y={element.y} lines={textLines(element.text)} fill={stroke} anchor="start" />}
          </g>
        );
      }
      case "path":
        return (
          <g {...common}>
            <polyline points={element.points.map((p) => p.join(",")).join(" ")} fill="none" stroke="transparent" strokeWidth={16} />
            <Strokes paths={paths} />
          </g>
        );
    }
  },
  (a, b) =>
    a.element === b.element &&
    a.theme === b.theme &&
    a.faded === b.faded &&
    a.hideText === b.hideText &&
    a.movable === b.movable &&
    routeKey(a.route) === routeKey(b.route) &&
    a.labelAt?.x === b.labelAt?.x &&
    a.labelAt?.y === b.labelAt?.y,
);

/** Text is edited in place: a bare textarea in the element's own font, committed on blur or Escape. */
export function TextEditor({
  editing,
  doc,
  view,
  theme,
  color,
  onType,
  onCommit,
}: {
  editing: Editing;
  doc: Doc;
  view: View;
  theme: Theme;
  color: Color;
  onType: (value: string) => void;
  onCommit: (value: string) => void;
}) {
  const [value, setValue] = useState(editing.value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  // The host may hand focus back to the page after a click, so autoFocus alone can lose the
  // race and a blur-to-commit editor would close at once.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(value);
  };
  const element = editing.id === null ? undefined : doc.elements.find((e) => e.id === editing.id);
  const s = view.scale;
  const screen = (x: number, y: number) => ({ left: (x - view.x) * s, top: (y - view.y) * s });
  let box: CSSProperties;
  let maxLength = 500;
  if (element?.type === "box") {
    const height = Math.max(1, boxLabelLines(value, element.w).length) * LINE_H;
    box = {
      ...screen(element.x, element.y + element.h / 2 - height / 2),
      width: element.w * s,
      height: height * s,
      padding: `0 ${BOX_PAD * s}px`,
      boxSizing: "border-box",
      textAlign: "center",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    };
    maxLength = 200;
  } else if (element?.type === "arrow") {
    const spot = arrowLabelRect(element, doc.elements);
    const at = spot === null ? longestSegment(arrowPoints(element, doc.elements)).mid : { x: spot.x + spot.w / 2, y: spot.y + spot.h / 2 };
    const width = Math.max(120, value.length * ARROW_FONT * 0.6 + 24);
    box = { ...screen(at.x - width / 2, at.y - LINE_H / 2), width: width * s, height: LINE_H * s, textAlign: "center" };
    maxLength = 200;
  } else {
    const at = element?.type === "text" ? { x: element.x, y: element.y - LABEL_FONT } : editing.at;
    const width = Math.max(40, ...value.split("\n").map((line) => textWidth(line, LABEL_FONT) + 20));
    box = { ...screen(at.x, at.y), width: width * s, height: Math.max(1, textLines(value).length) * LINE_H * s };
  }
  const tint = element !== undefined && element.type !== "path" ? (element.color ?? "default") : color;
  return (
    <textarea
      ref={ref}
      className="cv-editor"
      aria-label="Text"
      value={value}
      maxLength={maxLength}
      wrap={element?.type === "box" ? "soft" : "off"}
      spellCheck={false}
      style={{ ...box, fontSize: (element?.type === "arrow" ? ARROW_FONT : LABEL_FONT) * s, lineHeight: `${LINE_H * s}px`, color: COLOR_CSS[theme][tint] }}
      onChange={(event) => {
        setValue(event.target.value);
        onType(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}
