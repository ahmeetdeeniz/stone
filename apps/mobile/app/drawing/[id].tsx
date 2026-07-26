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
import { spacing } from "../../src/design/tokens";
import { InkCanvas, type InkCanvasHandle, type InkCanvasTool } from "../../src/drawings/InkCanvas";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import type { Drawing } from "@stone/domain";

const colors = ["#11111D", "#6F63E7", "#C95B67", "#2F9E68", "#C58A1D", "#4B86C5"];
const widths = [2, 4, 8, 14];

export default function DrawingScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const { user } = useAuth();
  const { drawings, deviceId } = useAppServices();
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
  const [title, setTitle] = useState("Yeni çizim");
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
            title: "Yeni çizim",
            width: 900,
            height: 650,
            now,
          });
          const metadata: Drawing = {
            id: nextId,
            ownerId: user.uid,
            documentId: null,
            title: "Yeni çizim",
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
        if (!loaded) throw new Error("Çizim bulunamadı.");
        const source = await new File(loaded.sourcePath).text();
        const nextInk = parseInk(source);
        if (active) {
          setDrawing(loaded);
          setTitle(loaded.title);
          setInk(nextInk);
          historyRef.current = new InkHistory(nextInk);
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Çizim yüklenemedi.");
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
      if (!bytes) throw new Error("Çizim önizlemesi oluşturulamadı.");
      preview.write(bytes);
      const next = await drawings.save(
        { ...drawing, title, revision: drawing.revision + (drawing.sourcePath ? 1 : 0) },
        serializeInk({ ...ink, title }),
        preview.uri,
        deviceId,
      );
      setDrawing(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Çizim kaydedilemedi.");
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
        <LoadingState label="Çizim hazırlanıyor" />
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
          label="Geri"
          variant="quiet"
          onPress={() => {
            void save();
            router.back();
          }}
        />
        <StoneInput
          label="Çizim başlığı"
          value={title}
          onChangeText={setTitle}
          containerStyle={styles.title}
        />
        <StoneButton label="Kaydet" onPress={() => void save()} />
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
            label={toolLabel(item)}
            variant={tool === item ? "primary" : "secondary"}
            onPress={() => setTool(item)}
          />
        ))}
        <StoneButton
          label={stylusOnly ? "Kalem modu: açık" : "Kalem modu: kapalı"}
          variant="secondary"
          onPress={() => setStylusOnly((value) => !value)}
        />
        <StoneButton
          label="Geri al"
          variant="quiet"
          onPress={() => {
            const next = historyRef.current?.undo();
            if (next) setInk(next);
          }}
        />
        <StoneButton
          label="Yinele"
          variant="quiet"
          onPress={() => {
            const next = historyRef.current?.redo();
            if (next) setInk(next);
          }}
        />
        <StoneButton
          label="Sola taşı"
          variant="quiet"
          onPress={() => transform(-16, 0)}
          disabled={!selection}
        />
        <StoneButton
          label="Büyüt"
          variant="quiet"
          onPress={() => transform(0, 0, 1.1, 1.1)}
          disabled={!selection}
        />
        <StoneButton
          label="Çoğalt"
          variant="quiet"
          onPress={() => {
            if (ink && selection) commit(duplicateSelection(ink, selection, Crypto.randomUUID));
          }}
          disabled={!selection}
        />
        <StoneButton
          label="Seçimi sil"
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
            accessibilityLabel={`Renk ${item}`}
            onPress={() => setColor(item)}
            style={[
              styles.swatch,
              { backgroundColor: item },
              color === item && styles.selectedSwatch,
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
      <View style={styles.canvasWrap}>
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
          <StoneText style={styles.error}>{error}</StoneText>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function toolLabel(tool: InkCanvasTool): string {
  return (
    {
      pen: "Kalem",
      highlighter: "Vurgulayıcı",
      eraser: "Silgi",
      line: "Çizgi",
      arrow: "Ok",
      rectangle: "Dikdörtgen",
      ellipse: "Elips",
      select: "Seçim",
      lasso: "Kement",
      pan: "Kaydır",
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
  swatch: { width: 36, height: 36, borderRadius: 18 },
  selectedSwatch: { borderWidth: 4, borderColor: "#FFFFFF" },
  canvasWrap: {
    flex: 1,
    margin: spacing.sm,
    borderWidth: 1,
    borderColor: "#D4CEE3",
    minHeight: 420,
  },
  error: { padding: spacing.sm, color: "#C95B67" },
});
