import { ChatUsageBar } from "@/components/chat/ChatUsageBar";
import { Ionicons } from "@expo/vector-icons";
import { useChat } from "@ai-sdk/react";
import {
  hasSuccessfulMemoryMutation,
  modelSupportsChatReasoningLevel,
  modelSupportsToolCalling,
  type OpenUIAction,
  type ChatReasoningLevel,
  type ChatRequestAction,
} from "@overtchat/shared";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { useHeaderHeight } from "expo-router/react-navigation";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { router, useNavigation } from "expo-router";
import { fetch as expoFetch } from "expo/fetch";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  KeyboardAvoidingView,
  useKeyboardState,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AddToChatSheet } from "@/components/chat/AddToChatSheet";
import { ErrorNotice } from "@/components/ErrorNotice";
import { VoiceControls } from "@/components/chat/VoiceControls";
import { useMobileVoice } from "@/lib/voice/useMobileVoice";
import { Composer } from "@/components/chat/Composer";
import { ShareChatButton } from "@/components/chat/ShareChatButton";
import { MessageList } from "@/components/chat/MessageList";
import { MiniSpeechPlayer } from "@/components/chat/MiniSpeechPlayer";
import {
  ModelPickerSheet,
  reasoningLabel,
  reasoningOptionsForControls,
  type ModelPickerSheetRef,
} from "@/components/chat/ModelPickerSheet";
import { authFetch, getApiBase } from "@/lib/api";
import { getAuthClient } from "@/lib/auth/client";
import { useCapabilities } from "@/lib/queries/capabilities";
import { imageOptionsFromMetadata, type ImageGenerationOptions } from "@overtchat/shared";
import { useAttachments, type PickedFile } from "@/lib/chat/useAttachments";
import { useChatSession } from "@/lib/chat/session";
import { useChatQueue } from "@/lib/chat/useChatQueue";
import { useChatGenerationRecovery } from "@/lib/chat/useChatGenerationRecovery";
import { useChatMessages } from "@/lib/queries/chatMessages";
import { useModelConfigs } from "@/lib/queries/modelConfigs";
import { useOptionalProject } from "@/lib/queries/projects";
import type { ChatListItem } from "@/lib/queries/chats";
import { queryKeys } from "@/lib/queries/keys";
import { useSelectedModel } from "@/lib/modelPreferences";
import {
  setReasoningLevel,
  useReasoningLevels,
} from "@/lib/reasoningPreferences";
import { useOpenUIEnabled, useWebSearchEnabled } from "@/lib/toolPreferences";
import { useSpeech } from "@/lib/useSpeech";
import { useTheme } from "@/lib/theme";
import { toastError } from "@/lib/toast";
import {
  CONTEXT_STATUS_DATA_TYPE,
  isContextStatus,
  type ContextStatus,
} from "@overtchat/shared";

export default function ChatScreen() {
  const { activeChatId, isNewChat, activeProjectId } = useChatSession();
  return (
    <ChatGate
      key={activeChatId}
      chatId={activeChatId}
      isNew={isNewChat}
      newChatProjectId={activeProjectId}
    />
  );
}

function ChatGate({
  chatId,
  isNew,
  newChatProjectId,
}: {
  chatId: string;
  isNew: boolean;
  newChatProjectId: string | null;
}) {
  const { colors, fonts } = useTheme();
  const {
    data: hydration,
    isPending,
    error,
    refetch,
  } = useChatMessages(isNew ? null : chatId);

  if (!isNew && isPending) {
    return (
      <View style={[styles.gate, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  if (!isNew && error) {
    return (
      <View style={[styles.gate, { backgroundColor: colors.background }]}>
        <Text
          style={[
            styles.gateError,
            { color: colors.destructive, fontFamily: fonts.sansRegular },
          ]}
        >
          {error.message || "Couldn't load chat"}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => refetch()}
          style={({ pressed }) => [
            styles.gateRetry,
            {
              backgroundColor: colors.primary,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.gateRetryText,
              {
                color: colors.primaryForeground,
                fontFamily: fonts.sansSemiBold,
              },
            ]}
          >
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ChatSurface
      chatId={chatId}
      isNew={isNew}
      initialMessages={hydration?.messages}
      initialModelId={hydration?.modelConfigId}
      projectId={isNew ? newChatProjectId : (hydration?.projectId ?? null)}
    />
  );
}

function ChatSurface({
  initialModelId,
  chatId,
  isNew,
  initialMessages,
  projectId,
}: {
  chatId: string;
  isNew: boolean;
  initialMessages: UIMessage[] | undefined;
  initialModelId?: string | null;
  projectId: string | null;
}) {
  const { colors, fonts } = useTheme();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const { startNewChat } = useChatSession();
  const qc = useQueryClient();
  const baseURL = useMemo(() => getApiBase(), []);
  const session = getAuthClient().useSession();
  const isAdmin =
    (session.data?.user as { role?: string | null } | undefined)?.role ===
    "admin";
  const speech = useSpeech();

  const {
    data: models,
    isPending: modelsPending,
    error: modelsError,
  } = useModelConfigs();
  const {
    refreshing: refreshingMessages,
    refresh: refreshMessages,
  } = useChatMessages(isNew ? null : chatId);

  const { data: project } = useOptionalProject(projectId);
  const [selectedId, setSelectedId] = useSelectedModel(
    models,
    initialModelId,
    projectId,
  );
  const [searchRequested, setSearchRequested] = useState(false);
  const [openuiRequested, setOpenuiRequested] = useState(false);
  const [imageOptions, setImageOptions] = useState<ImageGenerationOptions>();
  const { data: capabilitiesData } = useCapabilities();
  const imageCapability = capabilitiesData?.capabilities.images;
  const [chatPersisted, setChatPersisted] = useState(!isNew);
  const webSearchEnabled = useWebSearchEnabled();
  const openuiEnabled = useOpenUIEnabled();
  const reasoningLevels = useReasoningLevels();
  const pickerRef = useRef<ModelPickerSheetRef>(null);
  const addSheetRef = useRef<BottomSheetModal>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${baseURL}/api/chat`,
        fetch: ((
          input: Parameters<typeof expoFetch>[0],
          init?: Parameters<typeof expoFetch>[1],
        ) => authFetch(input, init)) as unknown as typeof globalThis.fetch,
        prepareSendMessagesRequest: ({
          messages,
          body,
          trigger,
          messageId,
        }) => ({
          body: { ...body, messages, trigger, messageId },
        }),
      }),
    [baseURL],
  );

  const [contextStatus, setContextStatus] = useState<ContextStatus | null>(
    null,
  );
  const {
    messages,
    setMessages,
    sendMessage,
    regenerate,
    status,
    stop,
    error,
    resumeStream,
    clearError,
  } = useChat({
    id: chatId,
    // Rendering every provider delta makes the React Native tree contend with
    // scrolling and touch handling. The AI SDK coalesces subscriber updates.
    throttle: 60,
    resume: false,
    transport,
    messages: initialMessages,
    onData: (part) => {
      if (
        part.type === CONTEXT_STATUS_DATA_TYPE &&
        isContextStatus(part.data)
      ) {
        setContextStatus(part.data);
      }
    },
    onError: () => {
      setContextStatus(null);
      setMessages((current) =>
        current.filter(
          (m) =>
            (m.metadata as { contextStatus?: string } | undefined)
              ?.contextStatus !== "manual-compacting",
        ),
      );
    },
    onFinish: ({ message, isAbort }) => {
      setMessages((current) =>
        current.filter(
          (m) =>
            (m.metadata as { contextStatus?: string } | undefined)
              ?.contextStatus !== "manual-compacting",
        ),
      );
      setContextStatus(null);
      if (hasSuccessfulMemoryMutation(message)) {
        void qc.invalidateQueries({ queryKey: queryKeys.personalization() });
      }
      if (isAbort) return;
      setChatPersisted(true);
      void qc.invalidateQueries({ queryKey: queryKeys.chats() });
      void qc.invalidateQueries({ queryKey: queryKeys.chatMessages(chatId) });
    },
  });

  const handleGenerationSettled = useCallback(() => {
    setChatPersisted(true);
    void qc.invalidateQueries({ queryKey: queryKeys.chats() });
    void qc.invalidateQueries({ queryKey: queryKeys.chatMessages(chatId) });
  }, [chatId, qc]);
  const voice = useMobileVoice({
    chatId,
    onMessage: message => setMessages(current => current.some(item => item.id === message.id)
      ? current.map(item => item.id === message.id ? message : item)
      : [...current, message]),
    onRefresh: setMessages,
    onPersisted: handleGenerationSettled,
  });
  const voiceBusyRef = useRef(voice.busy);
  voiceBusyRef.current = voice.busy;
  const generation = useChatGenerationRecovery({
    baseURL,
    chatId,
    enabled: chatPersisted && !voice.busy,
    suspended: voice.busy,
    status,
    recoverOnMount: !isNew,
    stopLocalStream: stop,
    resumeStream,
    clearError,
    setMessages,
    onSettled: handleGenerationSettled,
  });

  const chatQueue = useChatQueue({
    chatId,
    userId: session.data?.user.id,
    status: voice.busy ? "submitted" : status,
    sendMessage: (message, options) => {
      setLocalAnchorRequestKey((key) => key + 1);
      return sendMessage(message, options);
    },
    generation,
  });

  const handleStop = useCallback(() => {
    chatQueue.queue.pause();
    void generation
      .cancel()
      .catch((error) => toastError("Could not stop the response", error));
  }, [generation, chatQueue.queue]);

  const streaming = status === "streaming" || status === "submitted";
  const configured = Boolean(selectedId);
  const modelLoading =
    modelsPending || (!modelsError && (models?.length ?? 0) > 0 && !selectedId);
  const selectedModel = models?.find((m) => m.id === selectedId) ?? null;
  const reasoningControls = selectedModel?.capabilities?.reasoningControls;
  const storedReasoningLevel = selectedId
    ? reasoningLevels[selectedId]
    : undefined;
  const reasoningLevel: ChatReasoningLevel =
    storedReasoningLevel !== "default" &&
    modelSupportsChatReasoningLevel(
      selectedModel?.capabilities,
      storedReasoningLevel,
    )
      ? storedReasoningLevel
      : (reasoningControls?.defaultLevel ?? "default");
  const thinkingLevelLabel =
    reasoningOptionsForControls(reasoningControls).length > 1
      ? reasoningLabel(reasoningLevel)
      : undefined;
  const imageAvailable = Boolean(imageCapability?.available && modelSupportsToolCalling(selectedModel));
  const searchAvailable =
    webSearchEnabled && modelSupportsToolCalling(selectedModel);
  const searchUnavailableReason = !webSearchEnabled
    ? "Web search is disabled in Settings → Tools"
    : "Unavailable for this model";
  const openuiAvailable = modelSupportsToolCalling(selectedModel);
  const openuiUnavailableReason = "Unavailable for this model";
  const voiceCapability = capabilitiesData?.capabilities.voice;
  const voiceInstalled = Boolean(voiceCapability?.installed);
  const [editingId, setEditingId] = useState<string | null>(null);
  const voiceEligible = Boolean(
    !editingId &&
      !imageOptions &&
      !searchRequested &&
      !openuiRequested &&
      chatQueue.messages.length === 0,
  );
  const voiceAvailable = Boolean(
    voice.available &&
      voiceCapability?.available &&
      configured &&
      voiceEligible,
  );
  const voiceUnavailableReason = !voice.available
    ? "Live voice requires an updated mobile app"
    : !configured
      ? modelLoading
        ? "Loading model…"
        : "Configure a model before starting voice"
      : voiceCapability?.unavailableReason === "stt-unavailable"
        ? "Speech-to-text is disabled"
        : voiceCapability?.unavailableReason === "tts-unavailable"
          ? "Text-to-speech is disabled"
          : voiceCapability?.unavailableReason === "not-configured"
            ? "Voice authentication is not configured"
            : "Realtime voice is unavailable";

  const {
    attachments,
    attachmentMeta,
    uploading,
    error: uploadError,
    addFiles,
    addReference,
    remove: removeAttachment,
    clear: clearAttachments,
    dismissError: dismissUploadError,
  } = useAttachments();

  const onNewChat = useCallback(() => {
    startNewChat();
  }, [startNewChat]);

  const pickFromCamera = useCallback(async () => {
    addSheetRef.current?.dismiss();
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      toastError("Camera permission required");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (result.canceled) return;
    void addFiles(result.assets.map(assetToPickedFile));
  }, [addFiles]);

  const pickFromPhotos = useCallback(async () => {
    addSheetRef.current?.dismiss();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toastError("Photo library permission required");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.9,
    });
    if (result.canceled) return;
    void addFiles(result.assets.map(assetToPickedFile));
  }, [addFiles]);

  const pickFromFiles = useCallback(async () => {
    addSheetRef.current?.dismiss();
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "text/*",
      ],
    });
    if (result.canceled) return;
    const picked: PickedFile[] = result.assets.map((a) => ({
      uri: a.uri,
      name: a.name ?? "file",
      type: a.mimeType ?? "application/octet-stream",
    }));
    void addFiles(picked);
  }, [addFiles]);

  const onPickTool = useCallback(
    (tool: "camera" | "photos" | "files") => {
      if (tool === "camera") void pickFromCamera();
      else if (tool === "photos") void pickFromPhotos();
      else void pickFromFiles();
    },
    [pickFromCamera, pickFromPhotos, pickFromFiles],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: project
        ? () => (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open project ${project.name}`}
              onPress={() => router.push(`/projects/${project.id}`)}
              hitSlop={8}
              style={({ pressed }) => [
                styles.projectChip,
                { backgroundColor: pressed ? colors.muted : "transparent" },
              ]}
            >
              <Ionicons
                name="folder-outline"
                size={15}
                color={colors.mutedForeground}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.projectChipText,
                  { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
                ]}
              >
                {project.name}
              </Text>
            </Pressable>
          )
        : "",
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {chatPersisted && (
            <ShareChatButton chatId={chatId} disabled={streaming || voice.busy} />
          )}
          <Pressable
            accessibilityRole="button"
            onPress={onNewChat}
            hitSlop={10}
            style={styles.headerRight}
          >
            <Ionicons name="create-outline" size={22} color={colors.foreground} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, colors, fonts, project, onNewChat, chatId, chatPersisted, streaming, voice.busy]);

  function requestBody(
    action: ChatRequestAction,
    forceSearch = false,
    imageRequest?: ImageGenerationOptions,
    forceOpenUI = false,
  ) {
    const requested = searchAvailable && forceSearch;
    const requestedOpenUI = openuiAvailable && forceOpenUI;
    return {
      modelConfigId: selectedId,
      webSearchEnabled,
      forceSearch: requested,
      openuiSupported: true,
      openuiEnabled,
      forceOpenUI: requestedOpenUI,
      ...(imageAvailable && imageRequest ? { imageGeneration: imageRequest } : {}),
      // Older self-hosted servers only understand the persisted-toggle name.
      // New servers give `forceSearch` precedence and discard this alias.
      searchEnabled: requested,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      chatId,
      clientRequestId: Crypto.randomUUID(),
      projectId,
      temporary: false,
      action,
      ...(reasoningControls ? { reasoningLevel } : {}),
    };
  }

  const isNewRef = useRef(isNew);

  const [localAnchorRequestKey, setLocalAnchorRequestKey] = useState(0);

  const lastErrorRef = useRef<Error | undefined>(undefined);
  useEffect(() => {
    if (error && error !== lastErrorRef.current) {
      if (/abort|connection|fetch|network|socket/i.test(error.message)) {
        void generation.reconcile().catch(() => undefined);
      } else {
        toastError("Chat error", error);
      }
    }
    lastErrorRef.current = error;
  }, [error, generation]);

  async function onRefreshMessages() {
    if (isNew || voice.busy) return;
    const res = await refreshMessages();
    if (res?.error) toastError("Couldn't refresh messages", res.error);
    else if (res?.data?.messages && !voiceBusyRef.current)
      setMessages(res.data.messages);
  }

  function handleSubmit(text: string, files: FileUIPart[], openuiAction?: OpenUIAction) {
    if (voice.busy) return files.length ? false : voice.sendMessage(text);
    Keyboard.dismiss();
    if (!openuiAction && text.trim().toLowerCase() === "/compact" && files.length === 0) {
      if (voice.busy || streaming || !configured || messages.length === 0) return;
      setContextStatus(null);
      setLocalAnchorRequestKey((key) => key + 1);
      void sendMessage(undefined, { body: requestBody({ type: "compact" }) });
      return;
    }
    const wasNew = isNewRef.current;
    if (wasNew) {
      isNewRef.current = false;
      setChatPersisted(true);
      qc.setQueryData<ChatListItem[]>(queryKeys.chats(), (prev) => {
        const next: ChatListItem = {
          id: chatId,
          title: null,
          kind: "text",
          pinned: false,
          projectId,
          updatedAt: Date.now(),
        };
        if (!prev) return [next];
        if (prev.some((c) => c.id === chatId)) return prev;
        return [next, ...prev];
      });
    }
    chatQueue.queue.enqueue({
      id: Crypto.randomUUID(),
      text,
      files,
      body: {
        ...requestBody(
          { type: "submit" },
          openuiAction ? false : searchRequested,
          openuiAction ? undefined : imageOptions,
          !openuiAction && openuiRequested,
        ),
        ...(openuiAction ? { openuiAction } : {}),
      },
    });
    if (!openuiAction) {
      setSearchRequested(false);
      setOpenuiRequested(false);
      setImageOptions(undefined);
      clearAttachments();
    }
  }

  function handleContinue(messageId: string) {
    if (voice.busy || streaming || !configured || messages.at(-1)?.id !== messageId) return;
    setContextStatus(null);
    setLocalAnchorRequestKey((key) => key + 1);
    void sendMessage(undefined, {
      body: requestBody({ type: "continue", targetAssistantMessageId: messageId }),
    });
  }

  function handleRegenerate(messageId: string) {
    if (voice.busy || streaming || !configured) return;
    setLocalAnchorRequestKey((key) => key + 1);
    regenerate({
      messageId,
      body: requestBody(
        {
          type: "regenerate",
          targetAssistantMessageId: messageId,
        },
        false,
        imageOptionsFromMetadata(
          messages.find((message) => message.id === messageId)?.metadata,
        ),
      ),
    });
  }

  function handleSaveEdit(
    messageId: string,
    text: string,
    files: FileUIPart[],
  ) {
    setEditingId(null);
    if (voice.busy || streaming || !configured) return;
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;
    Keyboard.dismiss();
    setLocalAnchorRequestKey((key) => key + 1);
    sendMessage(
      { text: trimmed, files, messageId },
      {
        body: requestBody({
          type: "edit",
          targetUserMessageId: messageId,
        }),
      },
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      <ChatUsageBar chatId={chatId} persisted={chatPersisted} streaming={streaming} messages={messages} contextWindow={selectedModel?.contextWindow} />
      <MiniSpeechPlayer speech={speech} />
      {messages.length === 0 ? (
        <View
          style={[
            styles.empty,
            (voice.busy || keyboardVisible) && styles.emptyCompact,
          ]}
        >
          <Text
            style={[
              styles.emptyTitle,
              { color: colors.foreground, fontFamily: fonts.serifSemiBold },
            ]}
          >
            {modelsError
              ? "Couldn't load models"
              : modelLoading
                ? "Loading model…"
                : configured
                  ? "What can I help with?"
                  : "No models configured"}
          </Text>
          {!configured && !modelsError && !modelLoading && (
            <Text
              style={[
                styles.emptySub,
                {
                  color: colors.mutedForeground,
                  fontFamily: fonts.sansRegular,
                },
              ]}
            >
              An admin can add one in Settings → Models.
            </Text>
          )}
          {modelsError && (
            <Text
              style={[
                styles.emptySub,
                { color: colors.destructive, fontFamily: fonts.sansRegular },
              ]}
            >
              {modelsError.message}
            </Text>
          )}
        </View>
      ) : (
        <MessageList
          contextStatus={contextStatus}
          messages={messages}
          streaming={streaming}
          status={status}
          error={error}
          onReconnect={() => {
            if (!voice.busy && !streaming) void generation.reconcile().catch(() => undefined);
          }}
          editingId={editingId}
          speech={{ ...speech, play: async (id, text) => {
            if (voice.busy) { toastError("End live voice before playing a message."); return; }
            await speech.play(id, text);
          } }}
          refreshing={refreshingMessages}
          onRefresh={isNew || voice.busy ? undefined : onRefreshMessages}
          onStartEdit={(id) => !voice.busy && !streaming && setEditingId(id)}
          onCancelEdit={() => setEditingId(null)}
          onSaveEdit={handleSaveEdit}
          onOpenUIAction={
            !voice.busy && !streaming && configured && chatQueue.messages.length === 0
              ? (action) => handleSubmit(action.message, [], action)
              : undefined
          }
          onRegenerate={handleRegenerate}
          onContinue={handleContinue}
          onImageReference={!voice.busy && imageAvailable && imageCapability?.supportsEditing !== false ? (file) => {
            addReference(file);
            setImageOptions({ size: "auto", quality: "auto" });
          } : undefined}
          localAnchorRequestKey={localAnchorRequestKey}
        />
      )}

      <View
        style={[
          styles.composerWrap,
          { paddingBottom: keyboardVisible ? 8 : 12 + insets.bottom },
        ]}
      >
          {!voice.busy && voice.error && (
            <ErrorNotice
              message={voice.error}
              onDismiss={voice.dismissError}
            />
          )}
          {!voice.busy && voice.warning && (
            <ErrorNotice
              message={voice.warning}
              onDismiss={voice.dismissWarning}
            />
          )}
          {voice.busy && (
            <VoiceControls
              voice={voice}
              modelLabel={selectedModel?.label}
            />
          )}
          <Composer
            voiceInstalled={voiceInstalled}
            voiceEligible={voiceEligible}
            voiceAvailable={voiceAvailable}
            voiceActive={voice.busy}
            voiceUnavailableReason={voiceUnavailableReason}
            textInputDisabled={voice.status === "ending"}
            endVoiceDisabled={voice.cleanupPending}
            onStartVoice={() => {
              if (
                !selectedId ||
                streaming ||
                voice.busy ||
                attachments.length ||
                uploading ||
                chatQueue.messages.length
              ) {
                return;
              }
              speech.stop();
              Keyboard.dismiss();
              void voice.start({
                chatId,
                projectId,
                modelConfigId: selectedId,
                webSearchEnabled: searchAvailable,
                reasoningLevel,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              });
            }}
            onEndVoice={() => {
              void voice.end();
            }}
            onBeforeDictate={() => speech.stop()}
            configured={configured}
            modelLoading={modelLoading}
            streaming={streaming}
            imageOptions={imageAvailable ? imageOptions : undefined}
            imageModel={imageCapability?.model}
            imageSupportsQuality={imageCapability?.supportsQuality}
            imageConfiguredSize={imageCapability?.configuredSize}
            onImageOptions={setImageOptions}
            searchAvailable={searchAvailable && !voice.busy}
            searchRequested={searchAvailable && !voice.busy && searchRequested}
            openuiRequested={openuiAvailable && !voice.busy && openuiRequested}
            modelLabel={selectedModel?.label}
            modelIconId={
              selectedModel?.modelIconId ?? selectedModel?.providerIconId
            }
            thinkingLevelLabel={thinkingLevelLabel}
            attachments={attachments}
            attachmentMeta={attachmentMeta}
            uploading={uploading}
            uploadError={uploadError}
            isAdmin={isAdmin}
            onClearSearch={() => setSearchRequested(false)}
            onClearOpenUI={() => setOpenuiRequested(false)}
            onOpenModelPicker={() => {
              Keyboard.dismiss();
              pickerRef.current?.present();
            }}
            onOpenAddSheet={() => {
              Keyboard.dismiss();
              addSheetRef.current?.present();
            }}
            onRemoveAttachment={removeAttachment}
            onDismissUploadError={dismissUploadError}
            onPasteImages={(uris) => {
              void addFiles(uris.map(pastedImageToPickedFile));
            }}
            chatQueue={chatQueue}
            onSubmit={handleSubmit}
            onStop={handleStop}
          />
      </View>

      <ModelPickerSheet
        ref={pickerRef}
        models={models ?? []}
        selectedId={selectedId}
        loading={modelsPending}
        error={modelsError}
        reasoningControls={reasoningControls}
        reasoningLevel={reasoningLevel}
        onSelect={(modelId) => {
          if (voice.busy) {
            void voice.end().then((ended) => {
              if (!ended) return;
              setSearchRequested(false);
              setImageOptions(undefined);
              setSelectedId(modelId);
            });
            return;
          }
          setSearchRequested(false);
          setOpenuiRequested(false);
          setImageOptions(undefined);
          setSelectedId(modelId);
        }}
        onSelectReasoningLevel={(level) => {
          if (!selectedId) return;
          if (voice.busy) {
            void voice.end().then((ended) => {
              if (ended) setReasoningLevel(selectedId, level);
            });
            return;
          }
          setReasoningLevel(selectedId, level);
        }}
      />

      <AddToChatSheet
        ref={addSheetRef}
        imageAvailable={imageAvailable && !voice.busy}
        onCreateImage={() => {
          if (voice.busy) return;
          setImageOptions({ size: "auto", quality: "auto" });
          addSheetRef.current?.dismiss();
        }}
        searchAvailable={searchAvailable && !voice.busy}
        searchUnavailableReason={
          voice.busy
            ? "End voice to require a web search. Voice can still search automatically."
            : searchUnavailableReason
        }
        searchRequested={searchAvailable && !voice.busy && searchRequested}
        onToggleSearchRequested={(next) => {
          if (!voice.busy) setSearchRequested(next);
        }}
        onPickTool={voice.busy ? undefined : onPickTool}
        openuiAvailable={openuiAvailable && !voice.busy}
        openuiUnavailableReason={voice.busy ? "End voice to request an interactive UI." : openuiUnavailableReason}
        openuiRequested={openuiAvailable && !voice.busy && openuiRequested}
        onToggleOpenUIRequested={(next) => {
          if (!voice.busy) setOpenuiRequested(next);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  projectChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  projectChipText: { fontSize: 14, flexShrink: 1 },
  root: { flex: 1 },
  headerRight: { paddingHorizontal: 12 },
  gate: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 16,
  },
  gateError: { fontSize: 14, textAlign: "center" },
  gateRetry: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  gateRetryText: { fontSize: 14 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 16,
    paddingBottom: 60,
  },
  emptyCompact: {
    paddingBottom: 12,
  },
  emptyTitle: { fontSize: 24, textAlign: "center" },
  emptySub: { fontSize: 14, textAlign: "center" },
  composerWrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 8,
  },

});

function assetToPickedFile(asset: ImagePicker.ImagePickerAsset): PickedFile {
  const filename =
    asset.fileName ?? asset.uri.split("/").pop() ?? `image-${Date.now()}.jpg`;
  const type =
    asset.mimeType ??
    (filename.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
  return { uri: asset.uri, name: filename, type };
}

function pastedImageToPickedFile(uri: string, index: number): PickedFile {
  const fallback = `pasted-image-${Date.now()}-${index}.png`;
  const name = uri.split("/").pop()?.split("?")[0] || fallback;
  const lower = name.toLowerCase();
  const type = lower.endsWith(".gif")
    ? "image/gif"
    : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
      ? "image/jpeg"
      : "image/png";
  return { uri, name, type };
}
