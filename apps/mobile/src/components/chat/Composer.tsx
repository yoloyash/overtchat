import { ErrorNotice } from "@/components/ErrorNotice";
import { Ionicons } from "@expo/vector-icons";
import type { ImageGenerationOptions, ModelBrandIconId } from "@overtchat/shared";
import type { FileUIPart } from "ai";
import * as Haptics from "expo-haptics";
import { TextInputWrapper } from "expo-paste-input";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { ImageOptions } from "./ImageOptions";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import type { AttachmentMeta } from "@/lib/chat/attachments";
import { dictationErrorMessage } from "@/lib/chat/message";
import { useTheme } from "@/lib/theme";
import { toastError } from "@/lib/toast";
import { useDictation } from "@/lib/useDictation";
import { MessageQueue, type MessageQueueProps } from "./MessageQueue";
import { AttachmentChip } from "./AttachmentChip";

const AUDIO_LINES_PATHS = [
  "M2 10v3",
  "M6 6v11",
  "M10 3v18",
  "M14 8v7",
  "M18 5v13",
  "M22 10v3",
] as const;

export function Composer({
  chatQueue,
  voiceInstalled = false,
  voiceEligible = false,
  voiceAvailable = false,
  voiceActive = false,
  voiceUnavailableReason = "Realtime voice is unavailable",
  textInputDisabled = false,
  endVoiceDisabled = false,
  onStartVoice,
  onEndVoice,
  onBeforeDictate,
  configured,
  modelLoading = false,
  streaming,
  searchAvailable,
  searchRequested,
  imageOptions, imageModel, imageSupportsQuality, imageConfiguredSize, onImageOptions,
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
  chatQueue: MessageQueueProps;
  voiceInstalled?: boolean;
  voiceEligible?: boolean;
  voiceAvailable?: boolean;
  voiceActive?: boolean;
  voiceUnavailableReason?: string;
  textInputDisabled?: boolean;
  endVoiceDisabled?: boolean;
  onStartVoice?: () => void;
  onEndVoice?: () => void;
  onBeforeDictate?: () => void;
  configured: boolean;
  modelLoading?: boolean;
  streaming: boolean;
  searchAvailable: boolean;
  searchRequested: boolean;
  imageOptions?: ImageGenerationOptions;
  imageModel?: string | null;
  imageSupportsQuality?: boolean;
  imageConfiguredSize?: string;
  onImageOptions?: (value: ImageGenerationOptions | undefined) => void;
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
  onSubmit: (text: string, attachments: FileUIPart[]) => void | boolean | Promise<boolean>;
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

  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const text = input.trim();
    if (uploading || !configured || submitting || textInputDisabled) return;
    if (streaming && text.toLowerCase() === "/compact" && !attachments.length) return;
    if (!text && attachments.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
    setSubmitting(true);
    try {
      if (await onSubmit(text, attachments) !== false) setInput(current => current.trim() === text ? "" : current);
    } finally { setSubmitting(false); }
  }

  function toggleMic() {
    Haptics.selectionAsync().catch(() => {});
    if (dictation.status === "recording") {
      void dictation.stop();
    } else if (dictation.status === "idle") {
      onBeforeDictate?.();
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
    !uploading &&
    !submitting &&
    !textInputDisabled &&
    configured;
  const showVoiceButton =
    !voiceActive &&
    !streaming &&
    voiceInstalled &&
    voiceEligible &&
    !input.trim() &&
    attachments.length === 0 &&
    !uploading &&
    dictation.status === "idle";
  const showAttachmentsRow = attachments.length > 0 || uploading;

  return (
    <View style={styles.wrapper}>
      <MessageQueue {...chatQueue} />
      {dictation.error && (
        <ErrorNotice
          message={dictationErrorMessage(dictation.error, isAdmin)}
          onDismiss={dictation.clearError}
          action={
            dictation.error.kind === "empty" || dictation.error.kind === "other" ||
            (dictation.error.kind === "stt_unavailable" &&
              !["speech_disabled", "speech_not_configured", "speech_provider_auth"].includes(dictation.error.code ?? ""))
              ? { label: "Record again", onPress: toggleMic }
              : undefined
          }
        />
      )}
      {imageOptions && onImageOptions ? <ImageOptions value={imageOptions} model={imageModel} supportsQuality={imageSupportsQuality} configuredSize={imageConfiguredSize} onChange={onImageOptions} onClose={() => onImageOptions(undefined)} /> : null}
      {uploadError && <ErrorNotice message={uploadError} onDismiss={onDismissUploadError} />}

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
            if (!voiceActive && payload.type === "images") onPasteImages(payload.uris);
          }}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            editable={
              configured &&
              !textInputDisabled &&
              !submitting &&
              dictation.status !== "transcribing"
            }
            multiline
            placeholder={
              textInputDisabled
                ? "Resume voice to continue"
                : configured
                  ? "Message…"
                  : modelLoading
                    ? "Loading model…"
                    : "No models configured"
            }
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
            accessibilityState={{ disabled: voiceActive || textInputDisabled }}
            disabled={voiceActive || textInputDisabled}
            onPress={openAdd}
            style={({ pressed }) => [
              styles.iconHitTarget,
              {
                opacity:
                  voiceActive || textInputDisabled ? 0.4 : pressed ? 0.7 : 1,
              },
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

          {searchRequested && !voiceActive ? (
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
              accessibilityState={{ disabled: textInputDisabled }}
              disabled={textInputDisabled}
              onPress={openModelPicker}
              style={({ pressed }) => [
                styles.modelHitTarget,
                { opacity: textInputDisabled ? 0.5 : pressed ? 0.8 : 1 },
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

          {!voiceActive && !streaming && !canSend ? (
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

          {streaming && (
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
          )}
          {voiceActive && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="End voice session"
              accessibilityState={{ disabled: endVoiceDisabled }}
              disabled={endVoiceDisabled}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                  () => {},
                );
                onEndVoice?.();
              }}
              style={({ pressed }) => [
                styles.iconHitTarget,
                {
                  opacity: endVoiceDisabled ? 0.4 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.secondaryButtonSurface,
                  {
                    backgroundColor: colors.secondary,
                    borderColor: "transparent",
                    borderRadius: radii.pill,
                  },
                ]}
              >
                <Ionicons
                  name="close"
                  size={19}
                  color={colors.secondaryForeground}
                />
              </View>
            </Pressable>
          )}
          {showVoiceButton ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start voice conversation"
              accessibilityHint={
                !voiceAvailable ? voiceUnavailableReason : undefined
              }
              accessibilityState={{ disabled: !voiceAvailable }}
              onPress={() => {
                if (!voiceAvailable) {
                  toastError(voiceUnavailableReason);
                  return;
                }
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                  () => {},
                );
                onStartVoice?.();
              }}
              style={({ pressed }) => [
                styles.iconHitTarget,
                {
                  opacity: !voiceAvailable ? 0.4 : pressed ? 0.85 : 1,
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
                <Svg
                  accessible={false}
                  width={18}
                  height={18}
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  {AUDIO_LINES_PATHS.map((d) => (
                    <Path
                      key={d}
                      d={d}
                      stroke={colors.primaryForeground}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                </Svg>
              </View>
            </Pressable>
          ) : (
            (canSend || !streaming) && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  streaming ? "Queue message" : "Send message"
                }
                accessibilityState={{
                  disabled: !canSend,
                  busy: submitting || uploading,
                }}
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
                  {submitting || uploading ? (
                    <ActivityIndicator
                      size="small"
                      color={colors.primaryForeground}
                    />
                  ) : (
                    <Ionicons
                      name="arrow-up"
                      size={19}
                      color={colors.primaryForeground}
                    />
                  )}
                </View>
              </Pressable>
            )
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 6 },
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
