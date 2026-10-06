export type VideoCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type VideoSize = "s" | "m" | "l";
/** Where another app's floating window (Samsung pop-up view, picture-in-picture) sits, if any. */
export type ExternalCorner = "none" | "top-left" | "top-right";

export const VIDEO_CORNERS: readonly VideoCorner[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];
export const VIDEO_SIZES: readonly VideoSize[] = ["s", "m", "l"];
export const EXTERNAL_CORNERS: readonly ExternalCorner[] = ["none", "top-left", "top-right"];

const VIDEO_WIDTHS: Readonly<Record<VideoSize, number>> = { s: 280, m: 380, l: 500 };
/** Height of the dock's control row under the video. */
export const DOCK_CONTROLS = 44;
export const DOCK_INSET = 12;

export interface Bounds {
  width: number;
  height: number;
}

/** A 16:9 video plus its control row, never wider than 60 % of the space it floats over. */
export function dockSize(size: VideoSize, bounds: Bounds): { width: number; height: number } {
  const width = Math.max(
    160,
    Math.min(VIDEO_WIDTHS[size], bounds.width * 0.6, bounds.width - DOCK_INSET * 2),
  );
  return { width, height: Math.round((width * 9) / 16) + DOCK_CONTROLS };
}

export function cornerPosition(
  corner: VideoCorner,
  dock: { width: number; height: number },
  bounds: Bounds,
): { x: number; y: number } {
  const left = corner.endsWith("left");
  const top = corner.startsWith("top");
  return {
    x: left ? DOCK_INSET : Math.max(DOCK_INSET, bounds.width - dock.width - DOCK_INSET),
    y: top ? DOCK_INSET : Math.max(DOCK_INSET, bounds.height - dock.height - DOCK_INSET),
  };
}

/** The corner whose quadrant holds the dock's centre after a drag. */
export function nearestCorner(
  position: { x: number; y: number },
  dock: { width: number; height: number },
  bounds: Bounds,
): VideoCorner {
  const top = position.y + dock.height / 2 < bounds.height / 2;
  const left = position.x + dock.width / 2 < bounds.width / 2;
  return `${top ? "top" : "bottom"}-${left ? "left" : "right"}`;
}

/**
 * The strip of screen a floating video covers. Headers and tool rows pad away from it when the
 * video sits at the top, and the notebook page moves into the free width beside it.
 */
export interface VideoReservation {
  side: "left" | "right";
  width: number;
  height: number;
  top: boolean;
}

export function reservationFor(
  corner: VideoCorner,
  dock: { width: number; height: number },
): VideoReservation {
  return {
    side: corner.endsWith("left") ? "left" : "right",
    width: dock.width + DOCK_INSET * 2,
    height: dock.height + DOCK_INSET * 2,
    top: corner.startsWith("top"),
  };
}

/**
 * Padding a top bar needs so its buttons stay clear of a video at the top. A reservation that
 * would leave the bar narrower than `minFree` is ignored: on a phone the video just floats over.
 */
export function barPadding(
  reservation: VideoReservation | null,
  barWidth: number,
  minFree = 320,
): { paddingLeft?: number; paddingRight?: number } {
  if (!reservation || !reservation.top || barWidth - reservation.width < minFree) return {};
  return reservation.side === "left"
    ? { paddingLeft: reservation.width }
    : { paddingRight: reservation.width };
}

/**
 * Padding that moves a whole screen column (the note editor) beside the video, wherever it is
 * docked. Like `barPadding`, it gives up on screens too narrow to keep a usable column.
 */
export function columnPadding(
  reservation: VideoReservation | null,
  width: number,
  minFree = 600,
): { paddingLeft?: number; paddingRight?: number } {
  return barPadding(reservation && { ...reservation, top: true }, width, minFree);
}

export interface VideoPrefs {
  externalCorner: ExternalCorner;
  size: VideoSize;
  dockCorner: VideoCorner;
  pauseWhileWriting: boolean;
}

export const DEFAULT_VIDEO_PREFS: VideoPrefs = {
  externalCorner: "none",
  size: "m",
  dockCorner: "top-right",
  pauseWhileWriting: false,
};

export function parseVideoPrefs(raw: string | null): VideoPrefs {
  const value = parseJson(raw);
  return {
    externalCorner: EXTERNAL_CORNERS.includes(value.externalCorner as ExternalCorner)
      ? (value.externalCorner as ExternalCorner)
      : DEFAULT_VIDEO_PREFS.externalCorner,
    size: VIDEO_SIZES.includes(value.size as VideoSize)
      ? (value.size as VideoSize)
      : DEFAULT_VIDEO_PREFS.size,
    dockCorner: VIDEO_CORNERS.includes(value.dockCorner as VideoCorner)
      ? (value.dockCorner as VideoCorner)
      : DEFAULT_VIDEO_PREFS.dockCorner,
    pauseWhileWriting:
      typeof value.pauseWhileWriting === "boolean"
        ? value.pauseWhileWriting
        : DEFAULT_VIDEO_PREFS.pauseWhileWriting,
  };
}

/** The video linked to one note or notebook on this device, and where playback stopped. */
export interface VideoItemState {
  url: string;
  position: number;
  rate: number;
}

export function parseVideoItem(raw: string | null): VideoItemState | null {
  const value = parseJson(raw);
  if (typeof value.url !== "string" || !value.url) return null;
  const position =
    typeof value.position === "number" && Number.isFinite(value.position) && value.position > 0
      ? value.position
      : 0;
  const rate =
    typeof value.rate === "number" && value.rate >= 0.25 && value.rate <= 2 ? value.rate : 1;
  return { url: value.url, position, rate };
}

function parseJson(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
