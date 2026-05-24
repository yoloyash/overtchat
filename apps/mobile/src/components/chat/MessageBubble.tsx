import type { UIMessage } from "ai";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { textOf } from "@/lib/chat/text";
import { useTheme } from "@/lib/theme";
import { EditBubble } from "./EditBubble";
import { MarkdownBody } from "./MarkdownBody";
import { MessageActions } from "./MessageActions";
import { type MessageAction, MessageMenu } from "./MessageMenu";
import { ThinkingBlock } from "./ThinkingBlock";

export function MessageBubble({
  message,
  streaming,
  isLast,
  editing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRegenerate,
}: {
  message: UIMessage;
  streaming: boolean;
  isLast: boolean;
  editing: boolean;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, text: string) => void;
  onRegenerate: (id: string) => void;
}) {
  const { colors, radii, fonts } = useTheme();
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const text = textOf(message);

  function copyText(t: string) {
    Clipboard.setStringAsync(t).catch(() => {});
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1200);
  }

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

    const actions: MessageAction[] = streaming ? [] : ["copy", "edit"];

    function onMenuSelect(action: MessageAction) {
      if (action === "copy") copyText(text);
      else if (action === "edit") onStartEdit(message.id);
    }

    function openUserMenu() {
      if (actions.length === 0) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setMenuOpen(true);
    }

    return (
      <View style={styles.userRow}>
        <View ref={anchorRef} collapsable={false}>
          <Pressable
            onLongPress={openUserMenu}
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
        <MessageMenu
          from={anchorRef}
          visible={menuOpen}
          actions={actions}
          placement="top"
          onSelect={onMenuSelect}
          onClose={() => setMenuOpen(false)}
        />
      </View>
    );
  }

  const hasAnyText = message.parts.some((p) => p.type === "text");
  const showActions = !streaming && hasAnyText && isLast;
  const assistantActions: MessageAction[] =
    !streaming && hasAnyText
      ? isLast
        ? ["copy", "regenerate"]
        : ["copy"]
      : [];

  function onAssistantMenuSelect(action: MessageAction) {
    if (action === "copy") copyText(text);
    else if (action === "regenerate") onRegenerate(message.id);
  }

  function openAssistantMenu() {
    if (assistantActions.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setMenuOpen(true);
  }

  return (
    <View ref={anchorRef} collapsable={false} style={styles.assistantRow}>
      <Pressable
        onLongPress={openAssistantMenu}
        delayLongPress={300}
        style={styles.assistantInner}
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
            onCopy={() => copyText(text)}
            onRegenerate={() => onRegenerate(message.id)}
          />
        ) : null}
      </Pressable>
      <MessageMenu
        from={anchorRef}
        visible={menuOpen}
        actions={assistantActions}
        placement="bottom"
        onSelect={onAssistantMenuSelect}
        onClose={() => setMenuOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: { alignItems: "flex-end" },
  assistantRow: { alignItems: "stretch" },
  assistantInner: { gap: 4 },
  userBubble: {
    maxWidth: "85%",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userText: { fontSize: 15, lineHeight: 22 },
});
