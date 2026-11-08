import { Ionicons } from "@expo/vector-icons";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import * as DocumentPicker from "expo-document-picker";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { categoryIcon } from "@/components/chat/AttachmentChip";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { formatSize, humanMediaLabel } from "@/lib/chat/attachments";
import {
  MAX_PROJECT_FILES,
  type PickedProjectFile,
  type ProjectFileItem,
  useAddProjectFile,
  useProjectFiles,
  useRemoveProjectFile,
} from "@/lib/queries/project-files";
import { useTheme } from "@/lib/theme";
import { toastError } from "@/lib/toast";

/** Attachment types the model reads as text; images are not reference files. */
const DOCUMENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/*",
];

/**
 * Reference files every chat in the project can read. Files upload through
 * the attachment route and link to the project; the model reaches them with
 * the file tools rather than through the conversation.
 */
export function ProjectFilesSection({
  projectId,
  onOpenChat,
}: {
  projectId: string;
  onOpenChat: (chatId: string) => void;
}) {
  const { colors, radii, fonts } = useTheme();
  const { data: files, isError, refetch } = useProjectFiles(projectId);
  const addMutation = useAddProjectFile(projectId);
  const removeMutation = useRemoveProjectFile(projectId);
  const [uploading, setUploading] = useState<string[]>([]);
  const [removing, setRemoving] = useState<ProjectFileItem | null>(null);
  const removeSheetRef = useRef<BottomSheetModal>(null);

  const count = files?.length ?? 0;
  const full = count + uploading.length >= MAX_PROJECT_FILES;

  async function pickFiles() {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: DOCUMENT_TYPES,
    });
    if (result.canceled) return;
    const picked: PickedProjectFile[] = result.assets.map((asset) => ({
      uri: asset.uri,
      name: asset.name ?? "file",
      type: asset.mimeType ?? "application/octet-stream",
    }));
    const room = MAX_PROJECT_FILES - count - uploading.length;
    if (picked.length > room) {
      toastError(
        `A project holds up to ${MAX_PROJECT_FILES} files`,
        room > 0
          ? `Only the first ${room} selected ${room === 1 ? "file was" : "files were"} added.`
          : "Remove a file to add another.",
      );
    }
    const accepted = picked.slice(0, Math.max(room, 0)).filter((file) => {
      if (file.type.startsWith("image/")) {
        toastError(`${file.name} is an image`, "Project files are documents and text.");
        return false;
      }
      return true;
    });
    if (accepted.length === 0) return;
    setUploading((prev) => [...prev, ...accepted.map((file) => file.name)]);
    for (const file of accepted) {
      try {
        await addMutation.mutateAsync(file);
      } catch (error) {
        toastError(`Couldn't add ${file.name}`, error);
      } finally {
        setUploading((prev) => {
          const index = prev.indexOf(file.name);
          return index < 0 ? prev : prev.filter((_, i) => i !== index);
        });
      }
    }
  }

  function confirmRemove() {
    const file = removing;
    if (!file) return;
    removeMutation.mutate(file.uploadId, {
      onError: (error) => toastError(`Couldn't remove ${file.filename}`, error),
    });
  }

  const divider = {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  };
  const label = [
    styles.sectionLabel,
    { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
  ];
  const group = [
    styles.group,
    { borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.card },
  ];

  return (
    <View style={styles.section} accessibilityLabel="Project files">
      <Text style={label}>FILES{count > 0 ? ` · ${count} OF ${MAX_PROJECT_FILES}` : ""}</Text>
      <View style={group}>
        {isError ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading project files"
            onPress={() => void refetch()}
            style={styles.row}
          >
            <Ionicons name="alert-circle-outline" size={20} color={colors.destructive} />
            <Text
              style={[styles.rowTitle, { color: colors.foreground, fontFamily: fonts.sansRegular }]}
            >
              Couldn&apos;t load files. Tap to retry.
            </Text>
          </Pressable>
        ) : (
          <>
            {files?.map((file, index) => (
              <View
                key={file.uploadId}
                style={[styles.row, index > 0 && divider]}
                accessibilityLabel={file.filename}
              >
                <Ionicons
                  name={categoryIcon(file.category)}
                  size={20}
                  color={colors.mutedForeground}
                />
                <View style={styles.rowText}>
                  <Text
                    numberOfLines={1}
                    style={[styles.rowTitle, { color: colors.foreground, fontFamily: fonts.sansMedium }]}
                  >
                    {file.filename}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.rowMeta, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}
                  >
                    {humanMediaLabel(file.mediaType)} · {formatSize(file.size)}
                    {file.pageCount
                      ? ` · ${file.pageCount} ${file.pageCount === 1 ? "page" : "pages"}`
                      : ""}
                    {file.sourceChat ? (
                      <>
                        {" · from "}
                        <Text
                          accessibilityRole="link"
                          onPress={() => onOpenChat(file.sourceChat!.id)}
                          style={{ color: colors.foreground, textDecorationLine: "underline" }}
                        >
                          {file.sourceChat.title?.trim() || "a chat"}
                        </Text>
                      </>
                    ) : null}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${file.filename} from project`}
                  hitSlop={8}
                  disabled={removeMutation.isPending}
                  onPress={() => {
                    setRemoving(file);
                    removeSheetRef.current?.present();
                  }}
                  style={({ pressed }) => [
                    styles.rowAction,
                    { backgroundColor: pressed ? colors.muted : "transparent", borderRadius: radii.md },
                  ]}
                >
                  <Ionicons name="close" size={18} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ))}
            {uploading.map((name, index) => (
              <View
                key={`uploading-${index}-${name}`}
                style={[styles.row, (count > 0 || index > 0) && divider]}
                accessibilityLabel={`Uploading ${name}`}
              >
                <ActivityIndicator size="small" color={colors.mutedForeground} />
                <Text
                  numberOfLines={1}
                  style={[styles.rowTitle, styles.rowText, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}
                >
                  {name}
                </Text>
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add files"
              accessibilityHint="Reference material the model can read in every chat here"
              disabled={full}
              onPress={() => void pickFiles()}
              style={({ pressed }) => [
                styles.row,
                (count > 0 || uploading.length > 0) && divider,
                { backgroundColor: pressed ? colors.muted : "transparent", opacity: full ? 0.5 : 1 },
              ]}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.mutedForeground} />
              <View style={styles.rowText}>
                <Text
                  style={[styles.rowTitle, { color: colors.foreground, fontFamily: fonts.sansMedium }]}
                >
                  Add files
                </Text>
                <Text
                  numberOfLines={2}
                  style={[styles.rowMeta, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}
                >
                  {count === 0
                    ? "Reference material the model can read in every chat here."
                    : "The model reads and searches these when a question needs them."}
                </Text>
              </View>
            </Pressable>
          </>
        )}
      </View>
      <ConfirmSheet
        ref={removeSheetRef}
        title="Remove from project?"
        message={
          removing
            ? `${removing.filename} will no longer be available to chats in this project. Messages that attached it keep their copy.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={confirmRemove}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionLabel: { fontSize: 11, letterSpacing: 0.6, paddingHorizontal: 4 },
  group: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 15 },
  rowMeta: { fontSize: 13, lineHeight: 18 },
  rowAction: { padding: 6 },
});
