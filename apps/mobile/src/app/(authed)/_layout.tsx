import { Stack } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ChatSessionContext, type ChatSession } from "@/lib/chat/session";
import { useTheme } from "@/lib/theme";

export default function AuthedLayout() {
  const { colors } = useTheme();
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [newChatKey, setNewChatKey] = useState(0);

  const bumpNewChat = useCallback(() => {
    setNewChatKey((k) => k + 1);
  }, []);

  const session = useMemo<ChatSession>(
    () => ({ activeChatId, setActiveChatId, newChatKey, bumpNewChat }),
    [activeChatId, newChatKey, bumpNewChat],
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
      </Stack>
    </ChatSessionContext.Provider>
  );
}
