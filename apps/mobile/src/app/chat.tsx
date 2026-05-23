import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { fetch as expoFetch } from "expo/fetch";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { ModelPickerSheet } from "@/components/chat/ModelPickerSheet";
import { authFetch, getApiBase } from "@/lib/api";
import { getAuthClient } from "@/lib/auth/client";
import { useModelConfigs } from "@/lib/queries/modelConfigs";
import { useTheme } from "@/lib/theme";

export default function ChatScreen() {
  const { colors, radii, fonts } = useTheme();
  const baseURL = useMemo(() => getApiBase(), []);
  const authClient = getAuthClient();

  const { data: models, isPending: modelsPending, error: modelsError } =
    useModelConfigs();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!models?.length) return;
    if (!selectedId || !models.some((m) => m.id === selectedId)) {
      setSelectedId(models[0].id);
    }
  }, [models, selectedId]);

  const [chatId] = useState(() => Crypto.randomUUID());

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${baseURL}/api/chat`,
        fetch: ((input: Parameters<typeof expoFetch>[0], init?: Parameters<typeof expoFetch>[1]) =>
          authFetch(input, init)) as unknown as typeof globalThis.fetch,
      }),
    [baseURL],
  );

  const { messages, sendMessage, status, stop, error } = useChat({ transport });

  const streaming = status === "streaming" || status === "submitted";
  const configured = Boolean(selectedId);
  const selectedModel = models?.find((m) => m.id === selectedId) ?? null;

  function requestBody() {
    return {
      modelConfigId: selectedId,
      chatId,
      projectId: null,
      temporary: false,
    };
  }

  function handleSubmit(text: string) {
    sendMessage({ text }, { body: requestBody() });
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await authClient.signOut();
      router.replace("/");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: colors.background }]}
      edges={["top", "left", "right"]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setPickerOpen(true)}
          disabled={modelsPending}
          style={({ pressed }) => [
            styles.modelButton,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: radii.md,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          {modelsPending ? (
            <ActivityIndicator color={colors.mutedForeground} size="small" />
          ) : (
            <Text
              style={[
                styles.modelLabel,
                { color: colors.foreground, fontFamily: fonts.sansSemiBold },
              ]}
              numberOfLines={1}
            >
              {selectedModel ? selectedModel.label : "Select model"}
            </Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={handleSignOut}
          disabled={signingOut}
          style={({ pressed }) => [
            styles.signOutButton,
            { opacity: pressed || signingOut ? 0.6 : 1 },
          ]}
        >
          <Text
            style={[
              styles.signOutText,
              { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
            ]}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
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
          />
        )}

        <View style={styles.composerWrap}>
          <Composer
            configured={configured}
            streaming={streaming}
            onSubmit={handleSubmit}
            onStop={stop}
          />
        </View>
      </KeyboardAvoidingView>

      <ModelPickerSheet
        visible={pickerOpen}
        models={models ?? []}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onClose={() => setPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modelButton: {
    flexShrink: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 120,
    alignItems: "center",
  },
  modelLabel: { fontSize: 14 },
  signOutButton: { paddingHorizontal: 8, paddingVertical: 8 },
  signOutText: { fontSize: 13 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: { fontSize: 22, textAlign: "center" },
  emptySub: { fontSize: 14, textAlign: "center" },
  composerWrap: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 8,
  },
});
