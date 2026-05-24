import { Ionicons } from "@expo/vector-icons";
import { useChat } from "@ai-sdk/react";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useHeaderHeight } from "expo-router/react-navigation";
import { DefaultChatTransport, type UIMessage } from "ai";
import * as Burnt from "burnt";
import * as Crypto from "expo-crypto";
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
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { ModelPickerSheet } from "@/components/chat/ModelPickerSheet";
import { authFetch, getApiBase } from "@/lib/api";
import { useChatSession } from "@/lib/chat/session";
import { useChatMessages } from "@/lib/queries/chatMessages";
import { useModelConfigs } from "@/lib/queries/modelConfigs";
import { useTheme } from "@/lib/theme";

export default function ChatScreen() {
  const { activeChatId, newChatKey } = useChatSession();
  return (
    <ChatSurface
      key={activeChatId ?? `new-${newChatKey}`}
      activeChatId={activeChatId}
    />
  );
}

function ChatSurface({ activeChatId }: { activeChatId: string | null }) {
  const { colors, fonts } = useTheme();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const { setActiveChatId, bumpNewChat } = useChatSession();
  const baseURL = useMemo(() => getApiBase(), []);

  const { data: models, isPending: modelsPending, error: modelsError } =
    useModelConfigs();
  const { data: hydration, isPending: hydrationPending } =
    useChatMessages(activeChatId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pickerRef = useRef<BottomSheetModal>(null);

  useEffect(() => {
    if (!models?.length) return;
    if (!selectedId || !models.some((m) => m.id === selectedId)) {
      setSelectedId(models[0].id);
    }
  }, [models, selectedId]);

  const [chatId] = useState(() => activeChatId ?? Crypto.randomUUID());

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${baseURL}/api/chat`,
        fetch: ((input: Parameters<typeof expoFetch>[0], init?: Parameters<typeof expoFetch>[1]) =>
          authFetch(input, init)) as unknown as typeof globalThis.fetch,
      }),
    [baseURL],
  );

  const initialMessages = activeChatId ? hydration?.messages : undefined;

  const { messages, sendMessage, regenerate, status, stop, error } = useChat({
    transport,
    messages: initialMessages,
  });

  const streaming = status === "streaming" || status === "submitted";
  const configured = Boolean(selectedId);
  const selectedModel = models?.find((m) => m.id === selectedId) ?? null;
  const loadingHistory = !!activeChatId && hydrationPending;

  const onNewChat = useCallback(() => {
    setActiveChatId(null);
    bumpNewChat();
  }, [setActiveChatId, bumpNewChat]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <Pressable
          onPress={() => pickerRef.current?.present()}
          disabled={modelsPending}
          style={styles.headerTitle}
        >
          {modelsPending ? (
            <ActivityIndicator color={colors.mutedForeground} size="small" />
          ) : (
            <>
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
  }, [navigation, modelsPending, selectedModel?.id, selectedModel?.label, colors, fonts, onNewChat]);

  function requestBody() {
    return {
      modelConfigId: selectedId,
      chatId,
      projectId: hydration?.projectId ?? null,
      temporary: false,
    };
  }

  const [editingId, setEditingId] = useState<string | null>(null);

  const lastErrorRef = useRef<Error | undefined>(undefined);
  useEffect(() => {
    if (error && error !== lastErrorRef.current) {
      Burnt.toast({
        title: "Chat error",
        message: error.message || "Something went wrong.",
        preset: "error",
      });
    }
    lastErrorRef.current = error;
  }, [error]);

  function handleSubmit(text: string) {
    Keyboard.dismiss();
    sendMessage({ text }, { body: requestBody() });
  }

  function handleRegenerate(messageId: string) {
    if (streaming || !configured) return;
    regenerate({ messageId, body: requestBody() });
  }

  function handleSaveEdit(messageId: string, text: string) {
    setEditingId(null);
    if (streaming || !configured) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    Keyboard.dismiss();
    sendMessage({ text: trimmed, messageId }, { body: requestBody() });
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      {loadingHistory ? (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : messages.length === 0 ? (
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
          onSubmit={handleSubmit}
          onStop={stop}
        />
      </View>

      <ModelPickerSheet
        ref={pickerRef}
        models={models ?? []}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerTitle: { flexDirection: "row", alignItems: "center" },
  headerTitleText: { fontSize: 16, maxWidth: 220 },
  headerTitleCaret: { marginLeft: 4 },
  headerRight: { paddingHorizontal: 12 },
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
