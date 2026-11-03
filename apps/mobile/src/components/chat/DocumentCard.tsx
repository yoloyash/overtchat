import { Feather, Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPES,
  isDocumentOutput,
  type DocumentToolPart,
  type DocumentType,
} from "@overtchat/shared";
import { useTheme } from "@/lib/theme";
import { useDocumentViewer } from "./DocumentViewerContext";

export const DOCUMENT_ICONS: Record<DocumentType, keyof typeof Ionicons.glyphMap> = {
  markdown: "document-text-outline",
  code: "code-slash-outline",
  html: "globe-outline",
  svg: "image-outline",
  mermaid: "git-network-outline",
};

/** A document version produced by one tool call, opening it in the viewer. */
export function DocumentCard({
  part,
  streaming,
}: {
  part: DocumentToolPart;
  streaming: boolean;
}) {
  const { colors, fonts, radii } = useTheme();
  const viewer = useDocumentViewer();
  const output = isDocumentOutput(part.output) ? part.output : undefined;
  const creating = part.type === "tool-create_document";
  const pending =
    part.state === "input-streaming" || part.state === "input-available";
  const inputType = (DOCUMENT_TYPES as readonly unknown[]).includes(part.input?.type)
    ? (part.input!.type as DocumentType)
    : undefined;
  const type = output?.type ?? inputType ?? "markdown";
  const title =
    output?.title ??
    part.input?.title?.trim() ??
    (creating ? undefined : part.input?.id?.trim()) ??
    "Untitled document";

  if (part.state === "output-error") {
    return (
      <View style={styles.errorRow} accessibilityLiveRegion="polite">
        <Ionicons name="alert-circle-outline" size={16} color={colors.mutedForeground} />
        <Text style={[styles.errorText, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}>
          {creating ? "Could not create" : "Could not update"} {title}
        </Text>
      </View>
    );
  }

  const live = pending && streaming;
  const status = pending
    ? live
      ? creating
        ? "Writing…"
        : "Updating…"
      : creating
        ? "Stopped before it was saved"
        : "Update stopped"
    : `${DOCUMENT_TYPE_LABELS[type]} · ${creating ? "Created" : "Updated"} · Version ${output?.version ?? 1}`;
  const openable = Boolean(viewer && (output || (live && creating)));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${status}`}
      accessibilityState={{ disabled: !openable, selected: viewer?.activeToolCallId === part.toolCallId }}
      disabled={!openable}
      onPress={() => viewer?.open(part.toolCallId)}
      style={({ pressed }) => [
        styles.card,
        {
          borderColor: colors.border,
          backgroundColor: pressed ? colors.muted : colors.card,
          borderRadius: radii.lg,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: colors.muted, borderRadius: radii.md }]}>
        {live ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <Ionicons name={DOCUMENT_ICONS[type]} size={18} color={colors.mutedForeground} />
        )}
      </View>
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.foreground, fontFamily: fonts.sansMedium }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.status, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}>
          {status}
        </Text>
      </View>
      {openable ? <Feather name="chevron-right" size={16} color={colors.mutedForeground} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 6,
  },
  icon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 14 },
  status: { fontSize: 12, marginTop: 2 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 6 },
  errorText: { flexShrink: 1, fontSize: 13 },
});
