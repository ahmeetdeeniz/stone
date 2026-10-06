/** A lecture video the mini player can show: a YouTube video or a direct video file link. */
export type VideoSource =
  | { kind: "youtube"; id: string; url: string; start: number }
  | { kind: "direct"; url: string; start: number };

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const YOUTUBE_ID = /^[\w-]{11}$/u;
const DIRECT_EXTENSIONS = /\.(mp4|m4v|webm|mov|m3u8|ogv)$/iu;

/**
 * Understands the links people paste: youtu.be/ID, youtube.com/watch?v=ID, /embed/ID, /shorts/ID,
 * /live/ID (with an optional `t`/`start` offset), and direct http(s) links to video files.
 */
export function parseVideoUrl(input: string): VideoSource | null {
  const text = input.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][\w+.-]*:/iu.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const start = parseOffset(url.searchParams.get("t") ?? url.searchParams.get("start"));
  let id: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") id = url.searchParams.get("v");
    else if (first === "embed" || first === "shorts" || first === "live" || first === "v")
      id = second ?? null;
  } else if (DIRECT_EXTENSIONS.test(url.pathname)) {
    return { kind: "direct", url: url.toString(), start };
  }
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return { kind: "youtube", id, url: `https://www.youtube.com/watch?v=${id}`, start };
}

/** "90", "90s", "1m30s", "1h2m3s" → seconds. Anything else is 0. */
export function parseOffset(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/u.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/u.exec(value);
  if (!match || match[0] === "") return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

export const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2, 0.75] as const;

export function nextRate(rate: number): number {
  const index = PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]);
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length]!;
}

/**
 * The page the player WebView loads. Both kinds expose the same `window.stone` commands and post
 * the same messages ({type: "ready" | "state" | "time" | "error"}), so the dock doesn't care
 * which one it is showing.
 */
export function playerHtml(source: VideoSource, options: { start: number; rate: number }): string {
  const start = Math.max(0, Math.floor(options.start));
  const shared = `
const post = (message) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(message));
let lastTime = -1;
const tick = (time) => { if (Math.abs(time - lastTime) >= 0.5) { lastTime = time; post({ type: "time", time }); } };`;
  const head = `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#player,video{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
</head><body>`;
  if (source.kind === "direct") {
    return `${head}<video id="player" src=${JSON.stringify(source.url)} playsinline preload="metadata"></video>
<script>${shared}
const video = document.getElementById("player");
video.addEventListener("loadedmetadata", () => { video.currentTime = ${start}; video.playbackRate = ${options.rate}; post({ type: "ready", duration: video.duration || 0 }); });
video.addEventListener("play", () => post({ type: "state", playing: true }));
video.addEventListener("pause", () => post({ type: "state", playing: false }));
video.addEventListener("timeupdate", () => tick(video.currentTime));
video.addEventListener("error", () => post({ type: "error", code: "media" }));
window.stone = {
  play: () => video.play().catch(() => post({ type: "state", playing: false })),
  pause: () => video.pause(),
  seekBy: (delta) => { video.currentTime = Math.max(0, video.currentTime + delta); },
  rate: (rate) => { video.playbackRate = rate; },
};
</script></body></html>`;
  }
  return `${head}<div id="player"></div>
<script>${shared}
let player = null;
function onYouTubeIframeAPIReady() {
  player = new YT.Player("player", {
    videoId: ${JSON.stringify(source.id)},
    playerVars: { playsinline: 1, start: ${start}, rel: 0, modestbranding: 1, fs: 0, origin: location.origin },
    events: {
      onReady: () => { player.setPlaybackRate(${options.rate}); post({ type: "ready", duration: player.getDuration() }); },
      onStateChange: (event) => post({ type: "state", playing: event.data === 1 }),
      onError: (event) => post({ type: "error", code: event.data }),
    },
  });
  setInterval(() => { if (player && player.getCurrentTime) tick(player.getCurrentTime()); }, 1000);
}
window.stone = {
  play: () => player && player.playVideo(),
  pause: () => player && player.pauseVideo(),
  seekBy: (delta) => player && player.seekTo(Math.max(0, player.getCurrentTime() + delta), true),
  rate: (rate) => player && player.setPlaybackRate(rate),
};
</script>
<script src="https://www.youtube.com/iframe_api"></script>
</body></html>`;
}
