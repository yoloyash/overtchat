import { Ionicons } from "@expo/vector-icons";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import type { ChatStatus, FileUIPart, UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "@/lib/theme";
import type { useSpeech } from "@/lib/useSpeech";
import { MessageBubble } from "./MessageBubble";
import {
  contextStatusLabel,
  isManualCompactionMessage,
  isContextStatus,
  type ContextStatus,
} from "@overtchat/shared";

const CHAT_MAINTAIN_VISIBLE_POSITION = {
  startRenderingFromBottom: true,
  autoscrollToBottomThreshold: 0.05,
  animateAutoScrollToBottom: false,
} as const;

const CHAT_BOTTOM_THRESHOLD_PX = 32;

export function MessageList({
  messages,
  streaming,
  status,
  contextStatus,
  error,
  editingId,
  speech,
  refreshing,
  onRefresh,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRegenerate,
  onImageReference,
  localAnchorRequestKey,
  readOnly = false,
}: {
  messages: UIMessage[];
  streaming: boolean;
  status: ChatStatus;
  contextStatus?: ContextStatus | null;
  error: Error | undefined;
  editingId: string | null;
  speech: ReturnType<typeof useSpeech>;
  refreshing?: boolean;
  onRefresh?: () => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, text: string, files: FileUIPart[]) => void;
  onRegenerate: (id: string) => void;
  onImageReference?: (file: FileUIPart) => void;
  localAnchorRequestKey: number;
  readOnly?: boolean;
}) {
  const { colors, fonts } = useTheme();
  const latestMessage = messages.at(-1);
  const latestMessageId = latestMessage?.id;
  const latestMessageRole = latestMessage?.role;
  const listRef = useRef<FlashListRef<UIMessage>>(null);
  const nearBottomRef = useRef(true);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const lastIsUser = latestMessageRole === "user";
  const listExtraData = useMemo(
    () => ({
      contextStatus,
      editingId,
      readOnly,
      speechActiveId: speech.activeId,
      speechStatus: speech.status,
      streaming,
    }),
    [
      contextStatus,
      editingId,
      readOnly,
      speech.activeId,
      speech.status,
      streaming,
    ],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      const next =
        contentSize.height - layoutMeasurement.height - contentOffset.y <=
        CHAT_BOTTOM_THRESHOLD_PX;
      if (next === nearBottomRef.current) return;
      nearBottomRef.current = next;
      setIsNearBottom(next);
    },
    [],
  );

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: false });
  }, [localAnchorRequestKey]);

  const footer = (
    <>
      {!error && !contextStatus && status === "submitted" && lastIsUser && (
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
    </>
  );

  return (
    <View style={styles.root}>
      <FlashList
        ref={listRef}
        data={messages}
        extraData={listExtraData}
        keyExtractor={(message) => message.id}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={CHAT_MAINTAIN_VISIBLE_POSITION}
        onScroll={handleScroll}
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
        renderItem={({ item: message }) => {
          const savedContextStatus = (
            message.metadata as Record<string, unknown> | undefined
          )?.contextStatus;
          const visibleContextStatus =
            message.id === latestMessageId && streaming && contextStatus
              ? contextStatus
              : isContextStatus(savedContextStatus) &&
                  savedContextStatus !== "compacting" &&
                  savedContextStatus !== "manual-compacting"
                ? savedContextStatus
                : null;
          const contextIndicator = visibleContextStatus && (
            <View style={styles.contextStatus}>
              {(visibleContextStatus === "compacting" ||
                visibleContextStatus === "manual-compacting") && (
                <ActivityIndicator
                  size="small"
                  color={colors.mutedForeground}
                />
              )}
              <Text
                accessibilityLiveRegion="polite"
                style={{
                  color: colors.mutedForeground,
                  fontFamily: fonts.sansRegular,
                  fontSize: 12,
                }}
              >
                {contextStatusLabel(visibleContextStatus)}
              </Text>
            </View>
          );
          return (
            <View style={styles.messageRow}>
              {message.role === "assistant" && contextIndicator}
              {!isManualCompactionMessage(message) && (
                <MessageBubble
                  message={message}
                  streaming={streaming && message.id === latestMessageId}
                  editing={editingId === message.id}
                  speech={speech}
                  onStartEdit={onStartEdit}
                  onCancelEdit={onCancelEdit}
                  onSaveEdit={onSaveEdit}
                  onRegenerate={onRegenerate}
                  onImageReference={onImageReference}
                  readOnly={readOnly}
                />
              )}
              {message.role !== "assistant" && contextIndicator}
            </View>
          );
        }}
        ListFooterComponent={footer}
      />

      {!isNearBottom && (
        <View style={styles.scrollToBottomContainer} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scroll to bottom"
            hitSlop={8}
            onPress={() => listRef.current?.scrollToEnd({ animated: true })}
            style={({ pressed }) => [
              styles.scrollToBottomButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Ionicons name="chevron-down" size={22} color={colors.foreground} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingVertical: 16 },
  messageRow: { marginBottom: 16 },
  contextStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 8,
  },
  pending: { fontSize: 18, paddingVertical: 4 },
  error: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
  },
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
});
