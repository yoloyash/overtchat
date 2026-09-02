import { Ionicons } from "@expo/vector-icons";
import type { ChatStatus, FileUIPart, UIMessage } from "ai";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useScrollFollow } from "@/lib/chat/useScrollFollow";
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
  readOnly = false,
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
  readOnly?: boolean;
}) {
  const { colors, fonts } = useTheme();
  const latestMessage = messages.at(-1);
  const latestMessageId = latestMessage?.id;
  const latestMessageRole = latestMessage?.role;
  const scrollFollow = useScrollFollow({
    latestMessageId,
    latestMessageRole,
  });

  const lastIsUser = latestMessageRole === "user";

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollFollow.scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onLayout={scrollFollow.handleLayout}
        onScroll={scrollFollow.handleScroll}
        onScrollBeginDrag={scrollFollow.handleScrollBeginDrag}
        onScrollEndDrag={scrollFollow.handleScrollEndDrag}
        onMomentumScrollBegin={scrollFollow.handleMomentumScrollBegin}
        onMomentumScrollEnd={scrollFollow.handleMomentumScrollEnd}
        onContentSizeChange={scrollFollow.handleContentSizeChange}
        scrollEventThrottle={16}
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
              readOnly={readOnly}
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
              {
                borderColor: colors.destructive,
                backgroundColor: colors.muted,
              },
            ]}
          >
            <Text
              style={[
                styles.errorText,
                {
                  color: colors.destructive,
                  fontFamily: fonts.sansRegular,
                },
              ]}
            >
              {error.message || "Something went wrong."}
            </Text>
          </View>
        )}
      </ScrollView>

      {!scrollFollow.isFollowing && (
        <View style={styles.scrollToBottomContainer} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scroll to bottom"
            hitSlop={8}
            onPress={scrollFollow.scrollToLatest}
            style={({ pressed }) => [
              styles.scrollToBottomButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Ionicons
              name="chevron-down"
              size={22}
              color={colors.foreground}
            />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingVertical: 16, gap: 16 },
  pending: { fontSize: 18, paddingVertical: 4 },
  error: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12 },
  errorText: { fontSize: 14 },
  scrollToBottomContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 12,
    alignItems: "center",
  },
  scrollToBottomButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 5,
  },
});
