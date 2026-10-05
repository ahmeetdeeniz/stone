import { useEffect, useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { extractAttachmentReferences, type AttachmentReference } from "@stone/markdown";
import { StoneButton, StoneText } from "../components/ui";
import { useTheme } from "../design/theme";
import { spacing } from "../design/tokens";
import { useI18n } from "../i18n/provider";
import { openAttachmentExternally } from "./attachment-picker";
import type { AttachmentService } from "./attachment-service";

type UriState = { status: "loading" } | { status: "ready"; uri: string } | { status: "missing" };

/** Resolves (and if needed downloads) the local URI for each referenced attachment. */
export function useAttachmentUris(
  service: AttachmentService,
  ownerId: string | undefined,
  fileNames: readonly string[],
): ReadonlyMap<string, UriState> {
  const [states, setStates] = useState<ReadonlyMap<string, UriState>>(new Map());
  const key = fileNames.join("|");
  useEffect(() => {
    if (!ownerId) return;
    let active = true;
    for (const fileName of key ? key.split("|") : []) {
      setStates((current) =>
        current.get(fileName)?.status === "ready"
          ? current
          : new Map(current).set(fileName, { status: "loading" }),
      );
      service
        .resolve(ownerId, fileName)
        .then((uri) => {
          if (active)
            setStates((current) => new Map(current).set(fileName, { status: "ready", uri }));
        })
        .catch(() => {
          if (active) setStates((current) => new Map(current).set(fileName, { status: "missing" }));
        });
    }
    return () => {
      active = false;
    };
  }, [key, ownerId, service]);
  return states;
}

/** Thumbnails and file chips for a note's attachments, with an in-app image viewer. */
export function AttachmentStrip({
  service,
  ownerId,
  markdown,
}: {
  service: AttachmentService;
  ownerId: string | undefined;
  markdown: string;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const references = useMemo(() => uniqueByFile(extractAttachmentReferences(markdown)), [markdown]);
  const uris = useAttachmentUris(
    service,
    ownerId,
    references.map((reference) => reference.fileName),
  );
  const [viewing, setViewing] = useState<{ reference: AttachmentReference; uri: string } | null>(
    null,
  );
  if (references.length === 0) return null;

  const open = (reference: AttachmentReference) => {
    const state = uris.get(reference.fileName);
    if (state?.status !== "ready") return;
    if (reference.kind === "image") setViewing({ reference, uri: state.uri });
    else void openAttachmentExternally(state.uri, reference.fileName);
  };

  return (
    <View style={[styles.strip, { borderBottomColor: colors.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {references.map((reference) => {
            const state = uris.get(reference.fileName) ?? { status: "loading" };
            return (
              <Pressable
                key={reference.fileName}
                accessibilityRole="button"
                accessibilityLabel={t("attachments.openA11y", { name: reference.label })}
                accessibilityState={{ disabled: state.status !== "ready" }}
                onPress={() => open(reference)}
                style={({ pressed }) => [
                  styles.item,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                {reference.kind === "image" && state.status === "ready" ? (
                  <Image source={{ uri: state.uri }} style={styles.thumbnail} resizeMode="cover" />
                ) : (
                  <View style={[styles.thumbnail, styles.placeholder]}>
                    <Ionicons
                      name={
                        state.status === "missing"
                          ? "cloud-offline-outline"
                          : reference.kind === "pdf"
                            ? "document-text-outline"
                            : "image-outline"
                      }
                      size={22}
                      color={colors.textSecondary}
                    />
                  </View>
                )}
                <StoneText variant="caption" numberOfLines={1} style={styles.label}>
                  {state.status === "missing" ? t("attachments.unavailable") : reference.label}
                </StoneText>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <Modal
        visible={viewing !== null}
        animationType="fade"
        onRequestClose={() => setViewing(null)}
        supportedOrientations={["portrait", "landscape"]}
      >
        <SafeAreaView style={[styles.viewer, { backgroundColor: "#000" }]}>
          <View style={styles.viewerBar}>
            <StoneButton
              label={t("common.close")}
              variant="quiet"
              onPress={() => setViewing(null)}
            />
            <StoneText variant="label" numberOfLines={1} style={styles.viewerTitle}>
              {viewing?.reference.label ?? ""}
            </StoneText>
            <StoneButton
              label={t("attachments.share")}
              variant="quiet"
              onPress={() =>
                viewing
                  ? void openAttachmentExternally(viewing.uri, viewing.reference.fileName)
                  : undefined
              }
            />
          </View>
          {viewing ? (
            <Image
              source={{ uri: viewing.uri }}
              style={styles.viewerImage}
              resizeMode="contain"
              accessibilityLabel={viewing.reference.label}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function uniqueByFile(references: readonly AttachmentReference[]): AttachmentReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (seen.has(reference.fileName)) return false;
    seen.add(reference.fileName);
    return true;
  });
}

const styles = StyleSheet.create({
  strip: { borderBottomWidth: 1, paddingVertical: spacing.sm },
  row: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.sm },
  item: { width: 88, borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  thumbnail: { width: "100%", height: 64 },
  placeholder: { alignItems: "center", justifyContent: "center" },
  label: { paddingHorizontal: spacing.xs, paddingVertical: 4 },
  viewer: { flex: 1 },
  viewerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
  },
  viewerTitle: { flex: 1, textAlign: "center", color: "#fff" },
  viewerImage: { flex: 1, width: "100%" },
});
