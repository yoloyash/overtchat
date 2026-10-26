import { ErrorNotice } from "@/components/ErrorNotice";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { TextInputWrapper } from "expo-paste-input";
import ImageViewing from "react-native-image-viewing";
import {
  AGENT_IMAGE_MEDIA_TYPES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
  agentPromptImageSchema,
  agentSlashCommandQuery,
  type AgentProviderId,
  type AgentQueuedMessage,
  type AgentSessionStats,
  type AgentSlashCommand,
} from "@overtchat/agent-bridge";
import { getApiBase, uploadFile } from "@/lib/api";
import { useAuthCookie } from "@/lib/auth/useAuthCookie";
import { agentImageSource } from "@/lib/agents/model";
import type { AgentDraft, DraftImage } from "@/lib/agents/drafts";
import { dictationErrorMessage } from "@/lib/chat/message";
import { useDictation } from "@/lib/useDictation";
import { useTheme } from "@/lib/theme";
import { AgentAttachSheet } from "./AgentAttachSheet";
import { AgentContextButton } from "./AgentContextUsage";
import { AgentProviderIcon } from "./AgentProviderIcon";
import { AgentQueuedMessages } from "./AgentQueuedMessages";

type PickedImage = { uri: string; name: string; type: string };
type PendingImage = { key: string; uri: string };

const THUMBNAIL = 64;

function pastedImage(uri: string, index: number): PickedImage {
  const name = uri.split("/").pop()?.split("?")[0] || `pasted-${index}.png`;
  const ext = name.split(".").pop()?.toLowerCase();
  return {
    uri,
    name,
    type:
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : ext === "gif"
            ? "image/gif"
            : "image/png",
  };
}

export function AgentComposer({
  draft,
  setDraft,
  commands,
  supportsImages,
  disabled,
  canStop,
  sending: commandPending,
  running,
  modelLabel,
  thinkingLabel,
  permission,
  provider,
  contextUsage,
  onContext,
  onSettings,
  onPermissions,
  onSend,
  onStop,
  queuedMessages = [],
  supportsSteer = false,
  onEditQueued,
  onSteerQueued,
  onRemoveQueued,
  isAdmin,
  onBeforeDictate,
}: {
  draft: AgentDraft;
  setDraft: (value: AgentDraft | ((value: AgentDraft) => AgentDraft)) => void;
  commands: AgentSlashCommand[];
  supportsImages: boolean;
  disabled: boolean;
  /** Stop stays available while the agent waits on a response. Defaults to !disabled. */
  canStop?: boolean;
  sending: boolean;
  running: boolean;
  modelLabel: string;
  thinkingLabel?: string;
  /** The current permission mode, shown as a shield next to the model. */
  permission?: { label: string; dangerous: boolean };
  provider?: AgentProviderId;
  /** Context usage for an existing session; omitted before the session exists. */
  contextUsage?: AgentSessionStats["contextUsage"] | null;
  onContext?: () => void;
  onSettings: () => void;
  onPermissions?: () => void;
  onSend: () => void;
  onStop: () => void;
  queuedMessages?: AgentQueuedMessage[];
  supportsSteer?: boolean;
  onEditQueued?: (id: string) => Promise<boolean>;
  onSteerQueued?: (id: string) => void;
  onRemoveQueued?: (id: string) => void;
  isAdmin: boolean;
  /** Stops text-to-speech before dictation so playback is not transcribed. */
  onBeforeDictate?: () => void;
}) {
  const { colors, fonts, radii } = useTheme();
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [error, setError] = useState<string>();
  const uploadLock = useRef(false);
  const editLock = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const [editing, setEditing] = useState(false);
  const uploading = pendingImages.length > 0;
  const sending = commandPending || editing;
  async function editQueued(message: AgentQueuedMessage) {
    if (
      !onEditQueued ||
      editLock.current ||
      disabled ||
      sending ||
      uploading ||
      draft.message.trim() ||
      draft.images.length
    )
      return;
    editLock.current = true;
    setEditing(true);
    try {
      if (!(await onEditQueued(message.id))) return;
      setDraft({
        message: message.message,
        images: (message.images ?? []).map((image) => ({
          ...image,
          uri: `/api/uploads/${image.uploadId}`,
          // Existing uploads are already validated; their byte size isn't in queue snapshots.
          size: 0,
        })),
      });
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      editLock.current = false;
      setEditing(false);
    }
  }
  const dictation = useDictation((message) => {
    setDraft((current) => {
      const trimmed = current.message.trimEnd();
      return {
        ...current,
        message: trimmed ? `${trimmed} ${message}` : message,
      };
    });
  });

  function toggleMic() {
    if (dictation.status === "recording") {
      void dictation.stop();
    } else if (dictation.status === "idle") {
      onBeforeDictate?.();
      void dictation.start();
    }
  }

  const query = agentSlashCommandQuery(draft.message);
  const matches =
    query === null
      ? []
      : commands.filter((command) =>
          `${command.name} ${command.description ?? ""}`
            .toLowerCase()
            .includes(query),
        );

  async function addImages(files: PickedImage[]) {
    if (uploadLock.current || disabled || sending) return;
    setError(undefined);
    uploadLock.current = true;
    const pending = files.map((file, index) => ({
      key: `${Date.now()}:${index}:${file.uri}`,
      uri: file.uri,
    }));
    try {
      if (!supportsImages)
        throw new Error("The selected model does not support images.");
      if (draft.images.length + files.length > MAX_AGENT_IMAGES)
        throw new Error(`Attach up to ${MAX_AGENT_IMAGES} images.`);
      let total = draft.images.reduce((sum, image) => sum + image.size, 0);
      for (const file of files) {
        if (
          !AGENT_IMAGE_MEDIA_TYPES.includes(
            file.type as (typeof AGENT_IMAGE_MEDIA_TYPES)[number],
          )
        )
          throw new Error("Use PNG, JPEG, GIF, or WebP images.");
        const size = new File(file.uri).size;
        if (size > MAX_AGENT_IMAGE_BYTES)
          throw new Error(`${file.name} exceeds 10 MB.`);
        total += size;
        if (total > MAX_AGENT_IMAGE_TOTAL_BYTES)
          throw new Error("Image attachments must total 20 MB or less.");
      }
      // Show the picked images right away; each one settles as it uploads.
      setPendingImages(pending);
      for (const [index, file] of files.entries()) {
        const result = await uploadFile(file);
        const image = agentPromptImageSchema.parse({
          uploadId: result.url.split("/").pop(),
          filename: result.filename,
          mediaType: result.mediaType,
        });
        setDraft((current) => ({
          ...current,
          images: [
            ...current.images,
            { ...image, size: result.size, uri: file.uri },
          ],
        }));
        setPendingImages((current) =>
          current.filter((item) => item.key !== pending[index].key),
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't attach images.",
      );
    } finally {
      uploadLock.current = false;
      setPendingImages([]);
    }
  }

  async function pick(camera: boolean) {
    try {
      if (
        camera &&
        !(await ImagePicker.requestCameraPermissionsAsync()).granted
      )
        throw new Error("Camera permission is required.");
      const result = camera
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 0.9,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsMultipleSelection: true,
            selectionLimit: Math.max(1, MAX_AGENT_IMAGES - draft.images.length),
            quality: 0.9,
          });
      if (!result.canceled)
        await addImages(
          result.assets.map((asset, index) => ({
            uri: asset.uri,
            name: asset.fileName ?? `image-${index}.jpg`,
            type: asset.mimeType ?? "image/jpeg",
          })),
        );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't open photos.",
      );
    }
  }

  const empty = !draft.message.trim() && !draft.images.length;
  const dictating = dictation.status !== "idle";
  const canSend =
    !disabled &&
    !sending &&
    !uploading &&
    !dictating &&
    !empty &&
    (!draft.images.length || supportsImages);
  // Dictation stays available for follow-ups and appends to typed text.
  const showSend = !empty;
  const settingsLabel = [modelLabel, thinkingLabel, permission?.label]
    .filter(Boolean)
    .join(", ");

  return (
    <View style={styles.wrapper}>
      <AgentQueuedMessages
        messages={queuedMessages}
        running={running}
        supportsSteer={supportsSteer}
        disabled={disabled || sending || uploading}
        editDisabled={
          !!draft.message.trim() || !!draft.images.length || !onEditQueued
        }
        onEdit={(message) => void editQueued(message)}
        onSteer={(id) => onSteerQueued?.(id)}
        onRemove={(id) => onRemoveQueued?.(id)}
      />
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
      {!!error && <ErrorNotice message={error} onDismiss={() => setError(undefined)} />}
      {matches.length > 0 && (
        <View
          style={[
            styles.commands,
            {
              backgroundColor: colors.popover,
              borderColor: colors.border,
              borderRadius: radii.xl,
            },
          ]}
        >
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 220 }}>
            {matches.map((command) => {
              const label = `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ""}`;
              return (
                <Pressable
                  key={`${command.source}:${command.name}`}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  onPress={() =>
                    setDraft({
                      ...draft,
                      message: `/${command.name}${command.argumentHint || command.source !== "builtin" ? " " : ""}`,
                    })
                  }
                  style={({ pressed }) => [
                    styles.command,
                    { backgroundColor: pressed ? colors.accent : "transparent" },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.popoverForeground,
                      fontFamily: fonts.mono,
                      fontSize: 13,
                    }}
                  >
                    {label}
                  </Text>
                  {!!command.description && (
                    <Text
                      numberOfLines={2}
                      style={{
                        color: colors.mutedForeground,
                        fontFamily: fonts.sansRegular,
                        fontSize: 12,
                        lineHeight: 16,
                      }}
                    >
                      {command.description}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}
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
        {(draft.images.length > 0 || pendingImages.length > 0) && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.attachments}
          >
            {draft.images.map((image) => (
              <AttachmentThumbnail
                key={image.uploadId}
                image={image}
                onRemove={
                  sending || uploading
                    ? undefined
                    : () =>
                        setDraft((current) => ({
                          ...current,
                          images: current.images.filter(
                            (item) => item.uploadId !== image.uploadId,
                          ),
                        }))
                }
              />
            ))}
            {pendingImages.map((image) => (
              <AttachmentThumbnail key={image.key} pendingUri={image.uri} />
            ))}
          </ScrollView>
        )}
        <TextInputWrapper
          style={styles.inputWrapper}
          onPaste={(payload) => {
            if (payload.type === "images")
              void addImages(payload.uris.map(pastedImage));
          }}
        >
          <TextInput
            ref={inputRef}
            testID="agent-composer-input"
            accessibilityLabel="Message agent"
            multiline
            editable={!sending && dictation.status !== "transcribing"}
            value={draft.message}
            onChangeText={(message) => setDraft({ ...draft, message })}
            placeholder={running ? "Queue a follow-up…" : "Message your agent, or type /"}
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { color: colors.foreground, fontFamily: fonts.sansRegular },
            ]}
          />
        </TextInputWrapper>
        <View style={styles.controls}>
          <ControlButton
            label="Attach images"
            icon="add"
            disabled={disabled || sending || uploading || !supportsImages}
            onPress={() => setAttachOpen(true)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Model, effort, and permissions"
            accessibilityValue={{ text: settingsLabel }}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onSettings}
            style={({ pressed }) => [
              styles.modelTarget,
              { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
            ]}
          >
            <View
              style={[
                styles.modelPill,
                { backgroundColor: colors.muted, borderRadius: radii.pill },
              ]}
            >
              {provider && <AgentProviderIcon provider={provider} size={16} />}
              <Text
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  minWidth: 0,
                  color: colors.foreground,
                  fontFamily: fonts.sansMedium,
                  fontSize: 13,
                }}
              >
                {modelLabel}
                {!!thinkingLabel && (
                  <Text style={{ color: colors.mutedForeground }}>
                    {`  ${thinkingLabel}`}
                  </Text>
                )}
              </Text>
            </View>
          </Pressable>
          {permission && onPermissions && (
            <ControlButton
              label={`Permissions: ${permission.label}`}
              icon={permission.dangerous ? "shield-outline" : "shield-checkmark-outline"}
              tint={permission.dangerous ? colors.destructive : undefined}
              bare
              disabled={disabled}
              onPress={onPermissions}
            />
          )}
          <View style={styles.spacer} />
          {contextUsage !== undefined && onContext && (
            <AgentContextButton usage={contextUsage ?? undefined} onPress={onContext} />
          )}
          <ControlButton
            label={
              dictation.status === "recording"
                ? "Stop dictation"
                : dictation.status === "transcribing"
                  ? "Transcribing"
                  : "Start dictation"
            }
            icon={dictation.status === "recording" ? "stop" : "mic"}
            danger={dictation.status === "recording"}
            loading={dictation.status === "transcribing"}
            disabled={
              dictation.status === "transcribing" ||
              (dictation.status !== "recording" &&
                (disabled || sending || uploading))
            }
            onPress={toggleMic}
          />
          {running && (
            <ControlButton
              label="Stop agent"
              icon="stop"
              filled
              disabled={!(canStop ?? !disabled) || sending}
              onPress={onStop}
            />
          )}
          {showSend && (
            <ControlButton
              label={running ? "Queue message" : "Send message"}
              icon="arrow-up"
              primary
              loading={sending || uploading}
              disabled={!canSend}
              onPress={onSend}
            />
          )}
        </View>
      </View>
      <AgentAttachSheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        onPick={(camera) => void pick(camera)}
      />
    </View>
  );
}

function AttachmentThumbnail({
  image,
  pendingUri,
  onRemove,
}: {
  image?: DraftImage;
  pendingUri?: string;
  onRemove?: () => void;
}) {
  const { colors, radii } = useTheme();
  const cookie = useAuthCookie();
  const [localFailed, setLocalFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const local = pendingUri ?? image?.uri ?? "";
  const remote = image
    ? agentImageSource(`/api/uploads/${image.uploadId}`, getApiBase(), cookie ?? "")
    : null;
  // Prefer the on-device copy; restored drafts may outlive it.
  const source =
    local && !local.startsWith("/") && !localFailed ? { uri: local } : remote;
  const label = image?.filename ?? "Uploading image";
  return (
    <View
      style={[
        styles.thumbnail,
        {
          borderColor: colors.border,
          backgroundColor: colors.muted,
          borderRadius: radii.md,
        },
      ]}
    >
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={pendingUri ? "Uploading image" : `Preview ${label}`}
        accessibilityState={{ busy: !!pendingUri }}
        disabled={!!pendingUri || !source}
        onPress={() => setOpen(true)}
        style={StyleSheet.absoluteFill}
      >
        {source && (
          <Image
            source={source}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={120}
            onError={() => {
              if (source !== remote) setLocalFailed(true);
            }}
          />
        )}
      </Pressable>
      {!!pendingUri && (
        <View style={[StyleSheet.absoluteFill, styles.uploading]}>
          <ActivityIndicator color="#fff" />
        </View>
      )}
      {onRemove && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          hitSlop={8}
          onPress={onRemove}
          style={styles.remove}
        >
          <View
            style={[
              styles.removeSurface,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <Ionicons name="close" size={12} color={colors.foreground} />
          </View>
        </Pressable>
      )}
      {source && (
        <ImageViewing
          images={[source]}
          imageIndex={0}
          visible={open}
          onRequestClose={() => setOpen(false)}
          swipeToCloseEnabled
          doubleTapToZoomEnabled
        />
      )}
    </View>
  );
}

function ControlButton({
  label,
  icon,
  disabled,
  onPress,
  primary,
  filled,
  danger,
  bare,
  tint,
  loading,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  disabled?: boolean;
  onPress: () => void;
  primary?: boolean;
  /** A solid secondary control, such as Stop. */
  filled?: boolean;
  danger?: boolean;
  /** Icon only, without a ring. */
  bare?: boolean;
  tint?: string;
  loading?: boolean;
}) {
  const { colors, radii } = useTheme();
  const background = primary
    ? colors.primary
    : danger
      ? colors.destructive
      : filled
        ? colors.secondary
        : "transparent";
  const foreground = primary
    ? colors.primaryForeground
    : danger
      ? colors.background
      : filled
        ? colors.secondaryForeground
        : (tint ?? colors.mutedForeground);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.controlTarget,
        { opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
      ]}
    >
      <View
        style={[
          primary || filled || danger ? styles.solidSurface : styles.ringSurface,
          {
            backgroundColor: background,
            borderColor: primary || filled || danger || bare ? "transparent" : colors.border,
            borderRadius: radii.pill,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={foreground} />
        ) : (
          <Ionicons
            name={icon}
            size={icon === "stop" ? 15 : bare ? 20 : 19}
            color={foreground}
          />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  commands: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
    overflow: "hidden",
  },
  command: { paddingHorizontal: 14, paddingVertical: 9, gap: 2 },
  bar: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  attachments: { gap: 8, paddingHorizontal: 6, paddingTop: 4 },
  thumbnail: {
    width: THUMBNAIL,
    height: THUMBNAIL,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  uploading: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  remove: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 32,
    height: 32,
  },
  removeSurface: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  inputWrapper: { alignSelf: "stretch" },
  input: {
    minHeight: 42,
    maxHeight: 162,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 10,
  },
  controls: { flexDirection: "row", alignItems: "center", gap: 2 },
  controlTarget: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  ringSurface: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  solidSurface: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  modelTarget: {
    height: 44,
    flexShrink: 1,
    minWidth: 0,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  modelPill: {
    height: 34,
    minWidth: 0,
    flexShrink: 1,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
  },
  spacer: { flex: 1, minWidth: 4 },
});
