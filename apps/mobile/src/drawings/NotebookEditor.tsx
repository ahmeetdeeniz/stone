import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import {
  INK_PAPERS,
  InkHistory,
  addPage,
  addShape,
  addStroke,
  createNotebook,
  deleteSelection,
  duplicatePage,
  duplicateSelection,
  eraseAt,
  movePage,
  pageDocument,
  placeImage,
  parseNotebook,
  refreshSelection,
  removePage,
  replacePage,
  serializeNotebook,
  setPageObjects,
  setPaper,
  transformSelection,
  type InkDocument,
  type InkLayout,
  type InkNotebook,
  type InkPaper,
  type InkPageObject,
  type InkPoint,
  type InkShape,
  type InkText,
} from "@stone/ink";
import type { Drawing } from "@stone/domain";
import { ErrorState, LoadingState } from "../components/states";
import {
  ActionSheet,
  Chip,
  Overline,
  Screen,
  SegmentedControl,
  StoneButton,
  StoneInput,
  StoneText,
  Surface,
} from "../components/ui";
import { useTheme } from "../design/theme";
import { radii, spacing } from "../design/tokens";
import {
  NotebookCanvas,
  type EditingText,
  type NotebookCanvasHandle,
  type NotebookTool,
  type ObjectSelection,
  type PageSelection,
} from "../drawings/NotebookCanvas";
import { lineHeightFor } from "../drawings/text-layout";
import { usePageAssets } from "../drawings/use-page-assets";
import { pickImage } from "../attachments/attachment-picker";
import { shareNotebookPdf } from "../drawings/notebook-pdf";
import {
  HIGHLIGHTER_COLORS,
  INK_COLORS,
  NotebookToolbar,
  PEN_WIDTHS,
  ToolButton,
} from "../drawings/NotebookToolbar";
import { measureTextHeight, renderPagePng } from "../drawings/page-picture";
import { useAuth } from "../providers/auth-provider";
import { useAppServices } from "../providers/app-provider";
import { useI18n } from "../i18n/provider";
import { useVideoSession } from "../video/use-video-session";
import { barPadding } from "../video/video-layout";

const SAVE_DELAY_MS = 1500;
const WIDE_LAYOUT = 1000;

export interface NotebookEditorProps {
  /** A drawing id, or "new" to set up a new notebook. */
  id: string | undefined;
  layout?: string | undefined;
  paper?: string | undefined;
  /** Leaves the notebook; defaults to navigating back. */
  onBack?: () => void;
  /** Called after each save with the drawing id (a "new" notebook gets its id on first save). */
  onChanged?: (drawingId: string) => void;
}

/** The handwriting notebook, as a full screen route or embedded in the tablet split view. */
export function NotebookEditor({ id, layout, paper, onBack, onChanged }: NotebookEditorProps) {
  const params = { layout, paper };
  const router = useRouter();
  const back = onBack ?? (() => router.back());
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { user } = useAuth();
  const { drawings, deviceId, attachments } = useAppServices();
  const { t } = useI18n();
  const canvasRef = useRef<NotebookCanvasHandle>(null);
  const historyRef = useRef<InkHistory<InkNotebook> | null>(null);
  const notebookRef = useRef<InkNotebook | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [notebook, setNotebookState] = useState<InkNotebook | null>(null);
  const [setup, setSetup] = useState<{ layout: InkLayout; paper: InkPaper } | null>(null);
  const [tool, setTool] = useState<NotebookTool>("pen");
  const [penColor, setPenColor] = useState(INK_COLORS[0]!);
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHTER_COLORS[0]!);
  const [width, setWidth] = useState(PEN_WIDTHS[1]!);
  const [stylusOnly, setStylusOnly] = useState(true);
  const [selection, setSelection] = useState<PageSelection | null>(null);
  const [objectSelection, setObjectSelection] = useState<ObjectSelection | null>(null);
  const [editingText, setEditingText] = useState<EditingText | null>(null);
  const [textSize, setTextSize] = useState(20);
  const [pageMenu, setPageMenu] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [title, setTitle] = useState(() => t("notebook.newTitle"));
  /** Until the title is edited, a new notebook follows the UI language for its default name. */
  const titleEdited = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const [status, setStatus] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  /** Page to scroll to once the canvas has re-rendered with a newly added page. */
  const pendingPage = useRef<number | null>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const video = useVideoSession(drawing?.id, area);
  const assets = usePageAssets(notebook, (file) =>
    user ? attachments.resolve(user.uid, file) : Promise.reject(new Error("Signed out.")),
  );
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const color = tool === "highlighter" ? highlightColor : penColor;

  const setNotebook = (next: InkNotebook) => {
    notebookRef.current = next;
    setNotebookState(next);
  };

  useEffect(() => {
    if (!user || !id) return;
    let active = true;
    const load = async () => {
      try {
        if (id === "new") {
          const now = new Date().toISOString();
          const nextId = Crypto.randomUUID();
          setDrawing({
            id: nextId,
            ownerId: user.uid,
            documentId: null,
            title: t("notebook.newTitle"),
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
          });
          setSetup({
            layout: params.layout === "infinite" ? "infinite" : "pages",
            paper: INK_PAPERS.includes(params.paper as InkPaper)
              ? (params.paper as InkPaper)
              : "lined",
          });
          return;
        }
        const loaded = await drawings.getById(user.uid, id);
        if (!loaded) throw new Error(t("drawing.notFound"));
        const next = parseNotebook(await new File(loaded.sourcePath).text());
        if (!active) return;
        setDrawing(loaded);
        setTitle(loaded.title);
        historyRef.current = new InkHistory(next);
        setNotebook(next);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : t("drawing.loadFailed"));
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [deviceId, drawings, id, user]);

  const start = () => {
    if (!drawing || !setup) return;
    const next = createNotebook({
      id: drawing.id,
      title,
      pageId: Crypto.randomUUID(),
      layout: setup.layout,
      paper: setup.paper,
    });
    historyRef.current = new InkHistory(next);
    setNotebook(next);
    setSetup(null);
    dirty.current = true;
    setStatus("unsaved");
  };

  const commit = (next: InkNotebook) => {
    historyRef.current?.commit(next);
    setNotebook(next);
    dirty.current = true;
    setStatus("unsaved");
  };

  const editPage = (index: number, edit: (page: InkDocument) => InkDocument) => {
    const current = notebookRef.current;
    if (!current) return;
    commit(replacePage(current, index, edit(pageDocument(current, index))));
  };

  const onStroke = (index: number, points: readonly InkPoint[]) => {
    if (tool !== "pen" && tool !== "highlighter") return;
    editPage(index, (page) =>
      addStroke(page, {
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

  /** True once the current eraser gesture removed something. */
  const erased = useRef(false);
  const onErase = (index: number, point: InkPoint, done: boolean) => {
    const current = notebookRef.current;
    if (!current) return;
    if (!done) {
      const page = pageDocument(current, index);
      const next = eraseAt(page, point, width * 3);
      // Nothing under the eraser: keep the same objects so the page is not re-recorded.
      if (next.strokes.length === page.strokes.length && next.shapes.length === page.shapes.length)
        return;
      erased.current = true;
      setNotebook(replacePage(current, index, next));
      return;
    }
    // The whole gesture lands in undo history as one step, and only if it erased anything.
    if (erased.current) commit(current);
    erased.current = false;
  };

  const onShape = (index: number, shape: InkShape) => {
    editPage(index, (page) => addShape(page, { ...shape, id: Crypto.randomUUID() }));
  };

  const undo = () => {
    const next = historyRef.current?.undo();
    if (!next) return;
    setNotebook(next);
    setSelection(null);
    setObjectSelection(null);
    dirty.current = true;
    setStatus("unsaved");
  };

  /** Writes one photo or text box back into its page (adding it when it is new). */
  const putObject = (pageIndex: number, object: InkPageObject) => {
    const current = notebookRef.current;
    const page = current?.pages[pageIndex];
    if (!current || !page) return;
    if (object.kind === "image") {
      const images = page.images ?? [];
      const exists = images.some((item) => item.id === object.object.id);
      commit(
        setPageObjects(current, pageIndex, {
          images: exists
            ? images.map((item) => (item.id === object.object.id ? object.object : item))
            : [...images, object.object],
        }),
      );
    } else {
      const text = { ...object.object, height: measureTextHeight(object.object, assets.typeface) };
      const texts = page.texts ?? [];
      const exists = texts.some((item) => item.id === text.id);
      commit(
        setPageObjects(current, pageIndex, {
          texts: exists
            ? texts.map((item) => (item.id === text.id ? text : item))
            : [...texts, text],
        }),
      );
    }
  };

  const removeObject = (selected: ObjectSelection) => {
    const current = notebookRef.current;
    const page = current?.pages[selected.pageIndex];
    if (!current || !page) return;
    commit(
      setPageObjects(
        current,
        selected.pageIndex,
        selected.kind === "image"
          ? { images: (page.images ?? []).filter((item) => item.id !== selected.id) }
          : { texts: (page.texts ?? []).filter((item) => item.id !== selected.id) },
      ),
    );
    setObjectSelection(null);
  };

  const startText = (
    pageIndex: number,
    point: { x: number; y: number },
    existing: InkText | null,
  ) => {
    setSelection(null);
    setObjectSelection(null);
    if (existing) {
      setEditingText({ pageIndex, text: existing });
      return;
    }
    const current = notebookRef.current;
    if (!current) return;
    const lineHeight = lineHeightFor(textSize);
    const width = Math.max(160, Math.min(420, current.pageWidth - point.x - 24));
    setEditingText({
      pageIndex,
      text: {
        id: Crypto.randomUUID(),
        text: "",
        x: Math.min(point.x, current.pageWidth - width - 8),
        y: Math.max(0, point.y - lineHeight / 2),
        width,
        height: lineHeight,
        size: textSize,
        color: penColor,
        createdAt: new Date().toISOString(),
      },
    });
  };

  const finishText = () => {
    const editing = editingText;
    setEditingText(null);
    if (!editing) return;
    const page = notebookRef.current?.pages[editing.pageIndex];
    const existed = page?.texts?.some((item) => item.id === editing.text.id) ?? false;
    if (!editing.text.text.trim()) {
      if (existed)
        removeObject({ pageIndex: editing.pageIndex, kind: "text", id: editing.text.id });
      return;
    }
    const before = page?.texts?.find((item) => item.id === editing.text.id);
    if (before && before.text === editing.text.text) return;
    putObject(editing.pageIndex, { kind: "text", object: editing.text });
  };

  const insertImage = async () => {
    if (!user || !notebookRef.current) return;
    try {
      const picked = await pickImage();
      if (!picked) return;
      const file = await attachments.add(user.uid, picked);
      const natural = await new Promise<{ width: number; height: number }>((resolve, reject) =>
        Image.getSize(
          picked.uri,
          (imageWidth, imageHeight) => resolve({ width: imageWidth, height: imageHeight }),
          reject,
        ),
      );
      const current = notebookRef.current;
      const page = current.pages[pageIndex];
      if (!page) return;
      const box = placeImage(
        natural,
        { width: current.pageWidth * 0.7, height: Math.min(page.height, current.pageHeight) * 0.6 },
        { x: current.pageWidth / 2, y: Math.min(page.height, current.pageHeight) / 2 },
      );
      const id = Crypto.randomUUID();
      putObject(pageIndex, {
        kind: "image",
        object: { id, file, ...box, createdAt: new Date().toISOString() },
      });
      setTool("lasso");
      setSelection(null);
      setObjectSelection({ pageIndex, kind: "image", id });
    } catch (caught) {
      Alert.alert(
        t("notebook.insertImageFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      );
    }
  };

  const sharePdf = async () => {
    const current = notebookRef.current;
    if (!current || exporting) return;
    setExporting(true);
    try {
      await save();
      await shareNotebookPdf(current, title, assetsRef.current);
    } catch (caught) {
      Alert.alert(
        t("notebook.exportFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      );
    } finally {
      setExporting(false);
    }
  };

  const editSelection = (edit: (page: InkDocument, current: PageSelection) => InkDocument) => {
    if (!selection) return;
    editPage(selection.pageIndex, (page) => edit(page, selection));
  };

  const scaleSelection = (factor: number) => {
    const current = notebookRef.current;
    if (!selection || !current) return;
    const { left, top } = selection.selection.bounds;
    // Scale around the selection's top-left corner so it stays where it was.
    const page = transformSelection(
      pageDocument(current, selection.pageIndex),
      selection.selection,
      {
        translateX: left - left * factor,
        translateY: top - top * factor,
        scaleX: factor,
        scaleY: factor,
      },
    );
    commit(replacePage(current, selection.pageIndex, page));
    setSelection({ ...selection, selection: refreshSelection(page, selection.selection) });
  };

  const save = useCallback(async () => {
    const current = notebookRef.current;
    if (!drawing || !current || !user || !dirty.current) return;
    dirty.current = false;
    setStatus("saving");
    try {
      const directory = new Directory(Paths.document, "drawings");
      directory.create({ idempotent: true });
      const preview = new File(directory, `${drawing.id}.png`);
      const firstPage = current.pages[0]!;
      const bytes = renderPagePng(firstPage, current.paper, current.pageWidth, assetsRef.current);
      if (!bytes) throw new Error(t("drawing.previewFailed"));
      preview.write(bytes);
      const next = await drawings.save(
        { ...drawing, title, revision: drawing.revision + (drawing.sourcePath ? 1 : 0) },
        serializeNotebook({ ...current, title }),
        preview.uri,
        deviceId,
      );
      setDrawing(next);
      setStatus(dirty.current ? "unsaved" : "saved");
      changedRef.current?.(next.id);
    } catch (caught) {
      dirty.current = true;
      setStatus("error");
      setError(caught instanceof Error ? caught.message : t("drawing.saveFailed"));
    }
  }, [deviceId, drawing, drawings, title, user]);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!notebook || status !== "unsaved") return;
    const timer = setTimeout(() => void saveRef.current(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [notebook, status]);

  // Leaving (or switching notebooks in the split view) unmounts the editor: save what's pending.
  useEffect(() => () => void saveRef.current(), []);

  useEffect(() => {
    if (id === "new" && !titleEdited.current) setTitle(t("notebook.newTitle"));
  }, [id, t]);

  // Undo or redo can remove the page being shown; keep the page indicator in range.
  const totalPages = notebook?.pages.length ?? 1;
  useEffect(() => {
    setPageIndex((current) => Math.min(current, totalPages - 1));
  }, [totalPages]);

  useEffect(() => {
    if (pendingPage.current === null) return;
    const target = pendingPage.current;
    pendingPage.current = null;
    setPageIndex(target);
    canvasRef.current?.scrollToPage(target);
  }, [notebook]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") void saveRef.current();
    });
    return () => subscription.remove();
  }, []);

  if (error && !notebook && !setup)
    return (
      <Screen>
        <ErrorState
          message={error}
          onRetry={() =>
            onBack
              ? back()
              : router.replace({ pathname: "/drawing/[id]", params: { id: String(id ?? "new") } })
          }
        />
      </Screen>
    );

  if (setup)
    return (
      <Screen>
        <NotebookSetup
          title={title}
          onTitle={(value) => {
            titleEdited.current = true;
            setTitle(value);
          }}
          value={setup}
          onChange={setSetup}
          onStart={start}
          onCancel={back}
        />
      </Screen>
    );

  if (!notebook || !drawing)
    return (
      <Screen>
        <LoadingState label={t("drawing.preparing")} />
      </Screen>
    );

  const pageCount = notebook.pages.length;
  const wide = windowWidth >= WIDE_LAYOUT;
  const goToPage = (index: number) => {
    const target = Math.max(0, Math.min(pageCount - 1, index));
    setPageIndex(target);
    canvasRef.current?.scrollToPage(target);
  };

  const clearOfVideo = barPadding(video.reservation, area.width);

  return (
    <Screen padded={false}>
      <View
        style={styles.area}
        onLayout={(event) => {
          const { width: areaWidth, height: areaHeight } = event.nativeEvent.layout;
          setArea({ width: areaWidth, height: areaHeight });
        }}
      >
        <View
          style={[
            styles.header,
            { backgroundColor: colors.surface, borderBottomColor: colors.border },
            clearOfVideo,
          ]}
        >
          <ToolButton
            icon="chevron-left"
            label={t("common.back")}
            onPress={() => {
              void save();
              back();
            }}
          />
          <StoneInput
            label={t("notebook.titleField")}
            value={title}
            onChangeText={(value) => {
              titleEdited.current = true;
              setTitle(value);
              dirty.current = true;
              setStatus("unsaved");
            }}
            containerStyle={styles.title}
          />
          {windowWidth >= 600 || status === "error" ? (
            <StoneText variant="caption" tone={status === "error" ? "danger" : "muted"}>
              {t(`editor.status.${status}`)}
            </StoneText>
          ) : null}
          <ToolButton
            icon="undo"
            label={t("editor.toolbar.undo")}
            disabled={!historyRef.current?.canUndo()}
            onPress={undo}
          />
          <ToolButton
            icon="redo"
            label={t("editor.toolbar.redo")}
            disabled={!historyRef.current?.canRedo()}
            onPress={() => {
              const next = historyRef.current?.redo();
              if (next) {
                setNotebook(next);
                dirty.current = true;
                setStatus("unsaved");
              }
            }}
          />
          <ToolButton
            icon={video.linked ? "play-box" : "play-box-outline"}
            label={video.open ? t("video.close") : t("video.show")}
            active={video.open}
            onPress={video.toggle}
          />
          <ToolButton
            icon="dots-horizontal"
            label={t("common.more")}
            onPress={() => setMenuOpen(true)}
          />
        </View>
        <View
          style={[
            styles.tools,
            { backgroundColor: colors.surface, borderBottomColor: colors.border },
            clearOfVideo,
          ]}
        >
          <NotebookToolbar
            tool={tool}
            color={color}
            width={width}
            textSize={textSize}
            onTool={(next) => {
              setTool(next);
              if (next !== "lasso") {
                setSelection(null);
                setObjectSelection(null);
              }
            }}
            onColor={(next) =>
              tool === "highlighter" ? setHighlightColor(next) : setPenColor(next)
            }
            onWidth={setWidth}
            onTextSize={setTextSize}
            onInsertImage={() => void insertImage()}
          />
          {notebook.layout === "pages" ? (
            <View style={styles.pager}>
              <ToolButton
                icon="chevron-left"
                label={t("notebook.previousPage")}
                disabled={pageIndex === 0}
                onPress={() => goToPage(pageIndex - 1)}
              />
              <StoneText variant="label" style={styles.pageLabel}>
                {t("notebook.pageOf", { page: pageIndex + 1, total: pageCount })}
              </StoneText>
              <ToolButton
                icon="chevron-right"
                label={t("notebook.nextPage")}
                disabled={pageIndex >= pageCount - 1}
                onPress={() => goToPage(pageIndex + 1)}
              />
              <ToolButton
                icon="plus"
                label={t("notebook.addPage")}
                onPress={() => {
                  pendingPage.current = pageIndex + 1;
                  commit(addPage(notebook, Crypto.randomUUID(), pageIndex));
                }}
              />
            </View>
          ) : null}
        </View>
        {objectSelection ? (
          <View style={[styles.selectionBar, { backgroundColor: colors.backgroundSecondary }]}>
            <StoneText variant="caption" tone="secondary">
              {objectSelection.kind === "image"
                ? t("notebook.photoSelected")
                : t("notebook.textSelected")}
            </StoneText>
            {objectSelection.kind === "text" ? (
              <ToolButton
                icon="pencil-outline"
                label={t("notebook.editText")}
                onPress={() => {
                  const text = notebook.pages[objectSelection.pageIndex]?.texts?.find(
                    (item) => item.id === objectSelection.id,
                  );
                  if (text) startText(objectSelection.pageIndex, text, text);
                }}
              />
            ) : null}
            <ToolButton
              icon="delete-outline"
              label={t("drawing.deleteSelection")}
              onPress={() => removeObject(objectSelection)}
            />
            <ToolButton
              icon="close"
              label={t("common.close")}
              onPress={() => setObjectSelection(null)}
            />
          </View>
        ) : null}
        {selection ? (
          <View style={[styles.selectionBar, { backgroundColor: colors.backgroundSecondary }]}>
            <StoneText variant="caption" tone="secondary">
              {t("notebook.selected", {
                count: selection.selection.strokeIds.length + selection.selection.shapeIds.length,
              })}
            </StoneText>
            <ToolButton
              icon="magnify-minus-outline"
              label={t("notebook.shrink")}
              onPress={() => scaleSelection(0.9)}
            />
            <ToolButton
              icon="magnify-plus-outline"
              label={t("notebook.grow")}
              onPress={() => scaleSelection(1.1)}
            />
            <ToolButton
              icon="content-copy"
              label={t("drawing.duplicate")}
              onPress={() =>
                editSelection((page, current) =>
                  duplicateSelection(page, current.selection, Crypto.randomUUID),
                )
              }
            />
            <ToolButton
              icon="delete-outline"
              label={t("drawing.deleteSelection")}
              onPress={() => {
                editSelection((page, current) => deleteSelection(page, current.selection));
                setSelection(null);
              }}
            />
          </View>
        ) : null}
        <View style={styles.body}>
          {wide && notebook.layout === "pages" && pageCount > 1 ? (
            <ScrollView
              style={[
                styles.rail,
                { borderRightColor: colors.border, backgroundColor: colors.surface },
              ]}
              contentContainerStyle={styles.railContent}
            >
              {notebook.pages.map((page, index) => (
                <Pressable
                  key={page.id}
                  accessibilityRole="button"
                  accessibilityLabel={t("notebook.goToPage", { page: index + 1 })}
                  onPress={() => goToPage(index)}
                  onLongPress={() => setPageMenu(index)}
                  delayLongPress={350}
                  style={[
                    styles.railPage,
                    {
                      borderColor: index === pageIndex ? colors.primary : colors.border,
                      backgroundColor: "#FFFFFF",
                    },
                  ]}
                >
                  <StoneText variant="caption" style={{ color: "#57534E" }}>
                    {index + 1}
                  </StoneText>
                  <StoneText variant="caption" style={{ color: "#857F7A" }}>
                    {page.strokes.length + page.shapes.length > 0 ? "•" : ""}
                  </StoneText>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <NotebookCanvas
            ref={canvasRef}
            notebook={notebook}
            tool={tool}
            color={color}
            width={width}
            stylusOnly={stylusOnly}
            selection={selection}
            onStroke={onStroke}
            onErase={onErase}
            onShape={onShape}
            onSelect={setSelection}
            onPageChange={setPageIndex}
            onUndo={undo}
            onInkStart={video.writingStarted}
            onInkEnd={video.writingEnded}
            avoid={video.reservation}
            assets={assets}
            objectSelection={objectSelection}
            onObjectSelect={setObjectSelection}
            onObjectChange={putObject}
            onTextTap={startText}
            editingText={editingText}
            onEditingTextChange={(value) =>
              setEditingText((current) =>
                current ? { ...current, text: { ...current.text, text: value } } : current,
              )
            }
            onEditingTextDone={finishText}
          />
        </View>
        {error ? (
          <Pressable accessibilityRole="button" onPress={() => setError(null)}>
            <StoneText tone="danger" style={styles.error}>
              {error}
            </StoneText>
          </Pressable>
        ) : null}
        <ActionSheet
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          options={[
            {
              label: stylusOnly ? t("notebook.stylusOnlyOn") : t("notebook.stylusOnlyOff"),
              icon: "pencil-outline",
              onPress: () => setStylusOnly((value) => !value),
            },
            {
              label: t("notebook.changePaper"),
              icon: "document-outline",
              onPress: () => setPaperOpen(true),
            },
            ...(notebook.layout === "pages"
              ? [
                  {
                    label: t("notebook.pageActions", { page: pageIndex + 1 }),
                    icon: "copy-outline" as const,
                    onPress: () => setPageMenu(pageIndex),
                  },
                ]
              : []),
            {
              label: exporting ? t("notebook.exporting") : t("notebook.sharePdf"),
              icon: "share-outline",
              onPress: () => void sharePdf(),
            },
          ]}
        />
        <ActionSheet
          visible={pageMenu !== null}
          title={pageMenu !== null ? t("notebook.pageTitle", { page: pageMenu + 1 }) : undefined}
          onClose={() => setPageMenu(null)}
          options={
            pageMenu === null
              ? []
              : [
                  ...(pageMenu > 0
                    ? [
                        {
                          label: t("notebook.movePageUp"),
                          icon: "arrow-up-outline" as const,
                          onPress: () => {
                            pendingPage.current = pageMenu - 1;
                            commit(movePage(notebook, pageMenu, pageMenu - 1));
                          },
                        },
                      ]
                    : []),
                  ...(pageMenu < pageCount - 1
                    ? [
                        {
                          label: t("notebook.movePageDown"),
                          icon: "arrow-down-outline" as const,
                          onPress: () => {
                            commit(movePage(notebook, pageMenu, pageMenu + 1));
                            pendingPage.current = pageMenu + 1;
                          },
                        },
                      ]
                    : []),
                  {
                    label: t("notebook.duplicatePage"),
                    icon: "copy-outline" as const,
                    onPress: () => {
                      pendingPage.current = pageMenu + 1;
                      commit(duplicatePage(notebook, pageMenu, Crypto.randomUUID));
                    },
                  },
                  {
                    label: t("notebook.insertBlankAfter"),
                    icon: "add-outline" as const,
                    onPress: () => {
                      pendingPage.current = pageMenu + 1;
                      commit(addPage(notebook, Crypto.randomUUID(), pageMenu));
                    },
                  },
                  {
                    label: t("notebook.deletePage", { page: pageMenu + 1 }),
                    icon: "trash-outline" as const,
                    destructive: true,
                    onPress: () => {
                      const index = pageMenu;
                      Alert.alert(t("notebook.deletePageConfirm"), undefined, [
                        { text: t("common.cancel"), style: "cancel" },
                        {
                          text: t("common.delete"),
                          style: "destructive",
                          onPress: () => {
                            commit(removePage(notebook, index));
                            setSelection(null);
                            setObjectSelection(null);
                            setPageIndex(Math.max(0, Math.min(index, pageCount - 2)));
                          },
                        },
                      ]);
                    },
                  },
                ]
          }
        />
        <ActionSheet
          visible={paperOpen}
          title={t("notebook.paper")}
          onClose={() => setPaperOpen(false)}
          options={INK_PAPERS.map((paper) => ({
            label: t(`notebook.paper.${paper}`),
            icon: paper === notebook.paper ? ("checkmark" as const) : ("ellipse-outline" as const),
            onPress: () => commit(setPaper(notebook, paper)),
          }))}
        />
        {video.element}
      </View>
    </Screen>
  );
}

function NotebookSetup({
  title,
  onTitle,
  value,
  onChange,
  onStart,
  onCancel,
}: {
  title: string;
  onTitle: (title: string) => void;
  value: { layout: InkLayout; paper: InkPaper };
  onChange: (value: { layout: InkLayout; paper: InkPaper }) => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <ScrollView contentContainerStyle={styles.setup}>
      <Surface style={styles.setupCard}>
        <StoneText variant="title2">{t("notebook.setupTitle")}</StoneText>
        <StoneInput label={t("notebook.titleField")} value={title} onChangeText={onTitle} />
        <Overline>{t("notebook.layout")}</Overline>
        <SegmentedControl
          accessibilityLabel={t("notebook.layout")}
          value={value.layout}
          onChange={(layout) => onChange({ ...value, layout })}
          options={[
            { value: "pages", label: t("notebook.layout.pages") },
            { value: "infinite", label: t("notebook.layout.infinite") },
          ]}
        />
        <StoneText variant="caption" tone="muted">
          {value.layout === "pages"
            ? t("notebook.layout.pagesDetail")
            : t("notebook.layout.infiniteDetail")}
        </StoneText>
        <Overline>{t("notebook.paper")}</Overline>
        <View style={styles.paperRow}>
          {INK_PAPERS.map((paper) => (
            <Chip
              key={paper}
              label={t(`notebook.paper.${paper}`)}
              selected={value.paper === paper}
              onPress={() => onChange({ ...value, paper })}
            />
          ))}
        </View>
        <View style={styles.setupActions}>
          <StoneButton label={t("common.cancel")} variant="quiet" onPress={onCancel} />
          <StoneButton label={t("notebook.start")} onPress={onStart} testID="notebook-start" />
        </View>
      </Surface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  area: { flex: 1 },
  header: {
    minHeight: 64,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  title: { flex: 1 },
  tools: {
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  pager: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm },
  pageLabel: { minWidth: 56, textAlign: "center" },
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
  body: { flex: 1, flexDirection: "row" },
  rail: { width: 88, flexGrow: 0, borderRightWidth: 1 },
  railContent: { padding: spacing.sm, gap: spacing.sm, alignItems: "center" },
  railPage: {
    width: 56,
    height: 78,
    borderWidth: 2,
    borderRadius: radii.xs,
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  error: { padding: spacing.sm },
  setup: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  setupCard: { alignSelf: "center", width: "100%", maxWidth: 560, gap: spacing.md },
  paperRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  setupActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
});
