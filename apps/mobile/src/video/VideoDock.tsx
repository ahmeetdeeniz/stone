import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Animated, Linking, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StoneButton, StoneText } from "../components/ui";
import { useTheme } from "../design/theme";
import { radii, spacing } from "../design/tokens";
import { useI18n } from "../i18n/provider";
import {
  DOCK_CONTROLS,
  cornerPosition,
  dockSize,
  nearestCorner,
  VIDEO_SIZES,
  type Bounds,
  type VideoCorner,
  type VideoSize,
} from "./video-layout";
import { formatClock, nextRate, playerHtml, type VideoSource } from "./video-source";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

/**
 * Origin the player page claims. YouTube refuses embeds whose page has no http(s) origin
 * (inline HTML would otherwise load as about:blank), so the page gets a neutral https one.
 */
const PLAYER_ORIGIN = "https://stone.invalid";

export interface VideoDockHandle {
  /** Pauses playback and reports whether it was playing (to resume it later). */
  pause: () => boolean;
  play: () => void;
}

export interface VideoDockProps {
  source: VideoSource;
  /** Where playback starts, in seconds (the last position on this device). */
  start: number;
  rate: number;
  corner: VideoCorner;
  size: VideoSize;
  /** The area the dock floats over. */
  bounds: Bounds;
  onCorner: (corner: VideoCorner) => void;
  onSize: (size: VideoSize) => void;
  onRate: (rate: number) => void;
  onTime: (seconds: number) => void;
  onMore: () => void;
  onClose: () => void;
}

type PlayerMessage =
  | { type: "ready"; duration: number }
  | { type: "state"; playing: boolean }
  | { type: "time"; time: number }
  | { type: "error"; code: number | string };

/**
 * A small video window over the note or notebook. Drag it by its control row; it settles in the
 * nearest corner. The player keeps running while you write underneath it.
 */
export const VideoDock = forwardRef<VideoDockHandle, VideoDockProps>(
  function VideoDock(props, ref) {
    const { source, start, rate, corner, size, bounds } = props;
    const { colors } = useTheme();
    const { t } = useI18n();
    const webView = useRef<WebView>(null);
    const [playing, setPlaying] = useState(false);
    const [time, setTime] = useState(start);
    const [failed, setFailed] = useState(false);
    const playingRef = useRef(false);
    const propsRef = useRef(props);
    propsRef.current = props;

    const dock = dockSize(size, bounds);
    const home = cornerPosition(corner, dock, bounds);
    const position = useRef(new Animated.ValueXY(home)).current;
    useEffect(() => {
      Animated.spring(position, { toValue: home, useNativeDriver: true, bounciness: 4 }).start();
    }, [home.x, home.y, position]);

    // The page is built once per video: rate and position changes go through commands instead of
    // reloading the WebView (which would restart the video).
    const html = useMemo(() => playerHtml(source, { start, rate }), [source.url]);

    const run = (command: string) =>
      webView.current?.injectJavaScript(`window.stone && window.stone.${command}; true;`);

    useImperativeHandle(ref, () => ({
      pause() {
        const wasPlaying = playingRef.current;
        if (wasPlaying) run("pause()");
        return wasPlaying;
      },
      play() {
        run("play()");
      },
    }));

    const onMessage = (event: WebViewMessageEvent) => {
      let message: PlayerMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as PlayerMessage;
      } catch {
        return;
      }
      if (message.type === "state") {
        playingRef.current = message.playing;
        setPlaying(message.playing);
      } else if (message.type === "time") {
        setTime(message.time);
        propsRef.current.onTime(message.time);
      } else if (message.type === "error") {
        setFailed(true);
      } else if (message.type === "ready") {
        setFailed(false);
      }
    };

    const drag = Gesture.Pan()
      .runOnJS(true)
      .minDistance(8)
      .onUpdate((event) => {
        position.setValue({ x: home.x + event.translationX, y: home.y + event.translationY });
      })
      .onEnd((event) => {
        const dropped = { x: home.x + event.translationX, y: home.y + event.translationY };
        const next = nearestCorner(dropped, dock, bounds);
        if (next !== corner) propsRef.current.onCorner(next);
        else Animated.spring(position, { toValue: home, useNativeDriver: true }).start();
      });

    const compact = dock.width < 340;
    const videoHeight = dock.height - DOCK_CONTROLS;
    const nextSize = VIDEO_SIZES[(VIDEO_SIZES.indexOf(size) + 1) % VIDEO_SIZES.length]!;

    return (
      <Animated.View
        style={[
          styles.dock,
          {
            width: dock.width,
            height: dock.height,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            transform: position.getTranslateTransform(),
          },
        ]}
      >
        <View style={[styles.video, { height: videoHeight }]}>
          <WebView
            ref={webView}
            source={{ html, baseUrl: PLAYER_ORIGIN }}
            originWhitelist={["*"]}
            onMessage={onMessage}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            allowsFullscreenVideo={false}
            setSupportMultipleWindows={false}
            scrollEnabled={false}
            style={styles.webView}
          />
          {failed ? (
            <View style={[styles.failed, { backgroundColor: "#000000E0" }]}>
              <StoneText variant="caption" style={styles.failedText}>
                {t("video.cannotPlay")}
              </StoneText>
              {source.kind === "youtube" ? (
                <StoneButton
                  label={t("video.openYouTube")}
                  variant="secondary"
                  onPress={() => void Linking.openURL(source.url)}
                />
              ) : null}
            </View>
          ) : null}
        </View>
        <GestureDetector gesture={drag}>
          <View
            style={[styles.controls, { borderTopColor: colors.border }]}
            accessibilityHint={t("video.dragHint")}
          >
            <DockButton
              icon={playing ? "pause" : "play"}
              label={playing ? t("video.pause") : t("video.play")}
              onPress={() => run(playing ? "pause()" : "play()")}
            />
            <DockButton
              icon="rewind-10"
              label={t("video.back10")}
              onPress={() => run("seekBy(-10)")}
            />
            <DockButton
              icon="fast-forward-10"
              label={t("video.forward10")}
              onPress={() => run("seekBy(10)")}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("video.speed", { rate })}
              onPress={() => {
                const next = nextRate(rate);
                run(`rate(${next})`);
                props.onRate(next);
              }}
              style={styles.rate}
            >
              <StoneText variant="label" tone="secondary">
                {`${rate}×`}
              </StoneText>
            </Pressable>
            {compact ? null : (
              <StoneText variant="caption" tone="muted" style={styles.clock}>
                {formatClock(time)}
              </StoneText>
            )}
            <View style={styles.spacer} />
            <DockButton
              icon={size === "l" ? "arrow-collapse" : "arrow-expand"}
              label={t("video.resize")}
              onPress={() => props.onSize(nextSize)}
            />
            <DockButton icon="dots-horizontal" label={t("common.more")} onPress={props.onMore} />
            <DockButton icon="close" label={t("video.close")} onPress={props.onClose} />
          </View>
        </GestureDetector>
      </Animated.View>
    );
  },
);

function DockButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.55 : 1 }]}
    >
      <MaterialCommunityIcons name={icon} size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: 0,
    top: 0,
    zIndex: 20,
    elevation: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  video: { backgroundColor: "#000" },
  webView: { flex: 1, backgroundColor: "#000" },
  failed: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  failedText: { color: "#FFFFFF", textAlign: "center" },
  controls: {
    height: DOCK_CONTROLS,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: { width: 34, height: 36, alignItems: "center", justifyContent: "center" },
  rate: { minWidth: 40, height: 36, alignItems: "center", justifyContent: "center" },
  clock: { marginLeft: spacing.xs, fontVariant: ["tabular-nums"] },
  spacer: { flex: 1 },
});
