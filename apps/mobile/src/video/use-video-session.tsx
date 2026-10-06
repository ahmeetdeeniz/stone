import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Linking, Modal, Pressable, StyleSheet, View } from "react-native";
import { ActionSheet, StoneButton, StoneInput, StoneText } from "../components/ui";
import { useTheme } from "../design/theme";
import { radii, spacing } from "../design/tokens";
import { useI18n } from "../i18n/provider";
import { VideoDock, type VideoDockHandle } from "./VideoDock";
import {
  DEFAULT_VIDEO_PREFS,
  dockSize,
  reservationFor,
  type Bounds,
  type VideoItemState,
  type VideoPrefs,
  type VideoReservation,
} from "./video-layout";
import { parseVideoUrl } from "./video-source";
import { readVideoItem, readVideoPrefs, writeVideoItem, writeVideoPrefs } from "./video-store";

/** Seconds between saves of the playback position while the video plays. */
const POSITION_SAVE_INTERVAL = 10;
/** Pause-while-writing resumes this long after the pen lifts. */
const RESUME_DELAY_MS = 1500;

export interface VideoSession {
  /** The dock is showing. */
  open: boolean;
  /** A video is linked to this note or notebook on this device. */
  linked: boolean;
  /** Opens the dock (asking for a link first if none), or closes it. */
  toggle: () => void;
  /** Screen strip covered by the dock or by another app's floating window, if any. */
  reservation: VideoReservation | null;
  /** The dock and its sheets; render inside the container whose size is `bounds`. */
  element: ReactNode;
  /** Pen down: pause if the user asked for that. */
  writingStarted: () => void;
  /** Pen up: resume a video that writing paused. */
  writingEnded: () => void;
}

/**
 * Everything a note or notebook screen needs for its lecture video: the link remembered for this
 * item, the floating dock, and the space it (or an external pop-up window) takes up.
 */
export function useVideoSession(itemId: string | undefined, bounds: Bounds): VideoSession {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<VideoPrefs>(DEFAULT_VIDEO_PREFS);
  const [item, setItem] = useState<VideoItemState | null>(null);
  const [open, setOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const dockRef = useRef<VideoDockHandle>(null);
  const itemRef = useRef(item);
  itemRef.current = item;
  const savedAt = useRef(0);
  const autoPaused = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void readVideoPrefs().then(setPrefs);
  }, []);

  useEffect(() => {
    setOpen(false);
    setItem(null);
    if (!itemId) return;
    let active = true;
    void readVideoItem(itemId).then((stored) => {
      if (active) setItem(stored);
    });
    return () => {
      active = false;
    };
  }, [itemId]);

  const persistItem = useCallback(
    (next: VideoItemState | null) => {
      if (itemId) void writeVideoItem(itemId, next).catch(() => undefined);
    },
    [itemId],
  );

  // Leaving the screen keeps the position for next time.
  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      if (itemRef.current) persistItem(itemRef.current);
    },
    [persistItem],
  );

  const updatePrefs = (patch: Partial<VideoPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      void writeVideoPrefs(next).catch(() => undefined);
      return next;
    });
  };

  const source = item ? parseVideoUrl(item.url) : null;
  const dock = dockSize(prefs.size, bounds);
  const reservation =
    open && source
      ? reservationFor(prefs.dockCorner, dock)
      : prefs.externalCorner !== "none"
        ? reservationFor(prefs.externalCorner, dock)
        : null;

  const close = () => {
    setOpen(false);
    if (itemRef.current) persistItem(itemRef.current);
  };

  const element = (
    <>
      {open && source && bounds.width > 0 ? (
        <VideoDock
          ref={dockRef}
          key={source.url}
          source={source}
          start={item?.position || source.start}
          rate={item?.rate ?? 1}
          corner={prefs.dockCorner}
          size={prefs.size}
          bounds={bounds}
          onCorner={(dockCorner) => updatePrefs({ dockCorner })}
          onSize={(size) => updatePrefs({ size })}
          onRate={(rate) => {
            const next = item ? { ...item, rate } : null;
            setItem(next);
            persistItem(next);
          }}
          onTime={(position) => {
            const current = itemRef.current;
            if (!current) return;
            const next = { ...current, position };
            itemRef.current = next;
            if (Math.abs(position - savedAt.current) >= POSITION_SAVE_INTERVAL) {
              savedAt.current = position;
              setItem(next);
              persistItem(next);
            }
          }}
          onMore={() => setMoreOpen(true)}
          onClose={close}
        />
      ) : null}
      <VideoLinkSheet
        visible={linkOpen}
        initial={item?.url ?? ""}
        onClose={() => setLinkOpen(false)}
        onSubmit={(url) => {
          const parsed = parseVideoUrl(url);
          if (!parsed) return;
          const next = { url: parsed.url, position: parsed.start, rate: item?.rate ?? 1 };
          savedAt.current = parsed.start;
          setItem(next);
          persistItem(next);
          setLinkOpen(false);
          setOpen(true);
        }}
      />
      <ActionSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        options={[
          {
            label: t("video.changeLink"),
            icon: "link-outline",
            onPress: () => setLinkOpen(true),
          },
          ...(source
            ? [
                {
                  label:
                    source.kind === "youtube" ? t("video.openYouTube") : t("video.openBrowser"),
                  icon: "open-outline" as const,
                  onPress: () => void Linking.openURL(source.url),
                },
              ]
            : []),
          {
            label: t("video.unlink"),
            icon: "trash-outline",
            destructive: true,
            onPress: () => {
              setOpen(false);
              setItem(null);
              persistItem(null);
            },
          },
        ]}
      />
    </>
  );

  return {
    open: open && source !== null,
    linked: source !== null,
    toggle: () => {
      if (open) close();
      else if (source) setOpen(true);
      else setLinkOpen(true);
    },
    reservation,
    element,
    writingStarted: () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      resumeTimer.current = null;
      if (!prefs.pauseWhileWriting || !open) return;
      if (dockRef.current?.pause()) autoPaused.current = true;
    },
    writingEnded: () => {
      if (!autoPaused.current) return;
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      resumeTimer.current = setTimeout(() => {
        autoPaused.current = false;
        dockRef.current?.play();
      }, RESUME_DELAY_MS);
    },
  };
}

function VideoLinkSheet({
  visible,
  initial,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  initial: string;
  onClose: () => void;
  onSubmit: (url: string) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setValue(initial);
      setError(null);
    }
  }, [initial, visible]);
  const submit = () => {
    if (!parseVideoUrl(value)) {
      setError(t("video.invalidLink"));
      return;
    }
    onSubmit(value);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <StoneText variant="title3">{t("video.linkTitle")}</StoneText>
          <StoneText variant="caption" tone="secondary">
            {t("video.linkDetail")}
          </StoneText>
          <StoneInput
            label={t("video.linkField")}
            value={value}
            onChangeText={(next) => {
              setValue(next);
              setError(null);
            }}
            placeholder="https://youtu.be/…"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            autoFocus
            onSubmitEditing={submit}
            {...(error ? { error } : {})}
          />
          <View style={styles.actions}>
            <StoneButton label={t("common.cancel")} variant="quiet" onPress={onClose} />
            <StoneButton label={t("video.open")} onPress={submit} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: {
    width: "100%",
    maxWidth: 480,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
});
