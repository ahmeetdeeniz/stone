import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  addShape,
  addStroke,
  createEmptyInk,
  deleteSelection,
  duplicateSelection,
  eraseAt,
  InkHistory,
  parseInk,
  serializeInk,
  transformSelection,
  type InkDocument,
  type InkPoint,
  type InkSelection,
  type InkShape,
} from "@stone/ink";
import { ErrorState, LoadingState } from "../../src/components/states";
import { Screen, StoneButton, StoneInput, StoneText } from "../../src/components/ui";
import { useTheme } from "../../src/design/theme";
import { colors as tokens, hairline, radii, spacing } from "../../src/design/tokens";
import { InkCanvas, type InkCanvasHandle, type InkCanvasTool } from "../../src/drawings/InkCanvas";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import type { Drawing } from "@stone/domain";
import { useI18n } from "../../src/i18n/provider";

const colors = [
  tokens.brand.navy950,
  tokens.brand.purple600,
  tokens.status.danger,
  tokens.status.success,
  tokens.status.warning,
  tokens.status.info,
];
const widths = [2, 4, 8, 14];

export default function DrawingScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const { user } = useAuth();
  const { drawings, deviceId } = useAppServices();
  const { t } = useI18n();
  const canvasRef = useRef<InkCanvasHandle>(null);
  const historyRef = useRef<InkHistory | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [ink, setInk] = useState<InkDocument | null>(null);
  const [tool, setTool] = useState<InkCanvasTool>("pen");
  const [color, setColor] = useState(colors[1]!);
  const [width, setWidth] = useState(widths[1]!);
  const [stylusOnly, setStylusOnly] = useState(true);
  const [selection, setSelection] = useState<InkSelection | null>(null);
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const [title, setTitle] = useState(() => t("drawing.newTitle"));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !id) return;
    let active = true;
    const load = async () => {
      try {
        if (id === "new") {
          const now = new Date().toISOString();
          const nextId = Crypto.randomUUID();
          const nextInk = createEmptyInk({
            id: nextId,
            title: t("drawing.newTitle"),
            width: 900,
            height: 650,
            now,
          });
          const metadata: Drawing = {
            id: nextId,
            ownerId: user.uid,
            documentId: null,
            title: t("drawing.newTitle"),
            sourcePath: "",
            previewPath: "",
            sourceSha256: "",
            previewSha256: "",
            sourceSize: 0,
            previewSize: 0,
            revision: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            updatedByDeviceId: deviceId,
          };
          if (active) {
            setDrawing(metadata);
            setInk(nextInk);
            historyRef.current = new InkHistory(nextInk);
          }
          return;
        }
        const loaded = await drawings.getById(user.uid, id);
        if (!loaded) throw new Error(t("drawing.notFound"));
        const source = await new File(loaded.sourcePath).text();
        const nextInk = parseInk(source);
        if (active) {
          setDrawing(loaded);
          setTitle(loaded.title);
          setInk(nextInk);
          historyRef.current = new InkHistory(nextInk);
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : t("drawing.loadFailed"));
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [deviceId, drawings, id, user]);

  const commit = (next: InkDocument) => {
    historyRef.current?.commit(next);
    setInk(next);
  };

  const stroke = (points: readonly InkPoint[]) => {
    if (!ink || !drawing || (tool !== "pen" && tool !== "highlighter")) return;
    commit(
      addStroke(ink, {
        id: Crypto.randomUUID(),
        tool,
        color,
        width,
        opacity: 1,
        points,
        createdAt: new Date().toISOString(),
      }),
    );
  };

  const shape = (value: InkShape) => {
    if (!ink || !drawing) return;
    commit(addShape(ink, value));
  };

  const erase = (point: InkPoint) => {
    if (!ink || !drawing) return;
    commit(eraseAt(ink, point, width * 2));
  };

  const transform = (translateX: number, translateY: number, scaleX = 1, scaleY = 1) => {
    if (!ink || !selection) return;
    commit(transformSelection(ink, selection, { translateX, translateY, scaleX, scaleY }));
  };

  const save = useCallback(async () => {
    if (!drawing || !ink || !user) return;
    try {
      const directory = new Directory(Paths.document, "drawings");
      directory.create({ idempotent: true });
      const preview = new File(directory, `${drawing.id}.png`);
      const bytes = canvasRef.current?.capturePreview();
      if (!bytes) throw new Error(t("drawing.previewFailed"));
      preview.write(bytes);
      const next = await drawings.save(
        { ...drawing, title, revision: drawing.revision + (drawing.sourcePath ? 1 : 0) },
        serializeInk({ ...ink, title }),
        preview.uri,
        deviceId,
      );
      setDrawing(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("drawing.saveFailed"));
    }
  }, [deviceId, drawing, drawings, ink, title, user]);
  saveRef.current = save;

  useEffect(() => {
    if (!drawing || !ink) return;
    const timer = setTimeout(() => void saveRef.current(), 600);
    return () => clearTimeout(timer);
  }, [drawing?.id, ink, title]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") void saveRef.current();
    });
    return () => subscription.remove();
  }, []);

  if (error && !ink)
    return (
      <Screen>
        <ErrorState
          message={error}
          onRetry={() =>
            router.replace({ pathname: "/drawing/[id]", params: { id: String(id ?? "new") } })
          }
        />
      </Screen>
    );
  if (!ink || !drawing)
    return (
      <Screen>
        <LoadingState label={t("drawing.preparing")} />
      </Screen>
    );

  return (
    <Screen padded={false}>
      <View
        style={[
          styles.header,
          { backgroundColor: themeColors.surface, borderBottomColor: themeColors.border },
        ]}
      >
        <StoneButton
          label={t("common.back")}
          variant="quiet"
          onPress={() => {
            void save();
            router.back();
          }}
        />
        <StoneInput
          label={t("drawing.titleField")}
          value={title}
          onChangeText={setTitle}
          containerStyle={styles.title}
        />
        <StoneButton label={t("common.save")} onPress={() => void save()} />
      </View>
      <ScrollView
        horizontal
        contentContainerStyle={styles.toolbar}
        showsHorizontalScrollIndicator={false}
      >
        {(
          [
            "pen",
            "highlighter",
            "eraser",
            "line",
            "arrow",
            "rectangle",
            "ellipse",
            "select",
            "lasso",
            "pan",
          ] as const
        ).map((item) => (
          <StoneButton
            key={item}
            label={toolLabel(item, t)}
            variant={tool === item ? "primary" : "secondary"}
            onPress={() => setTool(item)}
          />
        ))}
        <StoneButton
          label={stylusOnly ? t("drawing.stylusOn") : t("drawing.stylusOff")}
          variant="secondary"
          onPress={() => setStylusOnly((value) => !value)}
        />
        <StoneButton
          label={t("editor.toolbar.undo")}
          variant="quiet"
          onPress={() => {
            const next = historyRef.current?.undo();
            if (next) setInk(next);
          }}
        />
        <StoneButton
          label={t("editor.toolbar.redo")}
          variant="quiet"
          onPress={() => {
            const next = historyRef.current?.redo();
            if (next) setInk(next);
          }}
        />
        <StoneButton
          label={t("drawing.moveLeft")}
          variant="quiet"
          onPress={() => transform(-16, 0)}
          disabled={!selection}
        />
        <StoneButton
          label={t("drawing.zoomIn")}
          variant="quiet"
          onPress={() => transform(0, 0, 1.1, 1.1)}
          disabled={!selection}
        />
        <StoneButton
          label={t("drawing.duplicate")}
          variant="quiet"
          onPress={() => {
            if (ink && selection) commit(duplicateSelection(ink, selection, Crypto.randomUUID));
          }}
          disabled={!selection}
        />
        <StoneButton
          label={t("drawing.deleteSelection")}
          variant="quiet"
          onPress={() => {
            if (ink && selection) {
              commit(deleteSelection(ink, selection));
              setSelection(null);
            }
          }}
          disabled={!selection}
        />
      </ScrollView>
      <ScrollView
        horizontal
        contentContainerStyle={styles.palette}
        showsHorizontalScrollIndicator={false}
      >
        {colors.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityLabel={t("drawing.colorA11y", { color: item })}
            onPress={() => setColor(item)}
            style={[
              styles.swatch,
              { backgroundColor: item, borderColor: themeColors.border },
              color === item && [styles.selectedSwatch, { borderColor: themeColors.primary }],
            ]}
          />
        ))}
        {widths.map((item) => (
          <StoneButton
            key={item}
            label={`${item}px`}
            variant={width === item ? "primary" : "secondary"}
            onPress={() => setWidth(item)}
          />
        ))}
      </ScrollView>
      <View style={[styles.canvasWrap, { borderColor: themeColors.border }]}>
        <InkCanvas
          ref={canvasRef}
          document={ink}
          tool={tool}
          color={color}
          width={width}
          stylusOnly={stylusOnly}
          selection={selection}
          onStroke={stroke}
          onErase={erase}
          onShape={shape}
          onSelect={setSelection}
        />
      </View>
      {error ? (
        <Pressable accessibilityRole="button" onPress={() => setError(null)}>
          <StoneText tone="danger" style={styles.error}>
            {error}
          </StoneText>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function toolLabel(tool: InkCanvasTool, t: ReturnType<typeof useI18n>["t"]): string {
  return (
    {
      pen: t("drawing.tool.pen"),
      highlighter: t("drawing.tool.highlighter"),
      eraser: t("drawing.tool.eraser"),
      line: t("drawing.tool.line"),
      arrow: t("drawing.tool.arrow"),
      rectangle: t("drawing.tool.rectangle"),
      ellipse: t("drawing.tool.ellipse"),
      select: t("drawing.tool.select"),
      lasso: t("drawing.tool.lasso"),
      pan: t("drawing.tool.pan"),
    } as Record<InkCanvasTool, string>
  )[tool];
}

const styles = StyleSheet.create({
  header: {
    minHeight: 76,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  title: { flex: 1 },
  toolbar: { gap: spacing.xs, padding: spacing.sm },
  palette: {
    gap: spacing.sm,
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  swatch: { width: 36, height: 36, borderRadius: radii.pill, borderWidth: hairline },
  selectedSwatch: { borderWidth: 3 },
  canvasWrap: {
    flex: 1,
    margin: spacing.sm,
    borderWidth: hairline,
    borderRadius: radii.md,
    minHeight: 420,
  },
  error: { padding: spacing.sm },
});
