import type { ChatStatus, UIMessage } from "ai";
import { useEffect, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";
import { MessageBubble } from "./MessageBubble";

export function MessageList({
  messages,
  streaming,
  status,
  error,
}: {
  messages: UIMessage[];
  streaming: boolean;
  status: ChatStatus;
  error: Error | undefined;
}) {
  const { colors, fonts } = useTheme();
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, status]);

  const lastIsUser = messages.at(-1)?.role === "user";

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardDismissMode="interactive"
    >
      {messages.map((m, i) => (
        <MessageBubble
          key={m.id}
          message={m}
          streaming={streaming && i === messages.length - 1}
        />
      ))}
      {!error && status === "submitted" && lastIsUser && (
        <Text
          style={[
            styles.pending,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          …
        </Text>
      )}
      {error && (
        <View
          style={[
            styles.error,
            { borderColor: colors.destructive, backgroundColor: colors.muted },
          ]}
        >
          <Text
            style={[
              styles.errorText,
              { color: colors.destructive, fontFamily: fonts.sansRegular },
            ]}
          >
            {error.message || "Something went wrong."}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingVertical: 16, gap: 16 },
  pending: { fontSize: 18, paddingVertical: 4 },
  error: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12 },
  errorText: { fontSize: 14 },
});
