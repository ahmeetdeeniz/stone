export const INK_SCHEMA_VERSION = 1 as const;
export const INK_POINT_STRIDE = 3 as const;

export type InkTool = "pen" | "highlighter" | "eraser";
export type InkShapeKind = "line" | "arrow" | "rectangle" | "ellipse";
export type InkSelectionMode = "lasso" | "rectangle";

export interface InkPoint {
  x: number;
  y: number;
  pressure: number;
}

export interface InkStroke {
  id: string;
  tool: Exclude<InkTool, "eraser">;
  color: string;
  width: number;
  opacity: number;
  points: readonly number[];
  createdAt: string;
}

export interface InkShape {
  id: string;
  kind: InkShapeKind;
  color: string;
  width: number;
  opacity: number;
  from: InkPoint;
  to: InkPoint;
  filled: boolean;
  createdAt: string;
}

export interface InkDocument {
  schema: typeof INK_SCHEMA_VERSION;
  id: string;
  title: string;
  width: number;
  height: number;
  background: string;
  strokes: readonly InkStroke[];
  shapes: readonly InkShape[];
  updatedAt: string;
}

export interface InkBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface InkSelection {
  strokeIds: readonly string[];
  shapeIds: readonly string[];
  bounds: InkBounds;
}

export interface InkTransform {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
}

export class InkValidationError extends Error {
  public override readonly name = "InkValidationError";
}

export function createEmptyInk(input: {
  id: string;
  title: string;
  width: number;
  height: number;
  background?: string;
  now?: string;
}): InkDocument {
  const now = input.now ?? new Date().toISOString();
  const document: InkDocument = {
    schema: INK_SCHEMA_VERSION,
    id: requireText(input.id, "id", 160),
    title: requireText(input.title, "title", 200),
    width: requireDimension(input.width, "width"),
    height: requireDimension(input.height, "height"),
    background: requireColor(input.background ?? "#FFFFFF"),
    strokes: [],
    shapes: [],
    updatedAt: now,
  };
  return document;
}

export function parseInk(source: string): InkDocument {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new InkValidationError("Invalid Stone Ink JSON.");
  }
  return validateInk(value);
}

export function serializeInk(document: InkDocument): string {
  return `${JSON.stringify(validateInk(document))}\n`;
}

export function validateInk(value: unknown): InkDocument {
  if (!isRecord(value) || value.schema !== INK_SCHEMA_VERSION) {
    throw new InkValidationError("Unsupported Stone Ink schema version.");
  }
  const strokes = value.strokes;
  const shapes = value.shapes;
  if (!Array.isArray(strokes) || !Array.isArray(shapes))
    throw new InkValidationError("Ink layers are invalid.");
  const document: InkDocument = {
    schema: INK_SCHEMA_VERSION,
    id: requireText(value.id, "id", 160),
    title: requireText(value.title, "title", 200),
    width: requireDimension(value.width, "width"),
    height: requireDimension(value.height, "height"),
    background: requireColor(value.background),
    strokes: strokes.map(validateStroke),
    shapes: shapes.map(validateShape),
    updatedAt: requireText(value.updatedAt, "updatedAt", 80),
  };
  if (document.strokes.length + document.shapes.length > 10_000)
    throw new InkValidationError("Ink document contains too many objects.");
  return document;
}

export function pointsToFlat(points: readonly InkPoint[]): readonly number[] {
  const flat: number[] = [];
  for (const point of points) flat.push(point.x, point.y, clamp(point.pressure, 0, 1));
  return flat;
}

export function flatToPoints(points: readonly number[]): readonly InkPoint[] {
  if (points.length % INK_POINT_STRIDE !== 0)
    throw new InkValidationError("Stroke point data is invalid.");
  const result: InkPoint[] = [];
  for (let index = 0; index < points.length; index += INK_POINT_STRIDE) {
    result.push({
      x: points[index]!,
      y: points[index + 1]!,
      pressure: clamp(points[index + 2]!, 0, 1),
    });
  }
  return result;
}

export function simplifyPoints(points: readonly InkPoint[], tolerance = 0.75): readonly InkPoint[] {
  if (points.length <= 2) return points;
  const result: InkPoint[] = [points[0]!];
  const squaredTolerance = Math.max(0.01, tolerance) ** 2;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = result.at(-1)!;
    const current = points[index]!;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    if (dx * dx + dy * dy >= squaredTolerance) result.push(current);
  }
  result.push(points.at(-1)!);
  return result;
}

export function addStroke(
  document: InkDocument,
  stroke: Omit<InkStroke, "points"> & { points: readonly InkPoint[] },
  now = new Date().toISOString(),
): InkDocument {
  const points = simplifyPoints(stroke.points);
  if (points.length < 2) return document;
  const next: InkStroke = {
    ...stroke,
    points: pointsToFlat(points),
    width: requirePositive(stroke.width, "width"),
    opacity: clamp(stroke.opacity, 0, 1),
  };
  return touch({ ...document, strokes: [...document.strokes, next] }, now);
}

export function addShape(
  document: InkDocument,
  shape: InkShape,
  now = new Date().toISOString(),
): InkDocument {
  return touch({ ...document, shapes: [...document.shapes, validateShape(shape)] }, now);
}

export function strokeBounds(stroke: InkStroke): InkBounds {
  return pointsBounds(flatToPoints(stroke.points), stroke.width / 2);
}

export function shapeBounds(shape: InkShape): InkBounds {
  return pointsBounds([shape.from, shape.to], shape.width / 2);
}

export function selectRectangle(document: InkDocument, bounds: InkBounds): InkSelection {
  const normalized = normalizeBounds(bounds);
  const strokeIds = document.strokes
    .filter((stroke) => intersects(strokeBounds(stroke), normalized))
    .map((stroke) => stroke.id);
  const shapeIds = document.shapes
    .filter((shape) => intersects(shapeBounds(shape), normalized))
    .map((shape) => shape.id);
  return { strokeIds, shapeIds, bounds: selectionBounds(document, strokeIds, shapeIds) };
}

export function selectLasso(document: InkDocument, polygon: readonly InkPoint[]): InkSelection {
  if (polygon.length < 3) return { strokeIds: [], shapeIds: [], bounds: emptyBounds() };
  const center = (bounds: InkBounds): InkPoint => ({
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
    pressure: 1,
  });
  const strokeIds = document.strokes
    .filter((stroke) => pointInPolygon(center(strokeBounds(stroke)), polygon))
    .map((stroke) => stroke.id);
  const shapeIds = document.shapes
    .filter((shape) => pointInPolygon(center(shapeBounds(shape)), polygon))
    .map((shape) => shape.id);
  return { strokeIds, shapeIds, bounds: selectionBounds(document, strokeIds, shapeIds) };
}

export function transformSelection(
  document: InkDocument,
  selection: InkSelection,
  transform: InkTransform,
  now = new Date().toISOString(),
): InkDocument {
  const strokeIds = new Set(selection.strokeIds);
  const shapeIds = new Set(selection.shapeIds);
  const strokes = document.strokes.map((stroke) =>
    strokeIds.has(stroke.id)
      ? { ...stroke, points: transformFlatPoints(stroke.points, transform) }
      : stroke,
  );
  const shapes = document.shapes.map((shape) =>
    shapeIds.has(shape.id)
      ? {
          ...shape,
          from: transformPoint(shape.from, transform),
          to: transformPoint(shape.to, transform),
        }
      : shape,
  );
  return touch({ ...document, strokes, shapes }, now);
}

export function duplicateSelection(
  document: InkDocument,
  selection: InkSelection,
  idFactory: () => string,
  offset = 24,
  now = new Date().toISOString(),
): InkDocument {
  const strokeIds = new Set(selection.strokeIds);
  const shapeIds = new Set(selection.shapeIds);
  const strokes = document.strokes
    .filter((stroke) => strokeIds.has(stroke.id))
    .map((stroke) => ({
      ...stroke,
      id: idFactory(),
      points: transformFlatPoints(stroke.points, {
        translateX: offset,
        translateY: offset,
        scaleX: 1,
        scaleY: 1,
      }),
      createdAt: now,
    }));
  const shapes = document.shapes
    .filter((shape) => shapeIds.has(shape.id))
    .map((shape) => ({
      ...shape,
      id: idFactory(),
      from: { ...shape.from, x: shape.from.x + offset, y: shape.from.y + offset },
      to: { ...shape.to, x: shape.to.x + offset, y: shape.to.y + offset },
      createdAt: now,
    }));
  return touch(
    {
      ...document,
      strokes: [...document.strokes, ...strokes],
      shapes: [...document.shapes, ...shapes],
    },
    now,
  );
}

export function deleteSelection(
  document: InkDocument,
  selection: InkSelection,
  now = new Date().toISOString(),
): InkDocument {
  const strokes = new Set(selection.strokeIds);
  const shapes = new Set(selection.shapeIds);
  return touch(
    {
      ...document,
      strokes: document.strokes.filter((stroke) => !strokes.has(stroke.id)),
      shapes: document.shapes.filter((shape) => !shapes.has(shape.id)),
    },
    now,
  );
}

export function eraseAt(
  document: InkDocument,
  point: InkPoint,
  radius: number,
  now = new Date().toISOString(),
): InkDocument {
  const safeRadius = requirePositive(radius, "radius");
  const strokes = document.strokes.filter(
    (stroke) =>
      !flatToPoints(stroke.points).some(
        (candidate) => distance(candidate, point) <= safeRadius + stroke.width / 2,
      ),
  );
  const shapes = document.shapes.filter(
    (shape) => !distanceToBounds(shapeBounds(shape), point, safeRadius),
  );
  return touch({ ...document, strokes, shapes }, now);
}

export function renderInkToSvg(document: InkDocument): string {
  const ink = validateInk(document);
  const strokeSvg = ink.strokes
    .map(
      (stroke) =>
        `<polyline points="${svgPoints(stroke.points)}" fill="none" stroke="${escapeXml(stroke.color)}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${stroke.opacity}"/>`,
    )
    .join("");
  const shapeSvg = ink.shapes.map((shape) => shapeToSvg(shape)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ink.width} ${ink.height}" width="${ink.width}" height="${ink.height}"><rect width="100%" height="100%" fill="${escapeXml(ink.background)}"/>${strokeSvg}${shapeSvg}</svg>`;
}

export class InkHistory {
  private readonly undoStack: InkDocument[] = [];
  private readonly redoStack: InkDocument[] = [];
  public constructor(
    private current: InkDocument,
    private readonly maxEntries = 100,
  ) {}
  public get value(): InkDocument {
    return this.current;
  }
  public commit(next: InkDocument): InkDocument {
    if (next === this.current) return this.current;
    this.undoStack.push(this.current);
    if (this.undoStack.length > this.maxEntries) this.undoStack.shift();
    this.current = next;
    this.redoStack.length = 0;
    return this.current;
  }
  public undo(): InkDocument {
    const previous = this.undoStack.pop();
    if (!previous) return this.current;
    this.redoStack.push(this.current);
    this.current = previous;
    return this.current;
  }
  public redo(): InkDocument {
    const next = this.redoStack.pop();
    if (!next) return this.current;
    this.undoStack.push(this.current);
    this.current = next;
    return this.current;
  }
  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}

function validateStroke(value: unknown): InkStroke {
  if (
    !isRecord(value) ||
    (value.tool !== "pen" && value.tool !== "highlighter") ||
    !Array.isArray(value.points)
  )
    throw new InkValidationError("Invalid Ink stroke.");
  const points = value.points.map((point) => requireFinite(point, "point"));
  flatToPoints(points);
  if (points.length < INK_POINT_STRIDE * 2)
    throw new InkValidationError("Ink strokes need at least two points.");
  return {
    id: requireText(value.id, "stroke id", 160),
    tool: value.tool,
    color: requireColor(value.color),
    width: requirePositive(value.width, "stroke width"),
    opacity: clamp(requireFinite(value.opacity, "opacity"), 0, 1),
    points,
    createdAt: requireText(value.createdAt, "stroke createdAt", 80),
  };
}

function validateShape(value: unknown): InkShape {
  if (!isRecord(value) || !["line", "arrow", "rectangle", "ellipse"].includes(String(value.kind)))
    throw new InkValidationError("Invalid Ink shape.");
  return {
    id: requireText(value.id, "shape id", 160),
    kind: value.kind as InkShapeKind,
    color: requireColor(value.color),
    width: requirePositive(value.width, "shape width"),
    opacity: clamp(requireFinite(value.opacity, "opacity"), 0, 1),
    from: validatePoint(value.from),
    to: validatePoint(value.to),
    filled: value.filled === true,
    createdAt: requireText(value.createdAt, "shape createdAt", 80),
  };
}

function validatePoint(value: unknown): InkPoint {
  if (!isRecord(value)) throw new InkValidationError("Invalid Ink point.");
  return {
    x: requireFinite(value.x, "x"),
    y: requireFinite(value.y, "y"),
    pressure: clamp(requireFinite(value.pressure, "pressure"), 0, 1),
  };
}
function pointsBounds(points: readonly InkPoint[], padding: number): InkBounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return normalizeBounds({
    left: Math.min(...xs) - padding,
    top: Math.min(...ys) - padding,
    right: Math.max(...xs) + padding,
    bottom: Math.max(...ys) + padding,
  });
}
function selectionBounds(
  document: InkDocument,
  strokeIds: readonly string[],
  shapeIds: readonly string[],
): InkBounds {
  const bounds = [
    ...document.strokes.filter((stroke) => strokeIds.includes(stroke.id)).map(strokeBounds),
    ...document.shapes.filter((shape) => shapeIds.includes(shape.id)).map(shapeBounds),
  ];
  return bounds.length === 0
    ? emptyBounds()
    : normalizeBounds({
        left: Math.min(...bounds.map((bound) => bound.left)),
        top: Math.min(...bounds.map((bound) => bound.top)),
        right: Math.max(...bounds.map((bound) => bound.right)),
        bottom: Math.max(...bounds.map((bound) => bound.bottom)),
      });
}
function normalizeBounds(bounds: InkBounds): InkBounds {
  return {
    left: Math.min(bounds.left, bounds.right),
    top: Math.min(bounds.top, bounds.bottom),
    right: Math.max(bounds.left, bounds.right),
    bottom: Math.max(bounds.top, bounds.bottom),
  };
}
function emptyBounds(): InkBounds {
  return { left: 0, top: 0, right: 0, bottom: 0 };
}
function intersects(left: InkBounds, right: InkBounds): boolean {
  return (
    left.left <= right.right &&
    left.right >= right.left &&
    left.top <= right.bottom &&
    left.bottom >= right.top
  );
}
function pointInPolygon(point: InkPoint, polygon: readonly InkPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]!,
      previousPoint = polygon[previous]!;
    const cross =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (cross) inside = !inside;
  }
  return inside;
}
function transformFlatPoints(
  points: readonly number[],
  transform: InkTransform,
): readonly number[] {
  const result = [...points];
  for (let index = 0; index < result.length; index += INK_POINT_STRIDE) {
    result[index] = result[index]! * transform.scaleX + transform.translateX;
    result[index + 1] = result[index + 1]! * transform.scaleY + transform.translateY;
  }
  return result;
}
function transformPoint(point: InkPoint, transform: InkTransform): InkPoint {
  return {
    ...point,
    x: point.x * transform.scaleX + transform.translateX,
    y: point.y * transform.scaleY + transform.translateY,
  };
}
function distance(left: InkPoint, right: InkPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
function distanceToBounds(bounds: InkBounds, point: InkPoint, padding: number): boolean {
  const dx = Math.max(bounds.left - point.x, 0, point.x - bounds.right);
  const dy = Math.max(bounds.top - point.y, 0, point.y - bounds.bottom);
  return Math.hypot(dx, dy) <= padding;
}
function touch(document: InkDocument, now: string): InkDocument {
  return { ...document, updatedAt: now };
}
function requireText(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max)
    throw new InkValidationError(`${name} is invalid.`);
  return value;
}
function requireFinite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new InkValidationError(`${name} is invalid.`);
  return value;
}
function requireDimension(value: unknown, name: string): number {
  const dimension = requireFinite(value, name);
  if (dimension <= 0 || dimension > 20_000) throw new InkValidationError(`${name} is invalid.`);
  return dimension;
}
function requirePositive(value: unknown, name: string): number {
  const number = requireFinite(value, name);
  if (number <= 0 || number > 1_000) throw new InkValidationError(`${name} is invalid.`);
  return number;
}
function requireColor(value: unknown): string {
  const color = requireText(value, "color", 32);
  if (!/^#[0-9A-F]{6,8}$/iu.test(color)) throw new InkValidationError("Color is invalid.");
  return color;
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function svgPoints(points: readonly number[]): string {
  return flatToPoints(points)
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
}
function shapeToSvg(shape: InkShape): string {
  const color = escapeXml(shape.color),
    opacity = shape.opacity,
    width = shape.width;
  if (shape.kind === "line")
    return `<line x1="${shape.from.x}" y1="${shape.from.y}" x2="${shape.to.x}" y2="${shape.to.y}" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`;
  if (shape.kind === "arrow")
    return `${shapeToSvg({ ...shape, kind: "line" })}${arrowHeadToSvg(shape, color, width, opacity)}`;
  if (shape.kind === "ellipse")
    return `<ellipse cx="${(shape.from.x + shape.to.x) / 2}" cy="${(shape.from.y + shape.to.y) / 2}" rx="${Math.abs(shape.to.x - shape.from.x) / 2}" ry="${Math.abs(shape.to.y - shape.from.y) / 2}" fill="${shape.filled ? color : "none"}" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`;
  return `<rect x="${Math.min(shape.from.x, shape.to.x)}" y="${Math.min(shape.from.y, shape.to.y)}" width="${Math.abs(shape.to.x - shape.from.x)}" height="${Math.abs(shape.to.y - shape.from.y)}" fill="${shape.filled ? color : "none"}" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`;
}
function arrowHeadToSvg(shape: InkShape, color: string, width: number, opacity: number): string {
  const angle = Math.atan2(shape.to.y - shape.from.y, shape.to.x - shape.from.x);
  const size = Math.max(width * 4, 10);
  const left = {
    x: shape.to.x - size * Math.cos(angle - Math.PI / 6),
    y: shape.to.y - size * Math.sin(angle - Math.PI / 6),
  };
  const right = {
    x: shape.to.x - size * Math.cos(angle + Math.PI / 6),
    y: shape.to.y - size * Math.sin(angle + Math.PI / 6),
  };
  return `<polyline points="${shape.to.x},${shape.to.y} ${left.x},${left.y} ${right.x},${right.y}" fill="none" stroke="${color}" stroke-width="${width}" opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}
