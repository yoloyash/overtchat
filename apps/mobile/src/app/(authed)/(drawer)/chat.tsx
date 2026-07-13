import { Ionicons } from "@expo/vector-icons";
import { useChat } from "@ai-sdk/react";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useHeaderHeight } from "expo-router/react-navigation";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { useNavigation } from "expo-router";
import { fetch as expoFetch } from "expo/fetch";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { MiniSpeechPlayer } from "@/components/chat/MiniSpeechPlayer";
import { ModelPickerSheet } from "@/components/chat/ModelPickerSheet";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { authFetch, getApiBase } from "@/lib/api";
import { getAuthClient } from "@/lib/auth/client";
import { useAttachments, type PickedFile } from "@/lib/chat/useAttachments";
import { useChatSession } from "@/lib/chat/session";
import { useChatMessages } from "@/lib/queries/chatMessages";
import { useModelConfigs } from "@/lib/queries/modelConfigs";
import type { ChatListItem } from "@/lib/queries/chats";
import { queryKeys } from "@/lib/queries/keys";
import { useSecureFlag } from "@/lib/useSecureFlag";
import { useSpeech } from "@/lib/useSpeech";
import { useTheme } from "@/lib/theme";
import { toastError } from "@/lib/toast";

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
              { color: colors.primaryForeground, fontFamily: fonts.sansSemiBold },
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
      projectId={isNew ? newChatProjectId : (hydration?.projectId ?? null)}
    />
  );
}

function ChatSurface({
  chatId,
  isNew,
  initialMessages,
  projectId,
}: {
  chatId: string;
  isNew: boolean;
  initialMessages: UIMessage[] | undefined;
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

  const { data: models, isPending: modelsPending, error: modelsError } =
    useModelConfigs();
  const {
    isFetching: hydrationFetching,
    error: hydrationError,
    refetch: refetchHydration,
  } = useChatMessages(isNew ? null : chatId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchEnabled, setSearchEnabled] = useSecureFlag(
    "overtchat.searchEnabled",
    false,
  );
  const pickerRef = useRef<BottomSheetModal>(null);
  const addSheetRef = useRef<BottomSheetModal>(null);

  useEffect(() => {
    if (!models?.length) return;
    if (!selectedId || !models.some((m) => m.id === selectedId)) {
      setSelectedId(models[0].id);
    }
  }, [models, selectedId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${baseURL}/api/chat`,
        fetch: ((input: Parameters<typeof expoFetch>[0], init?: Parameters<typeof expoFetch>[1]) =>
          authFetch(input, init)) as unknown as typeof globalThis.fetch,
        prepareSendMessagesRequest: ({ messages, body, trigger, messageId }) => ({
          body: { ...body, messages, trigger, messageId },
        }),
      }),
    [baseURL],
  );

  const { messages, setMessages, sendMessage, regenerate, status, stop, error } = useChat({
    id: chatId,
    resume: !isNew,
    transport,
    messages: initialMessages,
    onFinish: () => {
      qc.invalidateQueries({ queryKey: queryKeys.chats() });
      qc.invalidateQueries({ queryKey: queryKeys.chatMessages(chatId) });
    },
  });

  const handleStop = useCallback(() => {
    stop();
    void authFetch(`${baseURL}/api/chat/${chatId}/stream/cancel`, {
      method: "POST",
    });
  }, [stop, baseURL, chatId]);

  const streaming = status === "streaming" || status === "submitted";
  const configured = Boolean(selectedId);
  const selectedModel = models?.find((m) => m.id === selectedId) ?? null;

  const {
    attachments,
    attachmentMeta,
    uploading,
    error: uploadError,
    addFiles,
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
      headerTitle: () => (
        <Pressable
          onPress={() => pickerRef.current?.present()}
          style={styles.headerTitle}
        >
          {modelsPending ? (
            <ActivityIndicator color={colors.mutedForeground} size="small" />
          ) : (
            <>
              <ModelBrandIcon
                iconId={selectedModel?.modelIconId ?? selectedModel?.providerIconId}
                color={colors.mutedForeground}
                size={16}
                style={styles.headerTitleIcon}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.headerTitleText,
                  { color: colors.foreground, fontFamily: fonts.sansSemiBold },
                ]}
              >
                {selectedModel?.label ?? "Select model"}
              </Text>
              <Ionicons
                name="chevron-down"
                size={16}
                color={colors.mutedForeground}
                style={styles.headerTitleCaret}
              />
            </>
          )}
        </Pressable>
      ),
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          onPress={onNewChat}
          hitSlop={10}
          style={styles.headerRight}
        >
          <Ionicons name="create-outline" size={22} color={colors.foreground} />
        </Pressable>
      ),
    });
  }, [
    navigation,
    modelsPending,
    selectedModel?.id,
    selectedModel?.label,
    selectedModel?.modelIconId,
    selectedModel?.providerIconId,
    colors,
    fonts,
    onNewChat,
  ]);

  function requestBody() {
    return {
      modelConfigId: selectedId,
      searchEnabled,
      chatId,
      projectId,
      temporary: false,
    };
  }

  const isNewRef = useRef(isNew);

  async function requestTitle(userText: string) {
    if (!selectedId) return;
    try {
      const r = await authFetch(`${baseURL}/api/chats/${chatId}/title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelConfigId: selectedId,
          userText,
          projectId,
        }),
      });
      if (!r.ok) return;
      const { title } = (await r.json()) as { title: string };
      if (!title) return;
      qc.setQueryData<ChatListItem[]>(queryKeys.chats(), (prev) =>
        prev?.map((c) => (c.id === chatId ? { ...c, title } : c)),
      );
    } catch {
      // title generation is non-critical; silent failure matches web
    }
  }

  const [editingId, setEditingId] = useState<string | null>(null);

  const lastErrorRef = useRef<Error | undefined>(undefined);
  useEffect(() => {
    if (error && error !== lastErrorRef.current) {
      toastError("Chat error", error);
    }
    lastErrorRef.current = error;
  }, [error]);

  const userRefreshingMessages = useRef(false);
  const wasFetchingMessages = useRef(false);
  useEffect(() => {
    if (
      wasFetchingMessages.current &&
      !hydrationFetching &&
      userRefreshingMessages.current
    ) {
      if (hydrationError) toastError("Couldn't refresh messages", hydrationError);
      userRefreshingMessages.current = false;
    }
    wasFetchingMessages.current = hydrationFetching;
  }, [hydrationFetching, hydrationError]);

  function onRefreshMessages() {
    if (isNew) return;
    userRefreshingMessages.current = true;
    refetchHydration().then((res) => {
      if (res.data?.messages) setMessages(res.data.messages);
    });
  }

  function handleSubmit(text: string, files: FileUIPart[]) {
    Keyboard.dismiss();
    const wasNew = isNewRef.current;
    if (wasNew) {
      isNewRef.current = false;
      qc.setQueryData<ChatListItem[]>(queryKeys.chats(), (prev) => {
        const next: ChatListItem = {
          id: chatId,
          title: null,
          projectId,
          updatedAt: Date.now(),
        };
        if (!prev) return [next];
        if (prev.some((c) => c.id === chatId)) return prev;
        return [next, ...prev];
      });
      if (text) void requestTitle(text);
    }
    sendMessage({ text, files }, { body: requestBody() });
    clearAttachments();
  }

  function handleRegenerate(messageId: string) {
    if (streaming || !configured) return;
    regenerate({ messageId, body: requestBody() });
  }

  function handleSaveEdit(messageId: string, text: string, files: FileUIPart[]) {
    setEditingId(null);
    if (streaming || !configured) return;
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;
    Keyboard.dismiss();
    sendMessage({ text: trimmed, files, messageId }, { body: requestBody() });
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      <MiniSpeechPlayer speech={speech} />
      {messages.length === 0 ? (
        <View style={styles.empty}>
          <Text
            style={[
              styles.emptyTitle,
              { color: colors.foreground, fontFamily: fonts.serifSemiBold },
            ]}
          >
            {modelsError
              ? "Couldn't load models"
              : configured
                ? "What can I help with?"
                : "No models configured"}
          </Text>
          {!configured && !modelsError && (
            <Text
              style={[
                styles.emptySub,
                { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
              ]}
            >
              An admin needs to add one in Settings → Models on the web app.
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
          messages={messages}
          streaming={streaming}
          status={status}
          error={error}
          editingId={editingId}
          speech={speech}
          refreshing={!isNew && hydrationFetching && !streaming}
          onRefresh={isNew ? undefined : onRefreshMessages}
          onStartEdit={(id) => !streaming && setEditingId(id)}
          onCancelEdit={() => setEditingId(null)}
          onSaveEdit={handleSaveEdit}
          onRegenerate={handleRegenerate}
        />
      )}

      <View
        style={[
          styles.composerWrap,
          { paddingBottom: keyboardVisible ? 8 : 12 + insets.bottom },
        ]}
      >
        <Composer
          configured={configured}
          streaming={streaming}
          searchEnabled={searchEnabled}
          attachments={attachments}
          attachmentMeta={attachmentMeta}
          uploading={uploading}
          uploadError={uploadError}
          isAdmin={isAdmin}
          onDisableSearch={() => setSearchEnabled(false)}
          onOpenAddSheet={() => {
            Keyboard.dismiss();
            addSheetRef.current?.present();
          }}
          onRemoveAttachment={removeAttachment}
          onDismissUploadError={dismissUploadError}
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
        onSelect={setSelectedId}
      />

      <AddToChatSheet
        ref={addSheetRef}
        searchEnabled={searchEnabled}
        onToggleSearch={(next) => setSearchEnabled(next)}
        onPickTool={onPickTool}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerTitle: { flexDirection: "row", alignItems: "center", maxWidth: 240 },
  headerTitleIcon: { marginRight: 7 },
  headerTitleText: { flexShrink: 1, fontSize: 16, maxWidth: 190 },
  headerTitleCaret: { marginLeft: 4 },
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
  emptyTitle: { fontSize: 24, textAlign: "center" },
  emptySub: { fontSize: 14, textAlign: "center" },
  composerWrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
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
