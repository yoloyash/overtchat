import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TextInputWrapper } from "expo-paste-input";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import {
  AGENT_IMAGE_MEDIA_TYPES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
  agentPromptImageSchema,
  agentSlashCommandQuery,
  type AgentSlashCommand,
  type AgentProviderId,
  type AgentQueuedMessage,
} from "@overtchat/agent-bridge";
import { uploadFile } from "@/lib/api";
import type { AgentDraft } from "@/lib/agents/drafts";
import { useTheme } from "@/lib/theme";
import { AgentButton, AgentText } from "./AgentPrimitives";
import { AgentProviderIcon } from "./AgentProviderIcon";
import { AgentQueuedMessages } from "./AgentQueuedMessages";
import { AttachmentChip } from "@/components/chat/AttachmentChip";

export function AgentComposer({
  draft,
  setDraft,
  commands,
  supportsImages,
  disabled,
  sending: commandPending,
  running,
  modelLabel,
  modeLabel,
  thinkingLabel,
  provider,
  onSettings,
  onSend,
  onStop,
  queuedMessages = [],
  supportsSteer = false,
  onEditQueued,
  onSteerQueued,
  onRemoveQueued,
}: {
  draft: AgentDraft;
  setDraft: (value: AgentDraft | ((value: AgentDraft) => AgentDraft)) => void;
  commands: AgentSlashCommand[];
  supportsImages: boolean;
  disabled: boolean;
  sending: boolean;
  running: boolean;
  modelLabel: string;
  modeLabel: string;
  thinkingLabel?: string;
  provider?: AgentProviderId;
  onSettings: () => void;
  onSend: () => void;
  onStop: () => void;
  queuedMessages?: AgentQueuedMessage[];
  supportsSteer?: boolean;
  onEditQueued?: (id: string) => Promise<boolean>;
  onSteerQueued?: (id: string) => void;
  onRemoveQueued?: (id: string) => void;
}) {
  const { colors, fonts, radii } = useTheme();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const uploadLock = useRef(false);
  const editLock = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const [editing, setEditing] = useState(false);
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
  const query = agentSlashCommandQuery(draft.message);
  const matches =
    query === null
      ? []
      : commands.filter((command) =>
          `${command.name} ${command.description ?? ""}`
            .toLowerCase()
            .includes(query),
        );

  async function addImages(
    files: { uri: string; name: string; type: string }[],
  ) {
    if (uploadLock.current || disabled || sending) return;
    setError(undefined);
    uploadLock.current = true;
    setUploading(true);
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
      for (const file of files) {
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
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't attach images.",
      );
    } finally {
      uploadLock.current = false;
      setUploading(false);
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

  return (
    <View
      style={{
        gap: 4,
        padding: 8,
        backgroundColor: colors.background,
      }}
    >
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
      {!!error && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss attachment error"
          onPress={() => setError(undefined)}
        >
          <AgentText danger>{error}</AgentText>
        </Pressable>
      )}
      {matches.length > 0 && (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={{ maxHeight: 190 }}
        >
          {matches.map((command) => (
            <AgentButton
              key={`${command.source}:${command.name}`}
              icon="code-slash-outline"
              label={`/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ""}`}
              detail={command.description}
              onPress={() =>
                setDraft({
                  ...draft,
                  message: `/${command.name}${command.argumentHint || command.source !== "builtin" ? " " : ""}`,
                })
              }
            />
          ))}
        </ScrollView>
      )}
      {!!draft.images.length && (
        <ScrollView
          horizontal
          contentContainerStyle={{ gap: 8 }}
          keyboardShouldPersistTaps="handled"
        >
          {draft.images.map((image) => (
            <AttachmentChip
              key={image.uploadId}
              attachment={{
                type: "file",
                url: `/api/uploads/${image.uploadId}`,
                filename: image.filename,
                mediaType: image.mediaType,
              }}
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
        </ScrollView>
      )}
      <View
        style={{
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radii.xl,
          padding: 6,
        }}
      >
        <TextInputWrapper
          onPaste={(payload) => {
            if (payload.type === "images")
              void addImages(
                payload.uris.map((uri, index) => {
                  const name =
                    uri.split("/").pop()?.split("?")[0] ||
                    `pasted-${index}.png`;
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
                }),
              );
          }}
        >
          <TextInput
            ref={inputRef}
            testID="agent-composer-input"
            accessibilityLabel="Message agent"
            multiline
            editable={!sending}
            value={draft.message}
            onChangeText={(message) => setDraft({ ...draft, message })}
            placeholder="Message your agent, or type /"
            placeholderTextColor={colors.mutedForeground}
            style={{
              minHeight: 48,
              maxHeight: 150,
              padding: 10,
              fontFamily: fonts.sansRegular,
              fontSize: 16,
              color: colors.foreground,
            }}
          />
        </TextInputWrapper>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Model, effort, and permissions"
            accessibilityValue={{
              text: [modelLabel, thinkingLabel, modeLabel]
                .filter(Boolean)
                .join(", "),
            }}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onSettings}
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 0,
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 10,
              borderRadius: 10,
              backgroundColor: pressed ? colors.muted : "transparent",
              opacity: disabled ? 0.45 : 1,
            })}
          >
            {provider && <AgentProviderIcon provider={provider} size={22} />}
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: colors.foreground,
                  fontSize: 12,
                  fontFamily: fonts.sansMedium,
                }}
              >
                {modelLabel}
              </Text>
              {!!(thinkingLabel || modeLabel) && (
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.mutedForeground,
                    fontSize: 11,
                    fontFamily: fonts.sansRegular,
                  }}
                >
                  {[thinkingLabel, modeLabel].filter(Boolean).join(" · ")}
                </Text>
              )}
            </View>
            <Ionicons
              name="chevron-down"
              size={14}
              color={colors.mutedForeground}
            />
          </Pressable>
          {uploading ? (
            <ActivityIndicator
              style={{ width: 44 }}
              color={colors.mutedForeground}
            />
          ) : (
            <IconButton
              label="Attach images"
              icon="add"
              disabled={disabled || sending || !supportsImages}
              onPress={() =>
                Alert.alert("Attach images", undefined, [
                  { text: "Photos", onPress: () => void pick(false) },
                  { text: "Camera", onPress: () => void pick(true) },
                  { text: "Cancel", style: "cancel" },
                ])
              }
            />
          )}
          {running && (
            <IconButton
              label="Stop agent"
              icon="stop"
              disabled={disabled || sending}
              onPress={onStop}
            />
          )}
          <IconButton
            label={running ? "Queue message" : "Send message"}
            icon="arrow-up"
            onPress={onSend}
            disabled={
              disabled ||
              sending ||
              uploading ||
              (!draft.message.trim() && !draft.images.length) ||
              (!!draft.images.length && !supportsImages)
            }
            primary
          />
        </View>
      </View>
    </View>
  );
}

function IconButton({
  label,
  icon,
  disabled,
  onPress,
  primary,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  disabled?: boolean;
  onPress: () => void;
  primary?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: primary ? colors.primary : colors.muted,
        }}
      >
        <Ionicons
          name={icon}
          size={20}
          color={primary ? colors.primaryForeground : colors.foreground}
        />
      </View>
    </Pressable>
  );
}
