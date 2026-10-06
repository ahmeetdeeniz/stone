import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Canvas, Group, Path, Picture, Rect, Skia } from "@shopify/react-native-skia";
import { Gesture, GestureDetector, PointerType } from "react-native-gesture-handler";
import {
  locatePoint,
  notebookHeight,
  pageDocument,
  pageOffsets,
  selectLasso,
  selectRectangle,
  type InkNotebook,
  type InkPage,
  type InkPoint,
  type InkSelection,
  type InkShape,
  type InkShapeKind,
  type InkTool,
} from "@stone/ink";
import { useTheme } from "../design/theme";
import { useI18n } from "../i18n/provider";
import {
  clampView,
  centreInFree,
  fitWidth,
  pinchView,
  strokeOutline,
  toNotebook,
  visiblePageIndex,
  visibleRange,
  type NotebookView,
} from "./notebook-view";
import { drawShape, outlinePath, recordPage } from "./page-picture";

export type NotebookTool = InkTool | InkShapeKind | "select" | "lasso" | "pan";

export interface PageSelection {
  pageIndex: number;
  selection: InkSelection;
}

export interface NotebookCanvasHandle {
  scrollToPage(index: number): void;
}

export interface NotebookCanvasProps {
  notebook: InkNotebook;
  tool: NotebookTool;
  color: string;
  width: number;
  /** Only the pen draws; fingers scroll and zoom. */
  stylusOnly: boolean;
  selection: PageSelection | null;
  onStroke(pageIndex: number, points: readonly InkPoint[]): void;
  /** Called while erasing (`done` false) and once when the eraser lifts (`done` true). */
  onErase(pageIndex: number, point: InkPoint, done: boolean): void;
  onShape(pageIndex: number, shape: InkShape): void;
  onSelect(selection: PageSelection | null): void;
  onPageChange?(index: number): void;
  /** Two-finger tap, the usual "undo" shortcut in note apps. */
  onUndo?(): void;
  /** The pen (or finger) touched a page with a writing tool, and lifted again. */
  onInkStart?(): void;
  onInkEnd?(): void;
  /** A screen strip covered by a floating video: pages are placed in the free width beside it. */
  avoid?: { side: "left" | "right"; width: number } | null;
}

type Interaction =
  | { kind: "idle" }
  | { kind: "navigate"; start: NotebookView }
  | { kind: "draw"; pageIndex: number; points: InkPoint[]; realPressure: boolean };

const SELECTION = "#A13D27";
/** The surface pages lie on: a shade darker than the UI so white paper reads as paper. */
const DESK = { light: "#E7E5E4", dark: "#0C0A09" } as const;

/**
 * Pages stacked vertically like a scrolling notebook. The pen writes on the page under it;
 * one finger scrolls (when stylus-only is on), two fingers pinch-zoom and pan. Every page is
 * recorded once into a Skia picture, so only the stroke being written re-renders per move.
 */
export const NotebookCanvas = forwardRef<NotebookCanvasHandle, NotebookCanvasProps>(
  function NotebookCanvas(props, ref) {
    const { notebook, tool, color, width, selection } = props;
    const { t } = useI18n();
    const { mode } = useTheme();
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [view, setView] = useState<NotebookView | null>(null);
    const [live, setLive] = useState<{ pageIndex: number; points: InkPoint[] } | null>(null);
    const interaction = useRef<Interaction>({ kind: "idle" });
    const pinchStart = useRef<{ view: NotebookView; focal: { x: number; y: number } } | null>(null);
    const propsRef = useRef(props);
    propsRef.current = props;
    const offsets = useMemo(() => pageOffsets(notebook), [notebook]);
    const content = useMemo(
      () => ({ width: notebook.pageWidth, height: notebookHeight(notebook) }),
      [notebook],
    );
    const viewRef = useRef<NotebookView | null>(null);
    viewRef.current = view;
    const lastPage = useRef(0);

    const updateView = (next: NotebookView) => {
      const clamped = clampView(next, size, content);
      setView(clamped);
      const page = visiblePageIndex(clamped, size.height, offsets);
      if (page !== lastPage.current) {
        lastPage.current = page;
        propsRef.current.onPageChange?.(page);
      }
    };

    useImperativeHandle(
      ref,
      () => ({
        scrollToPage(index: number) {
          const current = viewRef.current;
          const top = offsets[index];
          if (!current || top === undefined) return;
          updateView({ ...current, dy: 16 - top * current.scale });
        },
      }),
      [offsets, size, content],
    );

    const onLayout = (event: LayoutChangeEvent) => {
      const { width: layoutWidth, height: layoutHeight } = event.nativeEvent.layout;
      const previous = viewRef.current;
      // Keep the page centred when the canvas resizes (rotation, split screen, page rail).
      setView(
        previous
          ? centreInFree(
              { ...previous, dx: previous.dx + (layoutWidth - size.width) / 2 },
              layoutWidth,
              notebook.pageWidth,
              props.avoid ?? null,
            )
          : fitWidth(layoutWidth, notebook.pageWidth, props.avoid ?? null),
      );
      setSize({ width: layoutWidth, height: layoutHeight });
    };

    // A video docked over one side moves the page into the free width (and back when it closes).
    const avoidKey = props.avoid ? `${props.avoid.side}:${props.avoid.width}` : "";
    useEffect(() => {
      const previous = viewRef.current;
      if (!previous || size.width === 0) return;
      setView(centreInFree(previous, size.width, notebook.pageWidth, props.avoid ?? null));
    }, [avoidKey]);

    const pageAt = (x: number, y: number) => {
      const current = viewRef.current;
      if (!current) return null;
      const point = toNotebook(current, x, y);
      return locatePoint(propsRef.current.notebook, point.x, point.y);
    };

    const pageLocal = (pageIndex: number, x: number, y: number) => {
      const current = viewRef.current!;
      const point = toNotebook(current, x, y);
      const top = pageOffsets(propsRef.current.notebook)[pageIndex] ?? 0;
      const page = propsRef.current.notebook.pages[pageIndex]!;
      return {
        x: Math.min(propsRef.current.notebook.pageWidth, Math.max(0, point.x)),
        y: Math.min(page.height, Math.max(0, point.y - top)),
      };
    };

    const finish = (cancelled: boolean) => {
      const current = interaction.current;
      interaction.current = { kind: "idle" };
      setLive(null);
      if (current.kind === "draw") propsRef.current.onInkEnd?.();
      if (current.kind !== "draw" || cancelled) return;
      const { pageIndex, points } = current;
      const activeTool = propsRef.current.tool;
      const last = points.at(-1);
      if (!last) return;
      if (activeTool === "eraser") {
        propsRef.current.onErase(pageIndex, last, true);
        return;
      }
      if (activeTool === "select" || activeTool === "lasso") {
        const document = pageDocument(propsRef.current.notebook, pageIndex);
        const picked =
          activeTool === "lasso"
            ? selectLasso(document, points)
            : selectRectangle(document, boundsOf(points));
        propsRef.current.onSelect(
          picked.strokeIds.length + picked.shapeIds.length > 0
            ? { pageIndex, selection: picked }
            : null,
        );
        return;
      }
      if (isShapeTool(activeTool)) {
        const first = points[0]!;
        if (Math.hypot(last.x - first.x, last.y - first.y) < 4) return;
        propsRef.current.onShape(pageIndex, {
          id: `shape-${Date.now()}`,
          kind: activeTool,
          color: propsRef.current.color,
          width: propsRef.current.width,
          opacity: 1,
          from: first,
          to: last,
          filled: false,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      if (points.length > 1) propsRef.current.onStroke(pageIndex, points);
    };

    const draw = useMemo(
      () =>
        Gesture.Pan()
          .maxPointers(1)
          .minDistance(0)
          .runOnJS(true)
          .onBegin((event) => {
            const current = propsRef.current;
            const pen = event.pointerType === PointerType.STYLUS;
            // With pen-only on, a finger scrolls instead of drawing; selecting still works by touch.
            const touchSelects = current.tool === "select" || current.tool === "lasso";
            const navigate =
              current.tool === "pan" || (current.stylusOnly && !pen && !touchSelects);
            if (navigate) {
              interaction.current = viewRef.current
                ? { kind: "navigate", start: viewRef.current }
                : { kind: "idle" };
              return;
            }
            const hit = pageAt(event.x, event.y);
            if (!hit) {
              interaction.current = { kind: "idle" };
              return;
            }
            const point = {
              x: hit.x,
              y: hit.y,
              pressure: pen ? pressureOf(event.stylusData?.pressure) : 0.5,
            };
            interaction.current = {
              kind: "draw",
              pageIndex: hit.pageIndex,
              points: [point],
              realPressure: pen,
            };
            current.onInkStart?.();
            if (current.tool === "eraser") current.onErase(hit.pageIndex, point, false);
          })
          .onUpdate((event) => {
            const current = interaction.current;
            if (current.kind === "navigate") {
              updateView({
                ...current.start,
                dx: current.start.dx + event.translationX,
                dy: current.start.dy + event.translationY,
              });
              return;
            }
            if (current.kind !== "draw") return;
            const local = pageLocal(current.pageIndex, event.x, event.y);
            const point = {
              ...local,
              pressure: current.realPressure ? pressureOf(event.stylusData?.pressure) : 0.5,
            };
            const previous = current.points.at(-1)!;
            if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.6) return;
            current.points.push(point);
            if (propsRef.current.tool === "eraser") {
              propsRef.current.onErase(current.pageIndex, point, false);
              return;
            }
            setLive({ pageIndex: current.pageIndex, points: current.points });
          })
          .onEnd(() => finish(false))
          .onFinalize((_event, success) => {
            if (interaction.current.kind !== "idle") finish(!success);
          }),
      // The gesture reads the latest props through propsRef; it only depends on layout.
      [size, content, offsets],
    );

    const pinch = useMemo(
      () =>
        Gesture.Pinch()
          .runOnJS(true)
          .onStart((event) => {
            if (!viewRef.current) return;
            pinchStart.current = {
              view: viewRef.current,
              focal: { x: event.focalX, y: event.focalY },
            };
          })
          .onUpdate((event) => {
            const start = pinchStart.current;
            if (!start) return;
            updateView(
              pinchView(start.view, start.focal, { x: event.focalX, y: event.focalY }, event.scale),
            );
          })
          .onFinalize(() => {
            pinchStart.current = null;
          }),
      [size, content, offsets],
    );

    const undoTap = useMemo(
      () =>
        // Native handlers compensate the centroid jump when the second finger lands, so the
        // small maxDistance only rejects real movement (pinches). RNGH's web handler mis-tracks
        // a lifted pointer, so this shortcut does not fire in a browser.
        Gesture.Tap()
          .minPointers(2)
          .maxDuration(250)
          .maxDistance(12)
          .runOnJS(true)
          .onEnd((_event, success) => {
            if (success) propsRef.current.onUndo?.();
          }),
      [],
    );

    const gesture = useMemo(
      () => Gesture.Simultaneous(draw, pinch, undoTap),
      [draw, pinch, undoTap],
    );
    const range = view ? visibleRange(view, size.height) : null;

    return (
      <View
        style={[styles.container, { backgroundColor: DESK[mode] }]}
        onLayout={onLayout}
        accessible
        accessibilityLabel={t("drawing.canvasA11y")}
      >
        <GestureDetector gesture={gesture}>
          <Canvas style={styles.canvas}>
            {view && range ? (
              <Group
                transform={[
                  { translateX: view.dx },
                  { translateY: view.dy },
                  { scale: view.scale },
                ]}
              >
                {notebook.pages.map((page, index) => {
                  const top = offsets[index]!;
                  if (top > range.bottom || top + page.height < range.top) return null;
                  return (
                    <PageLayer
                      key={page.id}
                      page={page}
                      paper={notebook.paper}
                      width={notebook.pageWidth}
                      top={top}
                    />
                  );
                })}
                {live ? (
                  <LiveLayer
                    tool={tool}
                    color={color}
                    width={width}
                    points={live.points}
                    top={offsets[live.pageIndex] ?? 0}
                  />
                ) : null}
                {selection ? (
                  <SelectionLayer
                    selection={selection.selection}
                    top={offsets[selection.pageIndex] ?? 0}
                  />
                ) : null}
              </Group>
            ) : null}
          </Canvas>
        </GestureDetector>
      </View>
    );
  },
);

const PageLayer = memo(function PageLayer({
  page,
  paper,
  width,
  top,
}: {
  page: InkPage;
  paper: InkNotebook["paper"];
  width: number;
  top: number;
}) {
  const picture = useMemo(() => recordPage(page, paper, width), [page, paper, width]);
  return (
    <Group transform={[{ translateY: top }]}>
      <Rect x={-1} y={-1} width={width + 2} height={page.height + 2} color="#00000014" />
      <Picture picture={picture} />
    </Group>
  );
});

function LiveLayer({
  tool,
  color,
  width,
  points,
  top,
}: {
  tool: NotebookTool;
  color: string;
  width: number;
  points: readonly InkPoint[];
  top: number;
}) {
  const path = useMemo(() => {
    if (tool === "pen" || tool === "highlighter") {
      return outlinePath(
        strokeOutline(points, width, {
          highlighter: tool === "highlighter",
          realPressure: points.some((point) => point.pressure !== 0.5),
          complete: false,
        }),
      );
    }
    const line = Skia.Path.Make();
    const first = points[0];
    if (!first) return line;
    if (tool === "select") {
      const bounds = boundsOf(points);
      line.addRect(
        Skia.XYWHRect(
          bounds.left,
          bounds.top,
          bounds.right - bounds.left,
          bounds.bottom - bounds.top,
        ),
      );
      return line;
    }
    line.moveTo(first.x, first.y);
    for (const point of points.slice(1)) line.lineTo(point.x, point.y);
    return line;
  }, [points, tool, width]);

  const last = points.at(-1);
  if (isShapeTool(tool) && points[0] && last) {
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording();
    drawShape(canvas, {
      id: "live",
      kind: tool,
      color,
      width,
      opacity: 1,
      from: points[0],
      to: last,
      filled: false,
      createdAt: "",
    });
    return (
      <Group transform={[{ translateY: top }]}>
        <Picture picture={recorder.finishRecordingAsPicture()} />
      </Group>
    );
  }
  const stroke = tool === "lasso" || tool === "select";
  return (
    <Group transform={[{ translateY: top }]}>
      <Path
        path={path}
        color={stroke ? SELECTION : color}
        style={stroke ? "stroke" : "fill"}
        strokeWidth={stroke ? 1.5 : 0}
        opacity={tool === "highlighter" ? 0.35 : 1}
      />
    </Group>
  );
}

function SelectionLayer({ selection, top }: { selection: InkSelection; top: number }) {
  const { left, top: boxTop, right, bottom } = selection.bounds;
  return (
    <Group transform={[{ translateY: top }]}>
      <Rect
        x={left - 6}
        y={boxTop - 6}
        width={right - left + 12}
        height={bottom - boxTop + 12}
        color={SELECTION}
        style="stroke"
        strokeWidth={1.5}
      />
    </Group>
  );
}

function isShapeTool(tool: NotebookTool): tool is InkShapeKind {
  return tool === "line" || tool === "arrow" || tool === "rectangle" || tool === "ellipse";
}

function boundsOf(points: readonly InkPoint[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/** S Pen pressure is 0–1; a hovering or missing value falls back to a medium line. */
function pressureOf(value: number | undefined): number {
  if (value === undefined || value < 0) return 0.5;
  return Math.min(1, Math.max(0.05, value));
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden" },
  canvas: { flex: 1 },
});
