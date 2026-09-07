import { Ionicons } from "@expo/vector-icons";
import type { ModelBrandIconId } from "@overtchat/shared";
import type { FileUIPart } from "ai";
import * as Haptics from "expo-haptics";
import { TextInputWrapper } from "expo-paste-input";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import type { AttachmentMeta } from "@/lib/chat/attachments";
import { dictationErrorMessage } from "@/lib/chat/message";
import { useTheme } from "@/lib/theme";
import { toastError } from "@/lib/toast";
import { useDictation } from "@/lib/useDictation";
import { AttachmentChip } from "./AttachmentChip";

export function Composer({
  configured,
  streaming,
  searchAvailable,
  searchRequested,
  modelLabel,
  modelIconId,
  thinkingLevelLabel,
  attachments,
  attachmentMeta,
  uploading,
  uploadError,
  isAdmin,
  onClearSearch,
  onOpenModelPicker,
  onOpenAddSheet,
  onRemoveAttachment,
  onDismissUploadError,
  onPasteImages,
  onSubmit,
  onStop,
}: {
  configured: boolean;
  streaming: boolean;
  searchAvailable: boolean;
  searchRequested: boolean;
  modelLabel?: string;
  modelIconId?: ModelBrandIconId;
  thinkingLevelLabel?: string;
  attachments: FileUIPart[];
  attachmentMeta: Record<string, AttachmentMeta>;
  uploading: boolean;
  uploadError: string | null;
  isAdmin: boolean;
  onClearSearch: () => void;
  onOpenModelPicker: () => void;
  onOpenAddSheet: () => void;
  onRemoveAttachment: (index: number) => void;
  onDismissUploadError: () => void;
  onPasteImages: (uris: string[]) => void;
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

  function clearSearch() {
    Haptics.selectionAsync().catch(() => { });
    onClearSearch();
  }

  function openModelPicker() {
    Haptics.selectionAsync().catch(() => {});
    onOpenModelPicker();
  }

  const canSend =
    (input.trim().length > 0 || attachments.length > 0) &&
    !streaming &&
    !uploading &&
    configured;
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

        <TextInputWrapper
          style={styles.inputWrapper}
          onPaste={(payload) => {
            if (payload.type === "images") onPasteImages(payload.uris);
          }}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            editable={configured && dictation.status !== "transcribing"}
            multiline
            placeholder={configured ? "Message…" : "No models configured"}
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { color: colors.foreground, fontFamily: fonts.sansRegular },
            ]}
          />
        </TextInputWrapper>

        <View style={styles.controlsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              searchAvailable
                ? "Add to chat"
                : "Add to chat; web search unavailable for this model"
            }
            onPress={openAdd}
            style={({ pressed }) => [
              styles.iconHitTarget,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View
              style={[
                styles.secondaryButtonSurface,
                {
                  borderColor: colors.border,
                  borderRadius: radii.pill,
                },
              ]}
            >
              <Ionicons name="add" size={19} color={colors.mutedForeground} />
            </View>
          </Pressable>

          {searchRequested ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Turn off Search for this message"
              accessibilityState={{ selected: true }}
              onPress={clearSearch}
              style={({ pressed }) => [
                styles.iconHitTarget,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View
                style={[
                  styles.secondaryButtonSurface,
                  {
                    backgroundColor: colors.accent,
                    borderColor: "transparent",
                    borderRadius: radii.pill,
                  },
                ]}
              >
                <Ionicons
                  name="globe-outline"
                  size={18}
                  color={colors.foreground}
                />
              </View>
            </Pressable>
          ) : null}

          {modelLabel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                thinkingLevelLabel
                  ? `Model and thinking: ${modelLabel}, ${thinkingLevelLabel}`
                  : `Model: ${modelLabel}`
              }
              onPress={openModelPicker}
              style={({ pressed }) => [
                styles.modelHitTarget,
                { opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <View
                style={[
                  styles.modelButtonSurface,
                  {
                    backgroundColor: colors.muted,
                    borderRadius: radii.pill,
                  },
                ]}
              >
                <ModelBrandIcon
                  iconId={modelIconId}
                  color={colors.mutedForeground}
                  size={15}
                  style={styles.modelButtonIcon}
                />
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[
                    styles.modelButtonLabel,
                    {
                      color: colors.foreground,
                      fontFamily: fonts.sansMedium,
                    },
                  ]}
                >
                  {modelLabel}
                </Text>
                {thinkingLevelLabel ? (
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.modelButtonThinking,
                      {
                        color: colors.mutedForeground,
                        fontFamily: fonts.sansMedium,
                      },
                    ]}
                  >
                    {thinkingLevelLabel}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ) : null}

          <View style={styles.controlsSpacer} />

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
                styles.iconHitTarget,
                {
                  opacity:
                    dictation.status === "transcribing"
                      ? 0.6
                      : pressed
                        ? 0.7
                        : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.secondaryButtonSurface,
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
                  },
                ]}
              >
                <Ionicons
                  name={dictation.status === "recording" ? "stop" : "mic"}
                  size={dictation.status === "recording" ? 15 : 19}
                  color={
                    dictation.status === "recording"
                      ? colors.background
                      : colors.mutedForeground
                  }
                />
              </View>
            </Pressable>
          ) : null}

          {streaming ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop generating"
              onPress={onStop}
              style={({ pressed }) => [
                styles.iconHitTarget,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View
                style={[
                  styles.primaryButtonSurface,
                  {
                    backgroundColor: colors.secondary,
                    borderRadius: radii.pill,
                  },
                ]}
              >
                <Ionicons
                  name="stop"
                  size={15}
                  color={colors.secondaryForeground}
                />
              </View>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={!canSend}
              onPress={submit}
              style={({ pressed }) => [
                styles.iconHitTarget,
                {
                  opacity: !canSend ? 0.4 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.primaryButtonSurface,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: radii.pill,
                  },
                ]}
              >
                <Ionicons
                  name="arrow-up"
                  size={19}
                  color={colors.primaryForeground}
                />
              </View>
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
    minHeight: 48,
    justifyContent: "center",
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
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  inputWrapper: { alignSelf: "stretch" },
  modelHitTarget: {
    height: 48,
    maxWidth: 210,
    minWidth: 0,
    flexShrink: 1,
    justifyContent: "center",
  },
  modelButtonSurface: {
    height: 36,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
  },
  modelButtonIcon: { flexShrink: 0 },
  modelButtonLabel: { flexShrink: 1, minWidth: 0, fontSize: 13 },
  modelButtonThinking: { flexShrink: 0, fontSize: 13 },
  controlsSpacer: { flex: 1 },
  iconHitTarget: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonSurface: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  primaryButtonSurface: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    minHeight: 42,
    maxHeight: 162,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 10,
  },
});
