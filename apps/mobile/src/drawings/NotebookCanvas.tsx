import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet, TextInput, View, type LayoutChangeEvent } from "react-native";
import { Canvas, Circle, Group, Path, Picture, Rect, Skia } from "@shopify/react-native-skia";
import { Gesture, GestureDetector, PointerType } from "react-native-gesture-handler";
import {
  locatePoint,
  notebookHeight,
  objectAt,
  recognizeShape,
  pageDocument,
  pageOffsets,
  selectLasso,
  selectRectangle,
  type InkImage,
  type InkNotebook,
  type InkPage,
  type InkPageObject,
  type InkPoint,
  type InkSelection,
  type InkShape,
  type InkShapeKind,
  type InkText,
  type InkTool,
  type RecognizedShape,
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
import { drawShape, NO_ASSETS, outlinePath, recordPage, type PageAssets } from "./page-picture";
import { lineHeightFor } from "./text-layout";

export type NotebookTool = InkTool | InkShapeKind | "select" | "lasso" | "pan" | "text";

/** A photo or text box picked with the selection tools. */
export interface ObjectSelection {
  pageIndex: number;
  kind: InkPageObject["kind"];
  id: string;
}

/** A text box being typed into, shown as an inline editor over the page. */
export interface EditingText {
  pageIndex: number;
  text: InkText;
}

/** How long the pen must rest at the end of a stroke before it snaps to a shape. */
const SNAP_HOLD_MS = 450;

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
  /** Decoded photos and the text typeface; pages re-record when they change. */
  assets?: PageAssets;
  objectSelection?: ObjectSelection | null;
  onObjectSelect?(selection: ObjectSelection | null): void;
  /** A selected photo or text box was dragged or resized. */
  onObjectChange?(pageIndex: number, object: InkPageObject): void;
  /** The text tool tapped a page: on an existing text box, or on empty paper to add one. */
  onTextTap?(pageIndex: number, point: { x: number; y: number }, existing: InkText | null): void;
  editingText?: EditingText | null;
  onEditingTextChange?(value: string): void;
  onEditingTextDone?(): void;
}

type Interaction =
  | { kind: "idle" }
  | { kind: "navigate"; start: NotebookView }
  | {
      kind: "draw";
      pageIndex: number;
      points: InkPoint[];
      realPressure: boolean;
      /** Where the pen last rested (the hold timer restarts when it moves away). */
      anchor: InkPoint;
      snapped: RecognizedShape | null;
    }
  | {
      kind: "object";
      mode: "move" | "resize";
      pageIndex: number;
      object: InkPageObject;
      box: Box;
    }
  | { kind: "tap"; pageIndex: number; start: { x: number; y: number }; moved: boolean };

type Box = { x: number; y: number; width: number; height: number };

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
    const [live, setLive] = useState<{
      pageIndex: number;
      points: InkPoint[];
      snapped: RecognizedShape | null;
    } | null>(null);
    const [dragBox, setDragBox] = useState<{ pageIndex: number; box: Box } | null>(null);
    const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = null;
      setLive(null);
      setDragBox(null);
      const latest = propsRef.current;
      if (current.kind === "object") {
        const { object, box } = current;
        const changed =
          box.x !== object.object.x ||
          box.y !== object.object.y ||
          box.width !== object.object.width ||
          box.height !== object.object.height;
        if (!cancelled && changed)
          latest.onObjectChange?.(current.pageIndex, {
            ...object,
            object: { ...object.object, ...box },
          } as InkPageObject);
        return;
      }
      if (current.kind === "tap") {
        if (cancelled || current.moved) return;
        const page = latest.notebook.pages[current.pageIndex];
        const hit = page ? objectAt(page, current.start.x, current.start.y, 4) : null;
        latest.onTextTap?.(
          current.pageIndex,
          current.start,
          hit?.kind === "text" ? hit.object : null,
        );
        return;
      }
      if (current.kind === "draw") latest.onInkEnd?.();
      if (current.kind !== "draw" || cancelled) return;
      const { pageIndex, points } = current;
      const activeTool = latest.tool;
      const last = points.at(-1);
      if (!last) return;
      if (activeTool === "eraser") {
        latest.onErase(pageIndex, last, true);
        return;
      }
      if (activeTool === "select" || activeTool === "lasso") {
        const bounds = boundsOf(points);
        const page = latest.notebook.pages[pageIndex];
        // A tap (not a loop) picks the photo or text box under it.
        if (bounds.right - bounds.left < 8 && bounds.bottom - bounds.top < 8 && page) {
          const hit = objectAt(page, last.x, last.y, 4);
          latest.onSelect(null);
          latest.onObjectSelect?.(hit ? { pageIndex, kind: hit.kind, id: hit.object.id } : null);
          return;
        }
        const document = pageDocument(latest.notebook, pageIndex);
        const picked =
          activeTool === "lasso"
            ? selectLasso(document, points)
            : selectRectangle(document, bounds);
        latest.onObjectSelect?.(null);
        latest.onSelect(
          picked.strokeIds.length + picked.shapeIds.length > 0
            ? { pageIndex, selection: picked }
            : null,
        );
        return;
      }
      if (current.snapped) {
        latest.onShape(pageIndex, {
          id: `shape-${Date.now()}`,
          kind: current.snapped.kind,
          color: latest.color,
          width: latest.width,
          opacity: 1,
          from: current.snapped.from,
          to: current.snapped.to,
          filled: false,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      if (isShapeTool(activeTool)) {
        const first = points[0]!;
        if (Math.hypot(last.x - first.x, last.y - first.y) < 4) return;
        propsRef.current.onShape(pageIndex, {
          id: `shape-${Date.now()}`,
          kind: activeTool,
          color: latest.color,
          width: latest.width,
          opacity: 1,
          from: first,
          to: last,
          filled: false,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      if (points.length > 1) latest.onStroke(pageIndex, points);
    };

    /** The pen rested at the end of a stroke: snap it to a shape if it looks like one. */
    const trySnap = () => {
      holdTimer.current = null;
      const current = interaction.current;
      if (current.kind !== "draw" || current.snapped || propsRef.current.tool !== "pen") return;
      const shape = recognizeShape(current.points);
      if (!shape) return;
      current.snapped = shape;
      setLive({ pageIndex: current.pageIndex, points: current.points, snapped: shape });
    };

    /** The selected photo or text box, when it sits on this page. */
    const selectedObject = (pageIndex: number): InkPageObject | null => {
      const selected = propsRef.current.objectSelection;
      if (!selected || selected.pageIndex !== pageIndex) return null;
      const page = propsRef.current.notebook.pages[pageIndex];
      const object =
        selected.kind === "image"
          ? page?.images?.find((item) => item.id === selected.id)
          : page?.texts?.find((item) => item.id === selected.id);
      if (!object) return null;
      return selected.kind === "image"
        ? { kind: "image", object: object as InkImage }
        : { kind: "text", object: object as InkText };
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
            const touchSelects =
              current.tool === "select" || current.tool === "lasso" || current.tool === "text";
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
            if (current.tool === "select" || current.tool === "lasso") {
              const selected = selectedObject(hit.pageIndex);
              if (selected) {
                const box = boxOf(selected.object);
                const scale = viewRef.current?.scale ?? 1;
                const handle = 22 / scale;
                const onHandle =
                  Math.hypot(hit.x - (box.x + box.width), hit.y - (box.y + box.height)) <= handle;
                const inside =
                  hit.x >= box.x &&
                  hit.x <= box.x + box.width &&
                  hit.y >= box.y &&
                  hit.y <= box.y + box.height;
                if (onHandle || inside) {
                  interaction.current = {
                    kind: "object",
                    mode: onHandle ? "resize" : "move",
                    pageIndex: hit.pageIndex,
                    object: selected,
                    box,
                  };
                  return;
                }
              }
            }
            if (current.tool === "text") {
              interaction.current = {
                kind: "tap",
                pageIndex: hit.pageIndex,
                start: { x: hit.x, y: hit.y },
                moved: false,
              };
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
              anchor: point,
              snapped: null,
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
            const scale = viewRef.current?.scale ?? 1;
            if (current.kind === "tap") {
              if (Math.hypot(event.translationX, event.translationY) > 10) current.moved = true;
              return;
            }
            if (current.kind === "object") {
              const dx = event.translationX / scale;
              const dy = event.translationY / scale;
              const start = boxOf(current.object.object);
              const page = propsRef.current.notebook.pages[current.pageIndex];
              const moved =
                current.mode === "move"
                  ? { ...start, x: start.x + dx, y: start.y + dy }
                  : resizedBox(current.object, start, dx);
              current.box = page
                ? keepOnPage(moved, propsRef.current.notebook.pageWidth, page.height)
                : moved;
              setDragBox({ pageIndex: current.pageIndex, box: current.box });
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
            if (current.snapped) {
              // After a snap the stroke is a shape; a line still follows the pen to its end.
              if (current.snapped.kind === "line") {
                current.snapped = { ...current.snapped, to: point };
                setLive({
                  pageIndex: current.pageIndex,
                  points: current.points,
                  snapped: current.snapped,
                });
              }
              return;
            }
            current.points.push(point);
            if (propsRef.current.tool === "eraser") {
              propsRef.current.onErase(current.pageIndex, point, false);
              return;
            }
            if (
              propsRef.current.tool === "pen" &&
              Math.hypot(point.x - current.anchor.x, point.y - current.anchor.y) > 3 / scale
            ) {
              current.anchor = point;
              if (holdTimer.current) clearTimeout(holdTimer.current);
              holdTimer.current = setTimeout(trySnap, SNAP_HOLD_MS);
            }
            setLive({ pageIndex: current.pageIndex, points: current.points, snapped: null });
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
                      assets={props.assets ?? NO_ASSETS}
                      hiddenTextId={
                        props.editingText?.pageIndex === index ? props.editingText.text.id : null
                      }
                    />
                  );
                })}
                {live ? (
                  <LiveLayer
                    tool={tool}
                    color={color}
                    width={width}
                    points={live.points}
                    snapped={live.snapped}
                    top={offsets[live.pageIndex] ?? 0}
                  />
                ) : null}
                {props.objectSelection ? (
                  <ObjectSelectionLayer
                    box={
                      dragBox && dragBox.pageIndex === props.objectSelection.pageIndex
                        ? dragBox.box
                        : selectedBox(notebook, props.objectSelection)
                    }
                    dragging={dragBox !== null}
                    scale={view.scale}
                    top={offsets[props.objectSelection.pageIndex] ?? 0}
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
        {props.editingText && view ? (
          <TextBoxEditor
            editing={props.editingText}
            view={view}
            top={offsets[props.editingText.pageIndex] ?? 0}
            onChange={(value) => props.onEditingTextChange?.(value)}
            onDone={() => props.onEditingTextDone?.()}
          />
        ) : null}
      </View>
    );
  },
);

/** Inline editor for a text box, laid over the page at the box's position and zoom. */
function TextBoxEditor({
  editing,
  view,
  top,
  onChange,
  onDone,
}: {
  editing: EditingText;
  view: NotebookView;
  top: number;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
  const { text } = editing;
  const fontSize = text.size * view.scale;
  return (
    <TextInput
      value={text.text}
      onChangeText={onChange}
      onBlur={onDone}
      autoFocus
      multiline
      scrollEnabled={false}
      style={[
        styles.textEditor,
        {
          left: view.dx + text.x * view.scale,
          top: view.dy + (top + text.y) * view.scale,
          width: text.width * view.scale,
          minHeight: lineHeightFor(text.size) * view.scale,
          fontSize,
          lineHeight: lineHeightFor(text.size) * view.scale,
          color: text.color,
        },
      ]}
    />
  );
}

function ObjectSelectionLayer({
  box,
  dragging,
  scale,
  top,
}: {
  box: Box | null;
  dragging: boolean;
  scale: number;
  top: number;
}) {
  if (!box) return null;
  const pad = 4 / scale;
  return (
    <Group transform={[{ translateY: top }]}>
      {dragging ? (
        <Rect x={box.x} y={box.y} width={box.width} height={box.height} color="#A13D2722" />
      ) : null}
      <Rect
        x={box.x - pad}
        y={box.y - pad}
        width={box.width + pad * 2}
        height={box.height + pad * 2}
        color={SELECTION}
        style="stroke"
        strokeWidth={1.5 / scale}
      />
      <Circle cx={box.x + box.width} cy={box.y + box.height} r={8 / scale} color={SELECTION} />
      <Circle cx={box.x + box.width} cy={box.y + box.height} r={5 / scale} color="#FFFFFF" />
    </Group>
  );
}

const PageLayer = memo(function PageLayer({
  page,
  paper,
  width,
  top,
  assets,
  hiddenTextId,
}: {
  page: InkPage;
  paper: InkNotebook["paper"];
  width: number;
  top: number;
  assets: PageAssets;
  /** The text box being edited inline is left out, so it isn't drawn twice. */
  hiddenTextId: string | null;
}) {
  const picture = useMemo(
    () =>
      recordPage(
        hiddenTextId
          ? { ...page, texts: (page.texts ?? []).filter((text) => text.id !== hiddenTextId) }
          : page,
        paper,
        width,
        assets,
      ),
    [page, paper, width, assets, hiddenTextId],
  );
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
  snapped,
  top,
}: {
  tool: NotebookTool;
  color: string;
  width: number;
  points: readonly InkPoint[];
  snapped: RecognizedShape | null;
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
  const shape = snapped
    ? snapped
    : isShapeTool(tool) && points[0] && last
      ? { kind: tool, from: points[0], to: last }
      : null;
  if (shape) {
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording();
    drawShape(canvas, {
      id: "live",
      kind: shape.kind,
      color,
      width,
      opacity: 1,
      from: shape.from,
      to: shape.to,
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

function boxOf(object: InkImage | InkText): Box {
  return { x: object.x, y: object.y, width: object.width, height: object.height };
}

function selectedBox(notebook: InkNotebook, selected: ObjectSelection): Box | null {
  const page = notebook.pages[selected.pageIndex];
  const object =
    selected.kind === "image"
      ? page?.images?.find((item) => item.id === selected.id)
      : page?.texts?.find((item) => item.id === selected.id);
  return object ? boxOf(object) : null;
}

/** Keeps a photo or text box on its page (shrinking one that is larger than the page). */
function keepOnPage(box: Box, pageWidth: number, pageHeight: number): Box {
  const ratio = Math.min(1, pageWidth / box.width, pageHeight / box.height);
  const width = box.width * ratio;
  const height = box.height * ratio;
  return {
    width,
    height,
    x: Math.min(Math.max(0, box.x), pageWidth - width),
    y: Math.min(Math.max(0, box.y), pageHeight - height),
  };
}

/** Dragging the corner handle: photos keep their aspect; text boxes only change wrap width. */
function resizedBox(object: InkPageObject, start: Box, dx: number): Box {
  if (object.kind === "text") return { ...start, width: Math.max(60, start.width + dx) };
  const width = Math.max(24, start.width + dx);
  return { ...start, width, height: (width * start.height) / start.width };
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
  textEditor: {
    position: "absolute",
    padding: 0,
    margin: 0,
    fontFamily: "Inter_400Regular",
    textAlignVertical: "top",
    backgroundColor: "#FFFFFFB3",
    borderWidth: 1,
    borderColor: SELECTION,
    borderStyle: "dashed",
  },
});
