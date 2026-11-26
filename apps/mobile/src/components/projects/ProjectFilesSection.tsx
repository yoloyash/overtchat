import { Trans, useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      name: asset.name ?? t("projects.files.fallbackFile"),
      type: asset.mimeType ?? "application/octet-stream",
    }));
    const room = MAX_PROJECT_FILES - count - uploading.length;
    if (picked.length > room) {
      toastError(
        t("projects.files.toast.limitTitle", { count: MAX_PROJECT_FILES }),
        room > 0
          ? t("projects.files.toast.limitPartial", { count: room })
          : t("projects.files.toast.limitFull"),
      );
    }
    const accepted = picked.slice(0, Math.max(room, 0)).filter((file) => {
      if (file.type.startsWith("image/")) {
        toastError(
          t("projects.mobile.files.imageNotAllowedTitle", { name: file.name }),
          t("projects.mobile.files.imageNotAllowedMessage"),
        );
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
        toastError(
          t("projects.mobile.files.addError", { filename: file.name }),
          error,
        );
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
      onError: (error) =>
        toastError(
          t("projects.mobile.files.removeError", { filename: file.filename }),
          error,
        ),
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
    <View style={styles.section} accessibilityLabel={t("projects.files.sectionLabel")}>
      <Text style={label}>
        {count > 0
          ? t("projects.mobile.files.headingCount", { count, max: MAX_PROJECT_FILES })
          : t("projects.mobile.files.heading")}
      </Text>
      <View style={group}>
        {isError ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("projects.mobile.files.retryLoadLabel")}
            onPress={() => void refetch()}
            style={styles.row}
          >
            <Ionicons name="alert-circle-outline" size={20} color={colors.destructive} />
            <Text
              style={[styles.rowTitle, { color: colors.foreground, fontFamily: fonts.sansRegular }]}
            >
              {t("projects.mobile.files.loadErrorTap")}
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
                    {humanMediaLabel(file.mediaType, t)} · {formatSize(file.size, t)}
                    {file.pageCount
                      ? ` · ${t("projects.files.pages", { count: file.pageCount })}`
                      : ""}
                    {file.sourceChat ? (
                      <Trans
                        i18nKey={
                          file.sourceChat.title?.trim()
                            ? "projects.mobile.files.metaFromChat"
                            : "projects.mobile.files.metaFromUnnamedChat"
                        }
                        values={{ chat: file.sourceChat.title?.trim() ?? "" }}
                        components={{
                          chatLink: (
                            <Text
                              accessibilityRole="link"
                              onPress={() => onOpenChat(file.sourceChat!.id)}
                              style={{
                                color: colors.foreground,
                                textDecorationLine: "underline",
                              }}
                            />
                          ),
                        }}
                      />
                    ) : null}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("projects.files.removeFileLabel", {
                    filename: file.filename,
                  })}
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
                accessibilityLabel={t("projects.mobile.files.uploadingLabel", { name })}
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
              accessibilityLabel={t("projects.files.addFiles")}
              accessibilityHint={t("projects.mobile.files.addFilesHint")}
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
                  {t("projects.files.addFiles")}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[styles.rowMeta, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}
                >
                  {count === 0
                    ? t("projects.files.description")
                    : t("projects.mobile.files.addFilesExistingDetail")}
                </Text>
              </View>
            </Pressable>
          </>
        )}
      </View>
      <ConfirmSheet
        ref={removeSheetRef}
        title={t("projects.mobile.files.removeConfirmTitle")}
        message={
          removing
            ? t("projects.mobile.files.removeConfirmMessage", {
                filename: removing.filename,
              })
            : ""
        }
        confirmLabel={t("common.actions.remove")}
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
