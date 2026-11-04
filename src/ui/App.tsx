import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Doc, Element, Op } from "../model.ts";
import { applyOps, arrowLabelRect, arrowPoints, contentBounds } from "../model.ts";
import { clipCenter, copyElements, decodeClip, encodeClip, isBound, pasteOps } from "../clip.ts";
import { boxHeightForLabel, type Point } from "../layout.ts";
import {
  COLORS,
  COLOR_CSS,
  DEFAULT_VIEW_HEIGHT,
  DEFAULT_VIEW_WIDTH,
  FONT_FAMILY,
  LABEL_FONT,
  LINE_H,
  type Color,
} from "../constants.ts";
import { seedOf, sketchArrow, sketchBox, sketchFreehand } from "../sketch.ts";
import { fitView, NARROW_CANVAS, pinchView, type PinchStart, type ScreenPoint } from "../gesture.ts";
import { standaloneSvg } from "../export.ts";
import {
  ArrowIcon,
  CheckIcon,
  DrawIcon,
  DuplicateIcon,
  EraserIcon,
  FitIcon,
  HandIcon,
  HeadsIcon,
  LineIcon,
  LockIcon,
  LockOpenIcon,
  MenuIcon,
  RectangleIcon,
  RedoIcon,
  SelectIcon,
  TextIcon,
  TrashIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "../icons.tsx";
import { valueSchemas, type ApplyValue, type ContextValue, type ListValue, type OpenValue, type ThreadsValue, type ThreadRow } from "../protocol.ts";
import { call, onPush } from "./client.ts";
import {
  HANDLES,
  HANDLE_CURSOR,
  HEADS,
  boxAt,
  clampScale,
  constrained,
  deleteOps,
  elementBounds,
  hintFor,
  inside,
  normalized,
  previewed,
  resized,
  union,
  type Drag,
  type Editing,
  type Handle,
  type Heads,
  type Tool,
  type View,
} from "./geometry.ts";
import { Shape, Strokes, TextEditor } from "./shapes.tsx";
import { toast, Toasts } from "./toast.tsx";
import { embeddedFontCss, pngFromSvg, TooLarge, uploadPng } from "./png.ts";
import { useCoarsePointer, useTheme } from "./theme.ts";

/** Toolbar tools with their keys. Shapes the canvas does not model are left out. */
const TOOLS: { id: Tool; label: string; key: string; digit?: string; Icon: () => React.JSX.Element }[] = [
  { id: "hand", label: "Hand (panning tool)", key: "h", Icon: HandIcon },
  { id: "select", label: "Selection", key: "v", digit: "1", Icon: SelectIcon },
  { id: "box", label: "Rectangle", key: "r", digit: "2", Icon: RectangleIcon },
  { id: "arrow", label: "Arrow", key: "a", digit: "5", Icon: ArrowIcon },
  { id: "line", label: "Line", key: "l", digit: "6", Icon: LineIcon },
  { id: "pen", label: "Draw", key: "p", digit: "7", Icon: DrawIcon },
  { id: "text", label: "Text", key: "t", digit: "8", Icon: TextIcon },
  { id: "eraser", label: "Eraser", key: "e", digit: "0", Icon: EraserIcon },
];
/** Quick picks; the rest of the palette opens from the current-color swatch. */
const TOP_PICKS: Color[] = ["default", "red", "green", "blue", "yellow"];
const DUPLICATE_OFFSET = 10;
const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="5" fill="white" stroke="black" stroke-width="1"/></svg>',
)}") 10 10, crosshair`;

/** Module scope, so a copy survives switching canvases in the same page. */
let clipboard: Element[] | null = null;

const isField = (target: EventTarget | null) => /^(INPUT|TEXTAREA|SELECT)$/.test((target as HTMLElement | null)?.tagName ?? "");
const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const docOf = (value: unknown): Doc => ((value as { doc?: Doc }).doc ?? (value as Doc));

const api = {
  open: (args: { threadId?: string; name?: string }) => call<OpenValue>({ call: "open", ...args }, valueSchemas.open),
  list: () => call<ListValue>({ call: "list" }, valueSchemas.list),
  threads: (threadId: string) => call<ThreadsValue>({ call: "threads", threadId }, valueSchemas.threads),
  context: () => call<ContextValue>({ call: "context" }, valueSchemas.context),
};

function Canvas() {
  const theme = useTheme();
  const coarse = useCoarsePointer();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [locked, setLocked] = useState(false);
  const [color, setColor] = useState<Color>("default");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverBox, setHoverBox] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [target, setTarget] = useState<string>("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [docks, setDocks] = useState({ top: 100, bottom: 150 });
  useLayoutEffect(() => {
    const measure = () =>
      setDocks({ top: (topRef.current?.getBoundingClientRect().height ?? 0) + 24, bottom: (dockRef.current?.getBoundingClientRect().height ?? 0) + 12 });
    const observer = new ResizeObserver(measure);
    if (topRef.current) observer.observe(topRef.current);
    if (dockRef.current) observer.observe(dockRef.current);
    measure();
    return () => observer.disconnect();
  }, []);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [view, setView] = useState<View>({ x: -DEFAULT_VIEW_WIDTH / 2, y: -DEFAULT_VIEW_HEIGHT / 2, scale: 1 });
  const [size, setSize] = useState({ w: DEFAULT_VIEW_WIDTH, h: DEFAULT_VIEW_HEIGHT });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [measured, setMeasured] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<string | null>(null);
  const threadRef = useRef<string | null>(null);
  const fittedRef = useRef<string | null>(null);
  // A pan or zoom is the person's own framing. Until then, a resize refits.
  const userMoved = useRef(false);
  // Set when a push says an agent changed the canvas, so the next load brings that work into view.
  const revealRef = useRef(false);
  const spaceRef = useRef(false);
  // The doc as last shown, so back-to-back edits build on each other before React re-renders.
  const docRef = useRef<Doc | null>(null);
  // Plugin calls still out, per canvas. While any is out the page shows its own edits,
  // and a fetched doc, which predates them, would snap the drawing back.
  const pendingRef = useRef(new Map<string, number>());
  // Bumped on every doc the page shows from its own edits, so a fetch sent earlier is dropped.
  const epochRef = useRef(0);
  // The newest rev a push announced, and whether a failed call left the page unsure.
  const seenRevRef = useRef(0);
  const staleRef = useRef(false);
  // Once the person picks a canvas, a thread change no longer switches it.
  const pickedRef = useRef(false);
  const pointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  // Fingers on the canvas. A second finger abandons the stroke and pans or pinches instead.
  const pointersRef = useRef(new Map<number, ScreenPoint>());
  const pinchRef = useRef<PinchStart | null>(null);
  const suppressRef = useRef(false);

  const elements = useMemo(() => doc?.elements ?? [], [doc]);
  // Another writer may delete what is selected here, so the selection is whatever still exists.
  const selected = useMemo(() => elements.filter((e) => selectedIds.includes(e.id)), [elements, selectedIds]);
  const selection = selected.map((e) => e.id);

  // Hold space to drag the canvas around, as every drawing tool does.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space" && !isField(event.target) && (event.target as HTMLElement).tagName !== "BUTTON") spaceRef.current = true;
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // The viewBox tracks the element's own pixel size, so nothing is letterboxed.
  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (rect === undefined || rect.width === 0 || rect.height === 0) return;
      setSize({ w: rect.width, h: rect.height });
      setMeasured(true);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const fail = (cause: unknown) => toast.error(messageOf(cause));
  const show = useCallback((next: Doc) => {
    docRef.current = next;
    setDoc(next);
  }, []);
  const pendingFor = (name: string) => pendingRef.current.get(name) ?? 0;
  const refreshNames = useCallback(() => {
    api.list().then((r) => setNames(r.names), fail);
  }, []);

  // Pans, and zooms out if needed, so the elements an agent just changed are on screen.
  const revealElements = useCallback((before: Doc, after: Doc) => {
    const was = new Map(before.elements.map((element) => [element.id, JSON.stringify(element)]));
    const changed = after.elements.filter((element) => was.get(element.id) !== JSON.stringify(element));
    const bounds = contentBounds({ ...after, elements: changed });
    if (bounds === null) return;
    const { w, h } = sizeRef.current;
    setView((current) => {
      const scale = current.scale;
      const inside = bounds.x >= current.x && bounds.y >= current.y && bounds.x + bounds.w <= current.x + w / scale && bounds.y + bounds.h <= current.y + h / scale;
      if (inside) return current;
      if (bounds.w > w / scale || bounds.h > h / scale) return fitView(bounds, w, h);
      return { scale, x: bounds.x + bounds.w / 2 - w / scale / 2, y: bounds.y + bounds.h / 2 - h / scale / 2 };
    });
  }, []);

  const refetch: (name?: string) => void = useCallback(
    (name?: string) => {
      const epoch = epochRef.current;
      const thread = threadRef.current;
      api.open(name !== undefined ? { name } : thread !== null ? { threadId: thread } : {}).then((next) => {
        if (next.name === nameRef.current) {
          // `settle` fetches again once the calls still out are in.
          if ((pendingRef.current.get(next.name) ?? 0) > 0) {
            staleRef.current = true;
            return;
          }
          if (epoch !== epochRef.current) {
            refetch(next.name);
            return;
          }
        }
        if (next.name !== nameRef.current) {
          seenRevRef.current = 0;
          staleRef.current = false;
        }
        nameRef.current = next.name;
        const reveal = revealRef.current;
        revealRef.current = false;
        const before = docRef.current;
        show(next.doc);
        if (reveal && before !== null && before.name === next.doc.name) revealElements(before, next.doc);
      }, fail);
      refreshNames();
    },
    [show, refreshNames, revealElements],
  );
  const open = useCallback(
    (name?: string) => {
      setSelectedIds([]);
      setEditing(null);
      refetch(name);
    },
    [refetch],
  );
  const pick = useCallback(
    (name: string) => {
      pickedRef.current = true;
      open(name);
    },
    [open],
  );

  // The thread on screen. The page asks for it when it opens, since a push only comes on a change.
  const takeContext = useCallback(
    (threadOnScreen: string | null) => {
      threadRef.current = threadOnScreen;
      setThreadId(threadOnScreen);
      setTarget(threadOnScreen ?? "");
      if (threadOnScreen === null) setThreads([]);
      else api.threads(threadOnScreen).then((r) => setThreads(r.threads), (cause) => toast.error(messageOf(cause)));
      if (!pickedRef.current) open();
    },
    [open],
  );

  useEffect(() => {
    open();
    api.context().then((current) => takeContext(current.threadId), (cause) => toast.error(messageOf(cause)));
  }, [open, takeContext]);
  useEffect(
    () =>
      onPush((push) => {
        if (push.push === "context") {
          takeContext(push.threadId);
        } else if (push.push === "changed") {
          const name = nameRef.current;
          if (name !== null && push.name === name) {
            seenRevRef.current = Math.max(seenRevRef.current, push.rev);
            if (pendingFor(name) === 0 && push.rev !== docRef.current?.rev) {
              revealRef.current = true;
              refetch(name);
            }
          } else refreshNames();
        } else if (push.push === "deleted") {
          if (push.name === nameRef.current) {
            pickedRef.current = false;
            open();
          } else refreshNames();
        }
      }),
    [takeContext, refetch, refreshNames],
  );

  // A PNG of the whole drawing on the clipboard, for a pull request, an issue, or chat outside kagan.
  const copyImage = useCallback(async () => {
    setMenuOpen(false);
    const svg = svgRef.current;
    const frame = frameRef.current;
    const bounds = doc === null ? null : contentBounds(doc);
    if (!svg || !frame || !bounds) return void toast.info("Nothing to copy yet.");
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Hover and selection outlines are not part of the drawing.
    clone.querySelectorAll('[pointer-events="none"]').forEach((node) => node.remove());
    const style = getComputedStyle(frame);
    try {
      const markup = standaloneSvg(clone.innerHTML, bounds, (name) => style.getPropertyValue(name).trim(), style.getPropertyValue("--bg").trim() || "#ffffff", await embeddedFontCss());
      const png = await pngFromSvg(markup);
      await uploadPng(png);
      toast.info("Copied the canvas as an image");
    } catch (cause) {
      if (cause instanceof TooLarge) toast.error(cause.message);
      else toast.error("Couldn't copy the canvas as an image", messageOf(cause));
    }
  }, [doc]);
  // A narrow panel stacks its chrome and shortens its copy. Only a touch screen gets the big targets.
  const narrow = measured && (size.w < NARROW_CANVAS || (coarse && size.w < 1100));
  const touch = narrow && coarse;
  const fit = useCallback(() => {
    userMoved.current = false;
    setView(fitView(doc === null ? null : contentBounds(doc), size.w, size.h));
  }, [doc, size.h, size.w]);
  const zoomTo = useCallback(
    (next: (scale: number) => number) => {
      userMoved.current = true;
      setView((current) => {
        const scale = clampScale(next(current.scale));
        return {
          scale,
          x: current.x + size.w / 2 / current.scale - size.w / 2 / scale,
          y: current.y + size.h / 2 / current.scale - size.h / 2 / scale,
        };
      });
    },
    [size.h, size.w],
  );
  // The first measurement is often a frame before the panel settles. Keep fitting until the person pans or zooms.
  useEffect(() => {
    if (!measured || docRef.current === null) return;
    if (fittedRef.current !== docRef.current.name) {
      fittedRef.current = docRef.current.name;
      userMoved.current = false;
    }
    if (userMoved.current) return;
    setView(fitView(contentBounds(docRef.current), size.w, size.h));
  }, [doc?.name, measured, size.h, size.w]);
  // Once the canvas is fitted, a grab, a selection, or a tool change freezes the fit. Selecting a box grows the
  // bottom bar, and that must not re-center the drawing under the person's hand.
  const freezeFit = () => {
    if (docRef.current !== null && fittedRef.current === docRef.current.name) userMoved.current = true;
  };
  useLayoutEffect(freezeFit, [tool, selectedIds, editing, menuOpen, paletteOpen]);

  /** Shows a plugin call's doc only when no other call for the canvas is still out, then
   * fetches again if a push or a failure says the page may be behind. */
  const settle = useCallback(
    async <T,>(name: string, request: Promise<T>, docFrom: (result: T) => Doc): Promise<T | null> => {
      pendingRef.current.set(name, (pendingRef.current.get(name) ?? 0) + 1);
      try {
        const result = await request;
        if (pendingRef.current.get(name) === 1 && nameRef.current === name) {
          epochRef.current++;
          show(docFrom(result));
        }
        return result;
      } catch (cause) {
        fail(cause);
        staleRef.current = true;
        return null;
      } finally {
        const left = (pendingRef.current.get(name) ?? 1) - 1;
        pendingRef.current.set(name, left);
        if (left === 0 && nameRef.current === name && (staleRef.current || seenRevRef.current > (docRef.current?.rev ?? 0))) {
          staleRef.current = false;
          refetch(name);
        }
      }
    },
    [show, refetch],
  );

  /** Shows the edit at once: waiting for the round trip snaps a dropped shape back to where
   * it started for a frame. Resolves with the ids the plugin assigned. */
  const apply = useCallback(
    async (ops: Op[]): Promise<string[]> => {
      const current = docRef.current;
      if (current === null || ops.length === 0) return [];
      try {
        const local = applyOps(current, ops).doc;
        epochRef.current++;
        show(local);
        // The person's own edit keeps their framing, even when the panel's chrome then changes height.
        userMoved.current = true;
      } catch (cause) {
        fail(cause);
        return [];
      }
      const result = await settle(current.name, call<ApplyValue>({ call: "apply", name: current.name, ops }, valueSchemas.apply), (r) => r.doc);
      return result?.added ?? [];
    },
    [show, settle],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    const zoomAt = (rect: DOMRect, clientX: number, clientY: number, nextScale: (current: number) => number) =>
      setView((current) => {
        const scale = clampScale(nextScale(current.scale));
        const px = clientX - rect.left;
        const py = clientY - rect.top;
        return { scale, x: current.x + px / current.scale - px / scale, y: current.y + py / current.scale - py / scale };
      });
    const onWheel = (event: WheelEvent) => {
      userMoved.current = true;
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      // Pinch gestures arrive as ctrlKey wheels; cmd/ctrl + wheel zooms too.
      if (event.ctrlKey || event.metaKey) {
        zoomAt(rect, event.clientX, event.clientY, (scale) => scale * Math.exp(-event.deltaY / 100));
        return;
      }
      const sideways = event.shiftKey && event.deltaX === 0;
      const dx = sideways ? event.deltaY : event.deltaX;
      const dy = sideways ? 0 : event.deltaY;
      setView((current) => ({ ...current, x: current.x + dx / current.scale, y: current.y + dy / current.scale }));
    };
    // WebKit reports a trackpad pinch as gesture events, not ctrl+wheel.
    let gestureFrom = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureFrom = viewRef.current.scale;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      userMoved.current = true;
      const g = event as Event & { scale: number; clientX?: number; clientY?: number };
      const rect = svg.getBoundingClientRect();
      zoomAt(rect, g.clientX ?? rect.left + rect.width / 2, g.clientY ?? rect.top + rect.height / 2, () => gestureFrom * g.scale);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("gesturestart", onGestureStart);
    svg.addEventListener("gesturechange", onGestureChange);
    return () => {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("gesturestart", onGestureStart);
      svg.removeEventListener("gesturechange", onGestureChange);
    };
  }, []);

  const localPoint = (event: { clientX: number; clientY: number }): ScreenPoint | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect === undefined) return null;
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const trackPointer = (event: { pointerId: number; clientX: number; clientY: number }) => {
    const point = localPoint(event);
    if (point !== null) pointersRef.current.set(event.pointerId, point);
  };
  const beginPinch = () => {
    const points = [...pointersRef.current.values()];
    const a = points[0];
    const b = points[1];
    if (a === undefined || b === undefined) return;
    suppressRef.current = true;
    userMoved.current = true;
    setDrag(null);
    pinchRef.current = { view: viewRef.current, a, b };
  };

  const toWorld = (event: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: Math.round(view.x + (event.clientX - rect.left) / view.scale), y: Math.round(view.y + (event.clientY - rect.top) / view.scale) };
  };
  // Pointer capture retargets moves to the svg, so the eraser asks what is under the pointer.
  const idAt = (clientX: number, clientY: number): string | undefined =>
    (document.elementFromPoint(clientX, clientY) as SVGElement | null)?.closest<SVGElement>("[data-id]")?.dataset.id;

  const finishTool = () => {
    if (!locked) setTool("select");
  };
  const pickTool = (next: Tool) => {
    setTool(next);
    setMenuOpen(false);
    setPaletteOpen(false);
    if (next !== "select") setSelectedIds([]);
  };

  const startEditing = (element: Element) => {
    if (element.type === "path") return;
    setSelectedIds([element.id]);
    setEditing({
      id: element.id,
      at: element.type === "arrow" ? { x: element.x1, y: element.y1 } : { x: 0, y: 0 },
      value: element.type === "text" ? element.text : (element.label ?? ""),
    });
  };
  const commitEditing = (value: string) => {
    const current = editing;
    setEditing(null);
    // The textarea unmounts with focus inside it; without this, shortcuts stop reaching the canvas.
    rootRef.current?.focus({ preventScroll: true });
    if (current === null) return;
    const text = value.trim();
    if (current.id === null) {
      if (text === "") return;
      void apply([{ op: "add", element: { type: "text", x: current.at.x, y: current.at.y + LABEL_FONT, text, color } }]).then((ids) => {
        setSelectedIds(ids);
        finishTool();
      });
      return;
    }
    finishTool();
    const element = elements.find((e) => e.id === current.id);
    if (element === undefined) return;
    if (element.type === "text") {
      if (text === "") void apply([{ op: "delete", id: element.id }]);
      else if (text !== element.text) void apply([{ op: "update", id: element.id, patch: { text } }]);
    } else if (element.type === "box") {
      // A box grows to hold its label instead of clipping it.
      const h = Math.max(element.h, boxHeightForLabel(element.w, text));
      const relabel = text !== (element.label ?? "");
      if (relabel || h !== element.h)
        void apply([{ op: "update", id: element.id, patch: { ...(relabel ? { label: text } : {}), ...(h === element.h ? {} : { h }) } }]);
    } else if (element.type === "arrow" && text !== (element.label ?? "")) {
      void apply([{ op: "update", id: element.id, patch: { label: text } }]);
    }
  };

  const onDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (doc === null) return;
    freezeFit();
    setMenuOpen(false);
    setPaletteOpen(false);
    rootRef.current?.focus({ preventScroll: true });
    const pan = event.button === 1 || spaceRef.current || tool === "hand";
    if (!pan && event.button !== 0) return;
    trackPointer(event);
    // Without capture, a release over the toolbar or outside the page never reaches
    // the svg, and the drag outlives the button.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser already released; dragging still works without capture.
    }
    if (pointersRef.current.size >= 2) {
      beginPinch();
      return;
    }
    // The other finger of a pinch is still down. Wait until both are up before drawing again.
    if (suppressRef.current) return;
    if (pan) {
      event.preventDefault();
      userMoved.current = true;
      setDrag({ kind: "pan", from: { clientX: event.clientX, clientY: event.clientY }, view });
      return;
    }
    const p = toWorld(event);
    const hitTarget = event.target as SVGElement;
    const handle = hitTarget.closest<SVGElement>("[data-handle]")?.dataset.handle as Handle | undefined;
    const hit = hitTarget.closest<SVGElement>("[data-id]")?.dataset.id;
    if (tool === "select") {
      const only = selected.length === 1 ? selected[0] : undefined;
      if (handle !== undefined && only?.type === "box") {
        setDrag({ kind: "resize", id: only.id, handle, start: p, current: p, origin: { x: only.x, y: only.y, w: only.w, h: only.h } });
        return;
      }
      if (hit !== undefined) {
        const picked = selection.includes(hit);
        const next = event.shiftKey ? (picked ? selection.filter((id) => id !== hit) : [...selection, hit]) : picked ? selection : [hit];
        setSelectedIds(next);
        if (next.includes(hit)) setDrag({ kind: "move", ids: next, start: p, current: p });
        return;
      }
      if (!event.shiftKey) setSelectedIds([]);
      setDrag({ kind: "marquee", start: p, current: p, base: event.shiftKey ? selection : [] });
      return;
    }
    if (tool === "eraser") {
      setDrag({ kind: "erase", ids: hit === undefined ? [] : [hit] });
      return;
    }
    if (tool === "text") {
      event.preventDefault();
      // A click while editing only finishes the open text (its blur commits it).
      if (editing !== null) return;
      // Text clicked onto a box or an arrow becomes its label.
      const labelled = elements.find((e) => e.id === hit && (e.type === "box" || e.type === "arrow" || e.type === "text"));
      if (labelled !== undefined) startEditing(labelled);
      else setEditing({ id: null, at: { x: p.x, y: p.y - LINE_H / 2 }, value: "" });
      return;
    }
    if (tool === "pen") setDrag({ kind: "stroke", points: [[p.x, p.y]] });
    else setDrag({ kind: "shape", start: p, current: p });
  };

  /** Where the shape being drawn ends. An arrow over a box attaches to it, and snapping
   * would pull the end off the box, so Shift only snaps a free end. */
  const shapePoint = (start: Point, p: Point, shift: boolean): Point => {
    const linking = tool === "arrow" || tool === "line";
    const over = linking ? boxAt(elements, p) : undefined;
    if (linking) setHoverBox(over ?? null);
    return shift && over === undefined ? constrained(tool, start, p) : p;
  };

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointerRef.current = { clientX: event.clientX, clientY: event.clientY };
    if (pointersRef.current.has(event.pointerId)) trackPointer(event);
    const pinch = pinchRef.current;
    if (pinch !== null && pointersRef.current.size >= 2) {
      const points = [...pointersRef.current.values()];
      const a = points[0];
      const b = points[1];
      if (a !== undefined && b !== undefined) setView(pinchView(pinch, a, b));
      return;
    }
    if (suppressRef.current || drag === null) return;
    if (drag.kind === "pan") {
      setView({
        ...drag.view,
        x: drag.view.x - (event.clientX - drag.from.clientX) / drag.view.scale,
        y: drag.view.y - (event.clientY - drag.from.clientY) / drag.view.scale,
      });
      return;
    }
    if (drag.kind === "erase") {
      const id = idAt(event.clientX, event.clientY);
      if (id !== undefined && !drag.ids.includes(id)) setDrag({ kind: "erase", ids: [...drag.ids, id] });
      return;
    }
    const p = toWorld(event);
    switch (drag.kind) {
      case "stroke": {
        const last = drag.points[drag.points.length - 1]!;
        if (Math.abs(last[0] - p.x) + Math.abs(last[1] - p.y) >= 2) setDrag({ kind: "stroke", points: [...drag.points, [p.x, p.y]] });
        return;
      }
      case "marquee": {
        // Selects what the marquee fully covers, as it grows.
        const area = normalized(drag.start, p);
        const caught = elements.filter((e) => inside(elementBounds(e, elements), area)).map((e) => e.id);
        setSelectedIds([...new Set([...drag.base, ...caught])]);
        setDrag({ ...drag, current: p });
        return;
      }
      case "shape":
        setDrag({ ...drag, current: shapePoint(drag.start, p, event.shiftKey) });
        return;
      default:
        setDrag({ ...drag, current: p });
    }
  };
  // The shape reshapes on Shift down and up too, not only when the pointer moves.
  useEffect(() => {
    if (drag?.kind !== "shape") return;
    const onShift = (event: KeyboardEvent) => {
      if (event.key !== "Shift" || pointerRef.current === null) return;
      const p = toWorld(pointerRef.current);
      setDrag({ ...drag, current: shapePoint(drag.start, p, event.type === "keydown") });
    };
    window.addEventListener("keydown", onShift);
    window.addEventListener("keyup", onShift);
    return () => {
      window.removeEventListener("keydown", onShift);
      window.removeEventListener("keyup", onShift);
    };
  });

  const releasePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pinchRef.current !== null && pointersRef.current.size < 2) pinchRef.current = null;
    if (suppressRef.current || event.type === "pointercancel") {
      if (pointersRef.current.size === 0) suppressRef.current = false;
      setHoverBox(null);
      setDrag(null);
      return;
    }
    onUp();
  };

  const onUp = () => {
    setHoverBox(null);
    if (drag === null || doc === null) return;
    setDrag(null);
    switch (drag.kind) {
      case "pan":
      case "marquee":
        return;
      case "erase":
        void apply(deleteOps(drag.ids, elements));
        return;
      case "move": {
        const dx = drag.current.x - drag.start.x;
        const dy = drag.current.y - drag.start.y;
        if (dx === 0 && dy === 0) return;
        void apply(elements.filter((e) => drag.ids.includes(e.id) && !isBound(e)).map((e) => ({ op: "move", id: e.id, dx, dy })));
        return;
      }
      case "resize": {
        const next = resized(drag.origin, drag.handle, drag.current.x - drag.start.x, drag.current.y - drag.start.y);
        void apply([{ op: "update", id: drag.id, patch: next }]);
        return;
      }
      case "stroke":
        if (drag.points.length >= 2) void apply([{ op: "add", element: { type: "path", points: drag.points, color } }]);
        return;
      case "shape": {
        const { start, current } = drag;
        if (tool === "box") {
          const rect = normalized(start, current);
          if (rect.w < 4 || rect.h < 4) return;
          void apply([{ op: "add", element: { type: "box", ...rect, color } }]).then((ids) => {
            setSelectedIds(ids);
            finishTool();
          });
        } else if (tool === "arrow" || tool === "line") {
          if (Math.abs(current.x - start.x) + Math.abs(current.y - start.y) < 8) return;
          const from = boxAt(elements, start);
          const to = boxAt(elements, current);
          // Undefined is not a JSON value, so an unattached end omits the key.
          const attachment = from !== undefined && to !== undefined && from !== to ? { from, to } : {};
          void apply([
            {
              op: "add",
              element: { type: "arrow", x1: start.x, y1: start.y, x2: current.x, y2: current.y, heads: tool === "line" ? "none" : "end", color, ...attachment },
            },
          ]).then((ids) => {
            setSelectedIds(ids);
            finishTool();
          });
        }
      }
    }
  };

  const onDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== "select") return;
    // The first click captured the pointer, so the event targets the svg, not the shape under it.
    const id = idAt(event.clientX, event.clientY);
    const element = elements.find((e) => e.id === id);
    if (element !== undefined) startEditing(element);
    else {
      const p = toWorld(event);
      setEditing({ id: null, at: { x: p.x, y: p.y - LINE_H / 2 }, value: "" });
    }
  };

  const recolor = (next: Color) => {
    setColor(next);
    if (selected.length > 0) void apply(selected.map((e) => ({ op: "update", id: e.id, patch: { color: next } })));
  };
  const setHeads = (heads: Heads) => void apply(selected.filter((e) => e.type === "arrow").map((e) => ({ op: "update", id: e.id, patch: { heads } })));
  const removeSelected = () => {
    void apply(deleteOps(selection, elements));
    setSelectedIds([]);
  };
  const pasteClip = (clip: Element[], dx: number, dy: number) =>
    void apply(pasteOps(clip, Math.round(dx), Math.round(dy))).then((ids) => {
      if (ids.length > 0) {
        setTool("select");
        setSelectedIds(ids);
      }
    });
  const duplicateSelected = () => pasteClip(copyElements(selection, elements), DUPLICATE_OFFSET, DUPLICATE_OFFSET);
  /** Pastes centered on the pointer, or on the middle of the view when it is elsewhere. */
  const pasteTarget = (): Point =>
    pointerRef.current === null ? { x: view.x + size.w / 2 / view.scale, y: view.y + size.h / 2 / view.scale } : toWorld(pointerRef.current);
  const pasteHere = (clip: Element[]) => {
    const center = clipCenter(clip);
    const at = pasteTarget();
    pasteClip(clip, at.x - center.x, at.y - center.y);
  };
  const copySelection = (): boolean => {
    if (selected.length === 0) return false;
    clipboard = copyElements(selection, elements);
    return true;
  };
  /** Our own copy, any other text as a text element, or the kept copy when the clipboard is empty. */
  const pasteText = (text: string) => {
    const clip = decodeClip(text);
    if (clip !== null) pasteHere(clip);
    else if (text.trim() !== "") {
      const at = pasteTarget();
      void apply([{ op: "add", element: { type: "text", x: Math.round(at.x), y: Math.round(at.y), text: text.trim().slice(0, 500), color } }]).then((ids) =>
        setSelectedIds(ids),
      );
    } else if (clipboard !== null) pasteHere(clipboard);
  };
  // Cmd+C, X, and V arrive as these events, from the keyboard and the Edit menu alike: one path per
  // press, and the clipboard needs no permission.
  const onCopy = (event: ClipboardEvent, cut: boolean) => {
    if (isField(event.target) || deleteName !== null || !copySelection() || clipboard === null) return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", encodeClip(clipboard));
    if (cut) removeSelected();
  };
  const onPaste = (event: ClipboardEvent) => {
    if (isField(event.target) || deleteName !== null) return;
    event.preventDefault();
    pasteText(event.clipboardData?.getData("text/plain") ?? "");
  };
  const nudge = (dx: number, dy: number) => void apply(selected.filter((e) => !isBound(e)).map((e) => ({ op: "move", id: e.id, dx, dy })));

  const step = useCallback(
    (direction: "undo" | "redo") => {
      const name = nameRef.current;
      if (name === null) return;
      userMoved.current = true;
      void settle(name, call<unknown>({ call: direction, name }, valueSchemas[direction]), docOf);
    },
    [settle],
  );
  const clear = () => {
    setMenuOpen(false);
    setSelectedIds([]);
    void apply([{ op: "clear" }]);
  };
  const removeDiagram = () => {
    if (!deleteName) return;
    const removing = deleteName;
    call<unknown>({ call: "delete", name: removing }, valueSchemas.delete).then((result) => {
      setDeleteName(null);
      const left = (result as { names?: string[] } | null)?.names;
      if (left !== undefined) setNames(left);
      else refreshNames();
      if (nameRef.current === removing) {
        pickedRef.current = false;
        open(left?.[0]);
      }
    }, fail);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (isField(event.target) || deleteName !== null) return;
    const key = event.key.toLowerCase();
    const mod = event.metaKey || event.ctrlKey;
    // A focused button keeps Enter and Space for itself.
    if ((event.target as HTMLElement).tagName === "BUTTON" && (event.key === "Enter" || event.code === "Space")) return;
    const handled = () => event.preventDefault();
    if (mod && key === "z" && !event.shiftKey) {
      handled();
      step("undo");
    } else if ((mod && key === "z" && event.shiftKey) || (event.ctrlKey && !event.metaKey && key === "y")) {
      handled();
      step("redo");
    } else if (mod && (key === "=" || key === "+")) {
      handled();
      zoomTo((v) => v * 1.1);
    } else if (mod && key === "-") {
      handled();
      zoomTo((v) => v / 1.1);
    } else if (mod && key === "0") {
      handled();
      zoomTo(() => 1);
    } else if (event.shiftKey && event.code === "Digit1") {
      handled();
      fit();
    } else if (mod && key === "a") {
      handled();
      setTool("select");
      setSelectedIds(elements.map((e) => e.id));
    } else if (mod && !event.shiftKey && key === "d") {
      handled();
      if (selected.length > 0) duplicateSelected();
    } else if ((event.key === "Backspace" || event.key === "Delete") && selected.length > 0) {
      handled();
      removeSelected();
    } else if (event.key === "Enter" && selected.length === 1) {
      handled();
      startEditing(selected[0]!);
    } else if (event.key.startsWith("Arrow") && selected.length > 0) {
      handled();
      const amount = event.shiftKey ? 5 : 1;
      if (event.key === "ArrowLeft") nudge(-amount, 0);
      else if (event.key === "ArrowRight") nudge(amount, 0);
      else if (event.key === "ArrowUp") nudge(0, -amount);
      else nudge(0, amount);
    } else if (event.key === "Escape") {
      setTool("select");
      setSelectedIds([]);
      setDrag(null);
      setMenuOpen(false);
      setPaletteOpen(false);
    } else if (!mod && !event.altKey && key === "q") {
      setLocked((value) => !value);
    } else if (!mod && !event.altKey && !event.shiftKey) {
      const next = TOOLS.find((t) => t.key === key || t.digit === key);
      if (next) pickTool(next.id);
    }
  };
  // The latest handlers, reached through window and document so keys and the clipboard work wherever focus sits in the page.
  const handlers = useRef({ onKeyDown, onCopy, onPaste });
  handlers.current = { onKeyDown, onCopy, onPaste };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => handlers.current.onKeyDown(event);
    const copy = (event: ClipboardEvent) => handlers.current.onCopy(event, false);
    const cut = (event: ClipboardEvent) => handlers.current.onCopy(event, true);
    const paste = (event: ClipboardEvent) => handlers.current.onPaste(event);
    window.addEventListener("keydown", keydown);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("keydown", keydown);
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("paste", paste);
    };
  }, []);

  const send = async () => {
    if (nameRef.current === null || sending || target === "") return;
    setSending(true);
    try {
      await call({ call: "send", name: nameRef.current, threadId: target, note }, valueSchemas.send);
      setNote("");
      toast.info("Pasted into the thread. Press Enter there to send it.");
    } catch (cause) {
      fail(cause);
    } finally {
      setSending(false);
    }
  };

  const dragged = drag?.kind === "move" || drag?.kind === "resize" ? elements.map((e) => previewed(e, drag)) : elements;
  // A box grows to hold the label as it is typed, as it will once the label is saved.
  const shown =
    editing === null
      ? dragged
      : dragged.map((e) => (e.type === "box" && e.id === editing.id ? { ...e, h: Math.max(e.h, boxHeightForLabel(e.w, editing.value.trim())) } : e));
  const s = view.scale;
  const erasing = drag?.kind === "erase" ? drag.ids : [];
  const preview = drag?.kind === "shape" ? drag : null;
  const stroke = COLOR_CSS[theme][color];
  const panelColor = selected[0]?.color ?? (selected.length > 0 ? "default" : color);
  const arrowsSelected = selected.filter((e): e is Extract<Element, { type: "arrow" }> => e.type === "arrow");
  const showPanel = selected.length > 0 || tool === "box" || tool === "arrow" || tool === "line" || tool === "pen" || tool === "text";
  const bounds = doc === null ? null : contentBounds(doc);
  const lost = bounds !== null && (bounds.x > view.x + size.w / s || bounds.x + bounds.w < view.x || bounds.y > view.y + size.h / s || bounds.y + bounds.h < view.y);
  const hint = doc?.elements.length === 0 && editing === null && !menuOpen ? hintFor(tool, selected) : null;

  // A menu, palette, or panel that unmounts with focus inside drops focus on the body. Focus the
  // person moved elsewhere stays where it went.
  useEffect(() => {
    if (document.activeElement === null || document.activeElement === document.body) rootRef.current?.focus({ preventScroll: true });
  }, [menuOpen, paletteOpen, showPanel, selected.length]);
  const cursor = drag?.kind === "pan" ? "grabbing" : tool === "hand" ? "grab" : tool === "eraser" ? ERASER_CURSOR : tool === "select" ? "default" : "crosshair";

  const previewArrow = (() => {
    if (preview === null || (tool !== "arrow" && tool !== "line")) return null;
    const from = boxAt(elements, preview.start);
    const to = boxAt(elements, preview.current);
    const arrow = {
      type: "arrow" as const,
      id: "preview",
      x1: preview.start.x,
      y1: preview.start.y,
      x2: preview.current.x,
      y2: preview.current.y,
      ...(from !== undefined && to !== undefined && from !== to ? { from, to } : {}),
    };
    return sketchArrow(arrowPoints(arrow, elements), tool === "line" ? "none" : "end", seedOf("preview"), stroke);
  })();
  const previewBox = preview !== null && tool === "box" ? normalized(preview.start, preview.current) : null;

  const pad = 4 / s;
  const outlines = selected.map((e) => {
    const b = elementBounds(shown.find((live) => live.id === e.id) ?? e, shown);
    return { id: e.id, x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  });
  const group = outlines.length > 1 ? union(outlines) : null;
  const handleBox = selected.length === 1 && selected[0]!.type === "box" && drag?.kind !== "move" ? outlines[0] : undefined;
  const hovered = hoverBox === null ? undefined : elements.find((e) => e.id === hoverBox);
  const canvasNames = doc && !names.includes(doc.name) ? [doc.name, ...names] : names;
  const sendReason = threadId === null ? "Open a thread to send this canvas to it." : null;

  return (
    <div ref={rootRef} className={["cv-root", narrow && "cv-narrow", touch && "cv-touch"].filter(Boolean).join(" ")} tabIndex={0}>
      <div ref={frameRef} className="cv-frame" style={{ top: docks.top, bottom: docks.bottom }}>
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${size.w / s} ${size.h / s}`}
          className="cv-svg"
          style={{ cursor }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
          onPointerLeave={() => {
            if (drag === null) pointerRef.current = null;
          }}
          onDoubleClick={onDoubleClick}
        >
          {shown.map((e) => (
            <Shape
              key={e.id}
              element={e}
              route={e.type === "arrow" ? arrowPoints(e, shown) : null}
              labelAt={e.type === "arrow" ? arrowLabelRect(e, shown) : null}
              theme={theme}
              faded={erasing.includes(e.id)}
              hideText={editing?.id === e.id}
              movable={tool === "select"}
            />
          ))}
          <g pointerEvents="none">
            {hovered?.type === "box" ? (
              <rect
                x={hovered.x - 6 / s}
                y={hovered.y - 6 / s}
                width={hovered.w + 12 / s}
                height={hovered.h + 12 / s}
                rx={8 / s}
                fill="none"
                stroke="var(--accent)"
                strokeOpacity={0.35}
                strokeWidth={8 / s}
              />
            ) : null}
            {previewBox !== null && previewBox.w >= 1 && previewBox.h >= 1 ? (
              <g transform={`translate(${previewBox.x} ${previewBox.y})`}>
                <Strokes paths={sketchBox(previewBox.w, previewBox.h, seedOf("preview"), stroke)} />
              </g>
            ) : null}
            {previewArrow ? <Strokes paths={previewArrow} /> : null}
            {drag?.kind === "stroke" ? <Strokes paths={[sketchFreehand(drag.points, stroke, false)]} /> : null}
            {outlines.map((o) => (
              <rect key={o.id} x={o.x} y={o.y} width={o.w} height={o.h} fill="none" stroke="var(--accent)" strokeWidth={1 / s} />
            ))}
            {group ? (
              <rect
                x={group.x - pad}
                y={group.y - pad}
                width={group.w + pad * 2}
                height={group.h + pad * 2}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1 / s}
                strokeDasharray={`${4 / s} ${4 / s}`}
              />
            ) : null}
            {drag?.kind === "marquee"
              ? (() => {
                  const area = normalized(drag.start, drag.current);
                  return <rect x={area.x} y={area.y} width={area.w} height={area.h} fill="var(--accent)" fillOpacity={0.08} stroke="var(--accent)" strokeWidth={1 / s} />;
                })()
              : null}
          </g>
          {handleBox
            ? HANDLES.map((handle) => {
                // Side handles only once the box is big enough to tell them from the corners.
                if (handle.length === 1 && (handleBox.w * s < (touch ? 72 : 40) || handleBox.h * s < (touch ? 72 : 40))) return null;
                const side = (touch ? 28 : 8) / s;
                const hx = handle.includes("w") ? handleBox.x : handle.includes("e") ? handleBox.x + handleBox.w : handleBox.x + handleBox.w / 2;
                const hy = handle.includes("n") ? handleBox.y : handle.includes("s") ? handleBox.y + handleBox.h : handleBox.y + handleBox.h / 2;
                return (
                  <rect
                    key={handle}
                    data-handle={handle}
                    x={hx - side / 2}
                    y={hy - side / 2}
                    width={side}
                    height={side}
                    rx={2 / s}
                    fill="var(--bg)"
                    stroke="var(--accent)"
                    strokeWidth={1 / s}
                    style={{ cursor: HANDLE_CURSOR[handle] }}
                  />
                );
              })
            : null}
        </svg>
        {editing !== null && doc !== null ? (
          <TextEditor
            // A fresh editor per session: a reused one has already committed and keeps stale text.
            key={editing.id ?? `new ${editing.at.x},${editing.at.y}`}
            editing={editing}
            doc={{ ...doc, elements: shown }}
            view={view}
            theme={theme}
            color={color}
            onType={(value) => setEditing((current) => (current === null ? null : { ...current, value }))}
            onCommit={commitEditing}
          />
        ) : null}
      </div>

      {doc !== null && doc.elements.length === 0 && editing === null && drag === null ? (
        <div className="cv-empty" style={{ fontFamily: FONT_FAMILY }}>
          <div className="cv-empty-title">Pick a tool &amp; start drawing!</div>
          <div className="cv-empty-line">{narrow ? "Hold ⌘ and scroll to zoom. Two fingers move the canvas." : "Agents draw here too. Send the canvas to a thread below."}</div>
        </div>
      ) : null}

      <div ref={topRef} className="cv-top">
        <div className="cv-top-row">
          <button
            type="button"
            className="cv-btn cv-fill"
            aria-label="Main menu"
            title="Canvases and canvas actions"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((value) => !value);
              setPaletteOpen(false);
              setNewName(null);
            }}
          >
            <MenuIcon />
          </button>
          <span className="cv-name" title={doc?.name}>
            {doc?.name}
          </span>
        </div>
        <div className="cv-top-row cv-center">
          <div className="cv-island cv-toolbar" role="toolbar" aria-label="Tools">
            <button
              type="button"
              className="cv-btn"
              aria-pressed={locked}
              aria-label="Keep selected tool active after drawing"
              title="Keep selected tool active after drawing — Q"
              onClick={() => setLocked((value) => !value)}
            >
              {locked ? <LockIcon /> : <LockOpenIcon />}
            </button>
            <span className="cv-divider" />
            {TOOLS.map(({ id, label, key, digit, Icon }) => (
              <button
                key={id}
                type="button"
                className="cv-btn"
                aria-pressed={tool === id}
                aria-label={label}
                title={`${label} — ${key.toUpperCase()}${digit ? ` or ${digit}` : ""}`}
                onClick={() => pickTool(id)}
              >
                <Icon />
                <span className="cv-key">{key.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {hint ? (
        <div className="cv-hint" style={{ top: docks.top + 8 }}>
          {hint}
        </div>
      ) : null}

      {menuOpen ? (
        <>
          <div className="cv-scrim" onPointerDown={() => setMenuOpen(false)} />
          <div className="cv-island cv-menu" role="menu">
            <div className="cv-menu-label">Canvases</div>
            {canvasNames.map((n) => (
              <button
                key={n}
                type="button"
                role="menuitem"
                className="cv-menu-item"
                aria-current={n === doc?.name}
                onClick={() => {
                  setMenuOpen(false);
                  if (n !== doc?.name) pick(n);
                }}
              >
                <span className="cv-check">{n === doc?.name ? <CheckIcon /> : null}</span>
                <span className="cv-truncate">{n}</span>
              </button>
            ))}
            {newName === null ? (
              <button type="button" role="menuitem" className="cv-menu-item" onClick={() => setNewName("")}>
                <span className="cv-check">
                  <ZoomInIcon />
                </span>
                New canvas…
              </button>
            ) : (
              <div className="cv-new">
                <label className="cv-menu-label" htmlFor="canvas-name">
                  Canvas name
                </label>
                <input
                  id="canvas-name"
                  autoFocus
                  className="cv-field"
                  placeholder="Name, then Enter"
                  aria-label="New canvas name"
                  value={newName}
                  maxLength={80}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter" && newName.trim() !== "") {
                      setMenuOpen(false);
                      pick(newName.trim());
                    } else if (event.key === "Escape") setNewName(null);
                  }}
                />
                {names.includes(newName.trim()) && <p className="cv-menu-label">This name already exists. Open it to continue.</p>}
                <button
                  type="button"
                  className="cv-menu-item"
                  disabled={!newName.trim()}
                  onClick={() => {
                    setMenuOpen(false);
                    pick(newName.trim());
                  }}
                >
                  {names.includes(newName.trim()) ? "Open canvas" : "Create canvas"}
                </button>
              </div>
            )}
            <div className="cv-menu-sep" />
            <button
              type="button"
              role="menuitem"
              className="cv-menu-item"
              onClick={() => {
                setMenuOpen(false);
                fit();
              }}
            >
              <span className="cv-check">
                <FitIcon />
              </span>
              Zoom to fit
              <span className="cv-shortcut">Shift+1</span>
            </button>
            <button type="button" role="menuitem" className="cv-menu-item" onClick={() => void copyImage()}>
              <span className="cv-check">
                <DuplicateIcon />
              </span>
              Copy as image
            </button>
            <button type="button" role="menuitem" className="cv-menu-item" onClick={clear}>
              <span className="cv-check">
                <TrashIcon />
              </span>
              Reset the canvas
            </button>
            <button
              type="button"
              role="menuitem"
              className="cv-menu-item"
              onClick={() => {
                setMenuOpen(false);
                setDeleteName(nameRef.current);
              }}
            >
              <span className="cv-check">
                <TrashIcon />
              </span>
              Delete this canvas
            </button>
          </div>
        </>
      ) : null}

      <div ref={dockRef} className="cv-dock">
        {showPanel && !menuOpen ? (
          <div className="cv-island cv-panel" aria-label="Drawing style">
            <section>
              <h3>Stroke</h3>
              <div className="cv-row">
                {TOP_PICKS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="cv-swatch"
                    aria-label={c}
                    title={c}
                    aria-pressed={panelColor === c}
                    style={{ background: COLOR_CSS[theme][c] }}
                    onClick={() => recolor(c)}
                  />
                ))}
                <span className="cv-divider" />
                <button
                  type="button"
                  className="cv-swatch cv-swatch-current"
                  aria-label="More colors"
                  title="More colors"
                  aria-expanded={paletteOpen}
                  style={{ background: COLOR_CSS[theme][panelColor] }}
                  onClick={() => setPaletteOpen((value) => !value)}
                />
              </div>
              {paletteOpen ? (
                <div className="cv-palette">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="cv-swatch"
                      aria-label={c}
                      title={c}
                      aria-pressed={panelColor === c}
                      style={{ background: COLOR_CSS[theme][c] }}
                      onClick={() => {
                        recolor(c);
                        setPaletteOpen(false);
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </section>
            {arrowsSelected.length > 0 ? (
              <section>
                <h3>Arrowheads</h3>
                <div className="cv-row">
                  {HEADS.map((heads) => (
                    <button
                      key={heads}
                      type="button"
                      className="cv-btn cv-fill"
                      aria-label={`Arrowheads: ${heads}`}
                      title={heads}
                      aria-pressed={arrowsSelected.every((a) => (a.heads ?? "end") === heads)}
                      onClick={() => setHeads(heads)}
                    >
                      <HeadsIcon heads={heads} />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {selected.length > 0 ? (
              <section>
                <h3>Actions</h3>
                <div className="cv-row">
                  <button type="button" className="cv-btn cv-fill" aria-label="Duplicate" title="Duplicate — Cmd+D" onClick={duplicateSelected}>
                    <DuplicateIcon />
                  </button>
                  <button type="button" className="cv-btn cv-fill" aria-label="Delete" title="Delete" onClick={removeSelected}>
                    <TrashIcon />
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {lost ? (
          <button type="button" className="cv-island cv-pill" onClick={fit}>
            Scroll back to content
          </button>
        ) : null}

        <div className="cv-bottom">
          <div className="cv-group">
            <button type="button" className="cv-btn" aria-label="Zoom out" title="Zoom out — Cmd+-" onClick={() => zoomTo((v) => v / 1.1)}>
              <ZoomOutIcon />
            </button>
            <button type="button" className="cv-zoom" aria-label="Reset zoom" title="Reset zoom — Cmd+0" onClick={() => zoomTo(() => 1)}>
              {Math.round(s * 100)}%
            </button>
            <button type="button" className="cv-btn" aria-label="Zoom in" title="Zoom in — Cmd++" onClick={() => zoomTo((v) => v * 1.1)}>
              <ZoomInIcon />
            </button>
          </div>
          <div className="cv-group">
            <button type="button" className="cv-btn" aria-label="Undo" title="Undo — Cmd+Z" onClick={() => step("undo")}>
              <UndoIcon />
            </button>
            <button type="button" className="cv-btn" aria-label="Redo" title="Redo — Cmd+Shift+Z" onClick={() => step("redo")}>
              <RedoIcon />
            </button>
          </div>
          <div className="cv-island cv-send">
            <select aria-label="Send to" className="cv-select" value={target} onChange={(e) => setTarget(e.target.value)}>
              {threads.length === 0 ? <option value="">No threads</option> : null}
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id === threadId ? "This thread" : t.title} · {t.status}
                </option>
              ))}
            </select>
            <input
              className="cv-field cv-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
              placeholder={narrow ? "Note for the agent" : "What should the agent do with this?"}
              aria-label="Note for the agent"
            />
            <button type="button" className="cv-primary" onClick={() => void send()} disabled={sending || doc === null || target === ""}>
              Send
            </button>
            <p className="cv-caption">
              {sendReason ?? (
                <>
                  Pastes your note and <code>kg canvas show {doc?.name ?? "name"}</code> into the thread. Press Enter there to send it.
                </>
              )}
            </p>
          </div>
        </div>
      </div>
      {deleteName !== null ? <ConfirmDelete name={deleteName} onKeep={() => setDeleteName(null)} onDelete={removeDiagram} /> : null}
    </div>
  );
}

function ConfirmDelete({ name, onKeep, onDelete }: { name: string; onKeep: () => void; onDelete: () => void }) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keepRef.current?.focus();
  }, []);
  return (
    <div className="cv-modal" onPointerDown={onKeep}>
      <div
        className="cv-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-body"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onKeep();
          }
        }}
      >
        <h2 id="delete-title">Delete “{name}”?</h2>
        <p id="delete-body">Its shapes will be removed. Deleting a canvas cannot be undone.</p>
        <div className="cv-dialog-actions">
          <button ref={keepRef} type="button" className="cv-outline" onClick={onKeep}>
            Keep canvas
          </button>
          <button type="button" className="cv-danger" onClick={onDelete}>
            Delete canvas
          </button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <>
      <Canvas />
      <Toasts />
    </>
  );
}

