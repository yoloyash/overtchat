import * as Crypto from "expo-crypto";
import { Stack } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ChatSessionContext, type ChatSession } from "@/lib/chat/session";
import { useTheme } from "@/lib/theme";

type State = { id: string; isNew: boolean; projectId: string | null };

export default function AuthedLayout() {
  const { colors } = useTheme();
  const [state, setState] = useState<State>(() => ({
    id: Crypto.randomUUID(),
    isNew: true,
    projectId: null,
  }));

  const startNewChat = useCallback((projectId: string | null = null) => {
    setState({ id: Crypto.randomUUID(), isNew: true, projectId });
  }, []);

  const openChat = useCallback((id: string) => {
    setState({ id, isNew: false, projectId: null });
  }, []);

  const session = useMemo<ChatSession>(
    () => ({
      activeChatId: state.id,
      isNewChat: state.isNew,
      activeProjectId: state.projectId,
      startNewChat,
      openChat,
    }),
    [state, startNewChat, openChat],
  );

  return (
    <ChatSessionContext.Provider value={session}>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" />
        <Stack.Screen name="search" />
        <Stack.Screen name="projects/[id]" />
      </Stack>
    </ChatSessionContext.Provider>
  );
}
