import type { UIMessage } from "ai";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { textOf } from "@/lib/chat/text";
import { useTheme } from "@/lib/theme";
import { EditBubble } from "./EditBubble";
import { MarkdownBody } from "./MarkdownBody";
import { MessageActions } from "./MessageActions";
import { ThinkingBlock } from "./ThinkingBlock";

export function MessageBubble({
  message,
  streaming,
  isLast,
  editing,
  onLongPress,
  onCancelEdit,
  onSaveEdit,
  onRegenerate,
}: {
  message: UIMessage;
  streaming: boolean;
  isLast: boolean;
  editing: boolean;
  onLongPress: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, text: string) => void;
  onRegenerate: (id: string) => void;
}) {
  const { colors, radii, fonts } = useTheme();
  const [copied, setCopied] = useState(false);

  const text = textOf(message);

  if (message.role === "user") {
    if (editing) {
      return (
        <EditBubble
          initialText={text}
          onCancel={onCancelEdit}
          onSave={(next) => onSaveEdit(message.id, next)}
        />
      );
    }
    if (!text) return null;
    return (
      <View style={styles.userRow}>
        <Pressable
          onLongPress={() => onLongPress(message.id)}
          delayLongPress={300}
          style={({ pressed }) => [
            styles.userBubble,
            {
              backgroundColor: colors.secondary,
              borderRadius: radii.xxl,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.userText,
              { color: colors.secondaryForeground, fontFamily: fonts.sansRegular },
            ]}
            selectable
          >
            {text}
          </Text>
        </Pressable>
      </View>
    );
  }

  const textPartIndices: number[] = [];
  message.parts.forEach((p, i) => {
    if (p.type === "text") textPartIndices.push(i);
  });
  const lastTextIndex = textPartIndices[textPartIndices.length - 1];
  const hasAnyText = lastTextIndex !== undefined;
  const showActions = !streaming && hasAnyText && isLast;

  function copyAssistant(t: string) {
    return () => {
      Clipboard.setStringAsync(t).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    };
  }

  return (
    <Pressable
      onLongPress={() => hasAnyText && onLongPress(message.id)}
      delayLongPress={300}
      style={styles.assistantRow}
    >
      {message.parts.map((part, i) => {
        if (part.type === "reasoning") {
          const isLastPart = i === message.parts.length - 1;
          const active = streaming && part.state !== "done" && isLastPart;
          return (
            <ThinkingBlock
              key={`r-${i}`}
              content={part.text}
              active={active}
            />
          );
        }
        if (part.type === "text") {
          const isLastText = i === lastTextIndex;
          const isStreamingPart = streaming && isLastText;
          if (isStreamingPart) {
            return (
              <Text
                key={`t-${i}`}
                style={[
                  styles.streamingText,
                  { color: colors.foreground, fontFamily: fonts.sansRegular },
                ]}
                selectable
              >
                {part.text}
                <Text style={{ color: colors.mutedForeground }}>▍</Text>
              </Text>
            );
          }
          return <MarkdownBody key={`t-${i}`} text={part.text} />;
        }
        return null;
      })}
      {streaming && !hasAnyText ? (
        <Text style={{ color: colors.mutedForeground }}>▍</Text>
      ) : null}
      {showActions ? (
        <MessageActions
          copied={copied}
          onCopy={copyAssistant(text)}
          onRegenerate={() => onRegenerate(message.id)}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  userRow: { alignItems: "flex-end" },
  assistantRow: { alignItems: "stretch", gap: 4 },
  userBubble: {
    maxWidth: "85%",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userText: { fontSize: 15, lineHeight: 22 },
  streamingText: { fontSize: 16, lineHeight: 24 },
});
