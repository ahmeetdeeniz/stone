import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import { StyleSheet, View } from "react-native";
import { Canvas, Group, Line, Oval, Path, Rect, Skia } from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  flatToPoints,
  selectLasso,
  selectRectangle,
  type InkDocument,
  type InkPoint,
  type InkSelection,
  type InkShape,
  type InkShapeKind,
  type InkTool,
} from "@stone/ink";
import { useI18n } from "../i18n/provider";

export type InkCanvasTool = InkTool | InkShapeKind | "select" | "lasso" | "pan";

export interface InkCanvasHandle {
  capturePreview(): Uint8Array | null;
}

export interface InkCanvasProps {
  document: InkDocument;
  tool: InkCanvasTool;
  color: string;
  width: number;
  stylusOnly: boolean;
  selection?: InkSelection | null;
  onStroke: (points: readonly InkPoint[]) => void;
  onErase: (point: InkPoint) => void;
  onShape: (shape: InkShape) => void;
  onSelect: (selection: InkSelection) => void;
}

export const InkCanvas = forwardRef<InkCanvasHandle, InkCanvasProps>(function InkCanvas(
  { document, tool, color, width, stylusOnly, selection, onStroke, onErase, onShape, onSelect },
  ref,
) {
  const { t } = useI18n();
  const canvasRef = useRef<ComponentRef<typeof Canvas>>(null);
  const activePoints = useRef<InkPoint[]>([]);
  const activeStylus = useRef(true);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  useImperativeHandle(
    ref,
    () => ({
      capturePreview: () => {
        const image = (
          canvasRef.current as unknown as {
            makeImageSnapshot?: () => { encodeToBytes?: () => Uint8Array };
          } | null
        )?.makeImageSnapshot?.();
        return image?.encodeToBytes?.() ?? null;
      },
    }),
    [],
  );

  const finishStroke = (point: InkPoint) => {
    if (!activeStylus.current) return;
    if (tool === "select" || tool === "lasso") {
      const polygon = [...activePoints.current, point];
      onSelect(
        tool === "lasso"
          ? selectLasso(document, polygon)
          : selectRectangle(document, boundsFromPoints(polygon)),
      );
      activePoints.current = [];
      return;
    }
    if (tool === "pan") {
      activePoints.current = [];
      return;
    }
    const first = activePoints.current[0];
    if (first && isShapeTool(tool)) {
      onShape({
        id: `shape-${Date.now()}`,
        kind: tool,
        color,
        width,
        opacity: 1,
        from: first,
        to: point,
        filled: false,
        createdAt: new Date().toISOString(),
      });
      activePoints.current = [];
      return;
    }
    activePoints.current.push(point);
    if (tool === "eraser") onErase(point);
    else onStroke(activePoints.current);
    activePoints.current = [];
  };

  const addPoint = (point: InkPoint) => {
    if (!activeStylus.current) return;
    if (tool === "select" || tool === "lasso" || tool === "pan") return;
    if (tool === "eraser") onErase(point);
    else activePoints.current.push(point);
  };

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .runOnJS(true)
        .onBegin((event) => {
          const pointerType = (event as unknown as { pointerType?: number }).pointerType;
          activeStylus.current =
            !stylusOnly ||
            pointerType === 2 ||
            tool === "pan" ||
            tool === "select" ||
            tool === "lasso";
          activePoints.current = activeStylus.current
            ? [
                {
                  x: event.x,
                  y: event.y,
                  pressure: clampPressure((event as unknown as { pressure?: number }).pressure),
                },
              ]
            : [];
        })
        .onUpdate((event) => {
          if (tool === "pan") {
            setPanOffset({ x: event.translationX, y: event.translationY });
            return;
          }
          addPoint({
            x: event.x,
            y: event.y,
            pressure: clampPressure((event as unknown as { pressure?: number }).pressure),
          });
        })
        .onEnd((event) => {
          finishStroke({
            x: event.x,
            y: event.y,
            pressure: clampPressure((event as unknown as { pressure?: number }).pressure),
          });
        }),
    [color, document, onErase, onSelect, onShape, onStroke, stylusOnly, tool, width],
  );
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onUpdate((event) => setZoom(Math.min(4, Math.max(0.5, event.scale)))),
    [],
  );
  const gesture = useMemo(() => Gesture.Simultaneous(pan, pinch), [pan, pinch]);

  return (
    <View style={styles.container} accessible accessibilityLabel={t("drawing.canvasA11y")}>
      <GestureDetector gesture={gesture}>
        <Canvas ref={canvasRef} style={styles.canvas}>
          <Group
            transform={[{ translateX: panOffset.x }, { translateY: panOffset.y }, { scale: zoom }]}
          >
            <Rect
              x={0}
              y={0}
              width={document.width}
              height={document.height}
              color={document.background}
            />
            {document.strokes.map((stroke) => (
              <StrokePath key={stroke.id} stroke={stroke} />
            ))}
            {document.shapes.map((shape) => (
              <Shape key={shape.id} shape={shape} />
            ))}
            {selection && (selection.strokeIds.length > 0 || selection.shapeIds.length > 0) ? (
              <SelectionOverlay selection={selection} />
            ) : null}
          </Group>
        </Canvas>
      </GestureDetector>
    </View>
  );
});

function StrokePath({ stroke }: { stroke: InkDocument["strokes"][number] }) {
  const points = flatToPoints(stroke.points);
  const path = Skia.Path.Make();
  const first = points[0];
  if (!first) return null;
  path.moveTo(first.x, first.y);
  for (const point of points.slice(1)) path.lineTo(point.x, point.y);
  const pressure = points.reduce((sum, point) => sum + point.pressure, 0) / points.length;
  return (
    <Path
      path={path}
      color={stroke.color}
      style="stroke"
      strokeWidth={stroke.width * (0.55 + pressure * 0.45)}
      strokeCap="round"
      strokeJoin="round"
      opacity={stroke.tool === "highlighter" ? stroke.opacity * 0.35 : stroke.opacity}
    />
  );
}

function Shape({ shape }: { shape: InkDocument["shapes"][number] }) {
  const left = Math.min(shape.from.x, shape.to.x);
  const top = Math.min(shape.from.y, shape.to.y);
  const shapeWidth = Math.abs(shape.to.x - shape.from.x);
  const shapeHeight = Math.abs(shape.to.y - shape.from.y);
  const props = {
    color: shape.color,
    style: shape.filled ? ("fill" as const) : ("stroke" as const),
    strokeWidth: shape.width,
    opacity: shape.opacity,
  };
  if (shape.kind === "line" || shape.kind === "arrow")
    return (
      <Line
        p1={{ x: shape.from.x, y: shape.from.y }}
        p2={{ x: shape.to.x, y: shape.to.y }}
        {...props}
      />
    );
  if (shape.kind === "ellipse")
    return <Oval x={left} y={top} width={shapeWidth} height={shapeHeight} {...props} />;
  return <Rect x={left} y={top} width={shapeWidth} height={shapeHeight} {...props} />;
}

function SelectionOverlay({ selection }: { selection: InkSelection }) {
  const { left, top, right, bottom } = selection.bounds;
  const handleSize = 10;
  const handle = { color: "#B56B3C", style: "fill" as const };
  return (
    <>
      <Rect
        x={left}
        y={top}
        width={Math.max(0, right - left)}
        height={Math.max(0, bottom - top)}
        color="#B56B3C"
        style="stroke"
        strokeWidth={2}
      />
      <Rect
        x={left - handleSize / 2}
        y={top - handleSize / 2}
        width={handleSize}
        height={handleSize}
        {...handle}
      />
      <Rect
        x={right - handleSize / 2}
        y={top - handleSize / 2}
        width={handleSize}
        height={handleSize}
        {...handle}
      />
      <Rect
        x={left - handleSize / 2}
        y={bottom - handleSize / 2}
        width={handleSize}
        height={handleSize}
        {...handle}
      />
      <Rect
        x={right - handleSize / 2}
        y={bottom - handleSize / 2}
        width={handleSize}
        height={handleSize}
        {...handle}
      />
    </>
  );
}

function isShapeTool(tool: InkCanvasTool): tool is InkShapeKind {
  return tool === "line" || tool === "arrow" || tool === "rectangle" || tool === "ellipse";
}

function boundsFromPoints(points: readonly InkPoint[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function clampPressure(value: number | undefined): number {
  return Math.min(1, Math.max(0, value ?? 1));
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden" },
  canvas: { flex: 1 },
});
