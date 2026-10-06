import { describe, expect, it } from "vitest";
import { formatClock, nextRate, parseOffset, parseVideoUrl, playerHtml } from "./video-source";
import {
  barPadding,
  columnPadding,
  cornerPosition,
  dockSize,
  nearestCorner,
  parseVideoItem,
  parseVideoPrefs,
  reservationFor,
} from "./video-layout";

describe("video links", () => {
  it("understands the YouTube links people paste", () => {
    const id = "dQw4w9WgXcQ";
    for (const link of [
      `https://youtu.be/${id}`,
      `youtu.be/${id}?si=abc`,
      `https://www.youtube.com/watch?v=${id}&list=PL1`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}`,
    ])
      expect(parseVideoUrl(link)).toEqual({
        kind: "youtube",
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
        start: 0,
      });
    expect(parseVideoUrl(`https://youtu.be/${id}?t=1m30s`)?.start).toBe(90);
    expect(parseVideoUrl(`https://www.youtube.com/watch?v=${id}&t=75`)?.start).toBe(75);
  });

  it("accepts direct video files and rejects everything else", () => {
    expect(parseVideoUrl("https://lms.example.edu/rec/lecture-3.mp4")).toEqual({
      kind: "direct",
      url: "https://lms.example.edu/rec/lecture-3.mp4",
      start: 0,
    });
    expect(parseVideoUrl("")).toBeNull();
    expect(parseVideoUrl("not a link")).toBeNull();
    expect(parseVideoUrl("https://example.com/page")).toBeNull();
    expect(parseVideoUrl("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseVideoUrl("javascript:alert(1)")).toBeNull();
    expect(parseVideoUrl("file:///sdcard/a.mp4")).toBeNull();
  });

  it("formats offsets, clocks and speeds", () => {
    expect(parseOffset("1h2m3s")).toBe(3723);
    expect(parseOffset("45s")).toBe(45);
    expect(parseOffset("abc")).toBe(0);
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(nextRate(1)).toBe(1.25);
    expect(nextRate(0.75)).toBe(1);
    expect(nextRate(3)).toBe(1);
  });

  it("builds a player page that escapes the link", () => {
    const html = playerHtml(
      { kind: "direct", url: 'https://x.test/a".mp4', start: 0 },
      { start: 12.7, rate: 1.5 },
    );
    expect(html).toContain('src="https://x.test/a\\".mp4"');
    expect(html).toContain("video.currentTime = 12");
    const youtube = playerHtml(
      { kind: "youtube", id: "dQw4w9WgXcQ", url: "", start: 0 },
      { start: 0, rate: 1 },
    );
    expect(youtube).toContain('videoId: "dQw4w9WgXcQ"');
    expect(youtube).toContain("https://www.youtube.com/iframe_api");
  });
});

describe("video dock layout", () => {
  const tablet = { width: 1480, height: 860 };

  it("sizes the dock 16:9 with its controls and keeps it on small screens", () => {
    expect(dockSize("m", tablet)).toEqual({ width: 380, height: 214 + 44 });
    expect(dockSize("l", { width: 400, height: 800 }).width).toBe(240);
  });

  it("snaps to the nearest corner", () => {
    const dock = dockSize("m", tablet);
    expect(cornerPosition("top-right", dock, tablet)).toEqual({ x: 1480 - 380 - 12, y: 12 });
    expect(cornerPosition("bottom-left", dock, tablet)).toEqual({ x: 12, y: 860 - 258 - 12 });
    expect(nearestCorner({ x: 100, y: 500 }, dock, tablet)).toBe("bottom-left");
    expect(nearestCorner({ x: 900, y: 10 }, dock, tablet)).toBe("top-right");
  });

  it("pads top bars away from a video at the top, but not on a phone", () => {
    const reservation = reservationFor("top-left", dockSize("m", tablet));
    expect(reservation).toEqual({ side: "left", width: 404, height: 282, top: true });
    expect(barPadding(reservation, 1480)).toEqual({ paddingLeft: 404 });
    expect(barPadding(reservation, 600)).toEqual({});
    expect(barPadding(reservationFor("bottom-right", dockSize("m", tablet)), 1480)).toEqual({});
    expect(columnPadding(reservationFor("bottom-right", dockSize("m", tablet)), 1480)).toEqual({
      paddingRight: 404,
    });
    expect(columnPadding(reservation, 900)).toEqual({});
    expect(columnPadding(null, 1480)).toEqual({});
  });

  it("reads stored preferences defensively", () => {
    expect(parseVideoPrefs(null).externalCorner).toBe("none");
    expect(parseVideoPrefs('{"externalCorner":"top-left","size":"x"}')).toMatchObject({
      externalCorner: "top-left",
      size: "m",
    });
    expect(parseVideoPrefs("{oops")).toEqual(parseVideoPrefs(null));
    expect(parseVideoItem('{"url":"https://youtu.be/dQw4w9WgXcQ","position":-3,"rate":9}')).toEqual(
      { url: "https://youtu.be/dQw4w9WgXcQ", position: 0, rate: 1 },
    );
    expect(parseVideoItem('{"position":3}')).toBeNull();
  });
});
