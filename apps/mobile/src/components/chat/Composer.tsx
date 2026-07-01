import { Ionicons } from "@expo/vector-icons";
import type { FileUIPart } from "ai";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { AttachmentMeta } from "@/lib/chat/attachments";
import { dictationErrorMessage } from "@/lib/chat/message";
import { useTheme } from "@/lib/theme";
import { toastError } from "@/lib/toast";
import { useDictation } from "@/lib/useDictation";
import { AttachmentChip } from "./AttachmentChip";

export function Composer({
  configured,
  streaming,
  searchEnabled,
  searchAvailable,
  attachments,
  attachmentMeta,
  uploading,
  uploadError,
  isAdmin,
  onDisableSearch,
  onOpenAddSheet,
  onRemoveAttachment,
  onDismissUploadError,
  onSubmit,
  onStop,
}: {
  configured: boolean;
  streaming: boolean;
  searchEnabled: boolean;
  searchAvailable: boolean;
  attachments: FileUIPart[];
  attachmentMeta: Record<string, AttachmentMeta>;
  uploading: boolean;
  uploadError: string | null;
  isAdmin: boolean;
  onDisableSearch: () => void;
  onOpenAddSheet: () => void;
  onRemoveAttachment: (index: number) => void;
  onDismissUploadError: () => void;
  onSubmit: (text: string, attachments: FileUIPart[]) => void;
  onStop: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  const [input, setInput] = useState("");

  const dictation = useDictation((text) => {
    setInput((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed} ${text}` : text;
    });
  });

  useEffect(() => {
    if (!dictation.error) return;
    toastError("Dictation", dictationErrorMessage(dictation.error, isAdmin));
    dictation.clearError();
  }, [dictation, isAdmin]);

  function submit() {
    const text = input.trim();
    if (streaming || uploading || !configured) return;
    if (!text && attachments.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
    onSubmit(text, attachments);
    setInput("");
  }

  function toggleMic() {
    Haptics.selectionAsync().catch(() => {});
    if (dictation.status === "recording") {
      void dictation.stop();
    } else if (dictation.status === "idle") {
      void dictation.start();
    }
  }

  function openAdd() {
    Haptics.selectionAsync().catch(() => { });
    onOpenAddSheet();
  }

  function disableSearch() {
    Haptics.selectionAsync().catch(() => { });
    onDisableSearch();
  }

  const canSend =
    (input.trim().length > 0 || attachments.length > 0) &&
    !streaming &&
    !uploading &&
    configured;
  const showPillsRow = searchAvailable && searchEnabled;
  const showAttachmentsRow = attachments.length > 0 || uploading;

  return (
    <View style={styles.wrapper}>
      {uploadError ? (
        <Pressable
          onPress={onDismissUploadError}
          accessibilityRole="button"
          accessibilityLabel="Dismiss upload error"
          style={[
            styles.errorBanner,
            {
              backgroundColor: colors.muted,
              borderColor: colors.destructive,
              borderRadius: radii.md,
            },
          ]}
        >
          <Text
            style={[
              styles.errorText,
              {
                color: colors.destructive,
                fontFamily: fonts.sansMedium,
              },
            ]}
          >
            {uploadError}
          </Text>
        </Pressable>
      ) : null}
      <View
        style={[
          styles.bar,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: radii.xxl,
          },
        ]}
      >
        {showAttachmentsRow && (
          <View style={styles.attachRow}>
            {attachments.map((att, i) => (
              <AttachmentChip
                key={`${att.url}-${i}`}
                attachment={att}
                meta={attachmentMeta[att.url]}
                onRemove={() => onRemoveAttachment(i)}
              />
            ))}
            {uploading ? (
              <View
                style={[
                  styles.uploadingChip,
                  {
                    backgroundColor: colors.muted,
                    borderColor: colors.border,
                    borderRadius: radii.md,
                  },
                ]}
              >
                <Ionicons
                  name="cloud-upload-outline"
                  size={16}
                  color={colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.uploadingText,
                    {
                      color: colors.mutedForeground,
                      fontFamily: fonts.sansMedium,
                    },
                  ]}
                >
                  Uploading…
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {showPillsRow && (
          <View style={styles.pillsRow}>
            {searchEnabled && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Disable web search"
                onPress={disableSearch}
                style={({ pressed }) => [
                  styles.pill,
                  {
                    backgroundColor: colors.accent,
                    borderRadius: radii.pill,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons
                  name="globe-outline"
                  size={14}
                  color={colors.foreground}
                />
                <Text
                  style={[
                    styles.pillLabel,
                    { color: colors.foreground, fontFamily: fonts.sansMedium },
                  ]}
                >
                  Search
                </Text>
                <Ionicons name="close" size={14} color={colors.foreground} />
              </Pressable>
            )}
          </View>
        )}

        <View style={styles.inputRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add to chat"
            onPress={openAdd}
            style={({ pressed }) => [
              styles.iconButton,
              {
                backgroundColor: "transparent",
                borderColor: colors.border,
                borderRadius: radii.pill,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="add" size={20} color={colors.mutedForeground} />
          </Pressable>

          <TextInput
            value={input}
            onChangeText={setInput}
            editable={configured && dictation.status !== "transcribing"}
            multiline
            placeholder={
              configured ? "Message…" : "No models available — ask an admin to add one"
            }
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { color: colors.foreground, fontFamily: fonts.sansRegular },
            ]}
          />

          {!streaming && !canSend ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                dictation.status === "recording"
                  ? "Stop dictation"
                  : dictation.status === "transcribing"
                    ? "Transcribing"
                    : "Start dictation"
              }
              disabled={dictation.status === "transcribing"}
              onPress={toggleMic}
              style={({ pressed }) => [
                styles.iconButton,
                {
                  backgroundColor:
                    dictation.status === "recording"
                      ? colors.destructive
                      : "transparent",
                  borderColor:
                    dictation.status === "recording"
                      ? "transparent"
                      : colors.border,
                  borderRadius: radii.pill,
                  opacity:
                    dictation.status === "transcribing"
                      ? 0.6
                      : pressed
                        ? 0.7
                        : 1,
                },
              ]}
            >
              <Ionicons
                name={dictation.status === "recording" ? "stop" : "mic"}
                size={dictation.status === "recording" ? 16 : 20}
                color={
                  dictation.status === "recording"
                    ? colors.background
                    : colors.mutedForeground
                }
              />
            </Pressable>
          ) : null}

          {streaming ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop generating"
              onPress={onStop}
              style={({ pressed }) => [
                styles.iconButton,
                {
                  backgroundColor: colors.secondary,
                  borderRadius: radii.pill,
                  borderColor: "transparent",
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons name="stop" size={16} color={colors.secondaryForeground} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={!canSend}
              onPress={submit}
              style={({ pressed }) => [
                styles.iconButton,
                {
                  backgroundColor: colors.primary,
                  borderRadius: radii.pill,
                  borderColor: "transparent",
                  opacity: !canSend ? 0.4 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons name="arrow-up" size={20} color={colors.primaryForeground} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 6 },
  errorBanner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: { fontSize: 13 },
  bar: {
    flexDirection: "column",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  attachRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 6,
    paddingTop: 4,
  },
  uploadingChip: {
    height: 64,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  uploadingText: { fontSize: 12 },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 6,
    paddingTop: 4,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingLeft: 9,
    paddingRight: 7,
    paddingVertical: 5,
  },
  pillLabel: { fontSize: 14 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  iconButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 162,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 10,
  },
});
