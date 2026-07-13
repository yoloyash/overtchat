import type { ChatStatus, FileUIPart, UIMessage } from "ai";
import { useEffect, useRef } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "@/lib/theme";
import type { useSpeech } from "@/lib/useSpeech";
import { MessageBubble } from "./MessageBubble";

export function MessageList({
  messages,
  streaming,
  status,
  error,
  editingId,
  speech,
  refreshing,
  onRefresh,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRegenerate,
}: {
  messages: UIMessage[];
  streaming: boolean;
  status: ChatStatus;
  error: Error | undefined;
  editingId: string | null;
  speech: ReturnType<typeof useSpeech>;
  refreshing?: boolean;
  onRefresh?: () => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, text: string, files: FileUIPart[]) => void;
  onRegenerate: (id: string) => void;
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
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.mutedForeground}
          />
        ) : undefined
      }
    >
      {messages.map((m, i) => {
        const isLast = i === messages.length - 1;
        return (
          <MessageBubble
            key={m.id}
            message={m}
            streaming={streaming && isLast}
            editing={editingId === m.id}
            speech={speech}
            onStartEdit={onStartEdit}
            onCancelEdit={onCancelEdit}
            onSaveEdit={onSaveEdit}
            onRegenerate={onRegenerate}
          />
        );
      })}
      {!error && status === "submitted" && lastIsUser && (
        <Text
          accessibilityLabel="Assistant is responding"
          accessibilityLiveRegion="polite"
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
