import type { FileUIPart, UIMessage } from "ai";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { buildSourceLookup } from "@/lib/chat/citations";
import { groupMessageParts } from "@/lib/chat/parts";
import { textOf } from "@/lib/chat/text";
import { useTheme } from "@/lib/theme";
import type { useSpeech } from "@/lib/useSpeech";
import { AttachmentChip } from "./AttachmentChip";
import { type ActivityPart, ChainOfThought } from "./ChainOfThought";
import { EditBubble } from "./EditBubble";
import { MarkdownBody } from "./MarkdownBody";
import { MessageActions } from "./MessageActions";
import { type MessageAction, MessageMenu } from "./MessageMenu";
import { Sources } from "./Sources";

export function MessageBubble({
  message,
  streaming,
  editing,
  speech,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRegenerate,
}: {
  message: UIMessage;
  streaming: boolean;
  editing: boolean;
  speech: ReturnType<typeof useSpeech>;
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
    const fileParts = message.parts.filter(
      (p): p is FileUIPart => p.type === "file",
    );
    if (!text && fileParts.length === 0 && !editing) return null;

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
        {fileParts.length > 0 && !editing ? (
          <View style={styles.attachmentsRow}>
            {fileParts.map((part, i) => (
              <AttachmentChip key={`${part.url}-${i}`} attachment={part} />
            ))}
          </View>
        ) : null}
        <View ref={anchorRef} collapsable={false}>
          {editing ? (
            <EditBubble
              initialText={text}
              onCancel={onCancelEdit}
              onSave={(next) => onSaveEdit(message.id, next)}
            />
          ) : text ? (
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
          ) : null}
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
  const showActions = !streaming && hasAnyText;
  const assistantActions: MessageAction[] =
    !streaming && hasAnyText ? ["copy", "regenerate"] : [];
  const sourceLookup = useMemo(() => buildSourceLookup(message), [message]);

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
        {groupMessageParts(message.parts).map((seg, i, segs) => {
          const isLast = i === segs.length - 1;
          if (seg.kind === "text") {
            return (
              <MarkdownBody
                key={`t-${seg.index}`}
                text={(seg.part as { text: string }).text}
                sourceLookup={sourceLookup}
              />
            );
          }
          const trailing = seg.parts[seg.parts.length - 1];
          const trailingDone =
            trailing.type === "reasoning"
              ? (trailing as { state?: string }).state === "done"
              : (trailing as { state?: string }).state === "output-available" ||
                (trailing as { state?: string }).state === "output-error" ||
                (trailing as { state?: string }).state === "output-denied";
          const active = streaming && isLast && !trailingDone;
          return (
            <ChainOfThought
              key={`a-${seg.startIndex}`}
              parts={seg.parts as ActivityPart[]}
              active={active}
            />
          );
        })}
        {!streaming ? <Sources message={message} /> : null}
        {streaming && !hasAnyText ? (
          <Text style={{ color: colors.mutedForeground }}>▍</Text>
        ) : null}
        {showActions ? (
          <MessageActions
            copied={copied}
            onCopy={() => copyText(text)}
            onRegenerate={() => onRegenerate(message.id)}
            onSpeak={
              text ? () => void speech.play(message.id, text) : undefined
            }
            speechStatus={
              speech.activeId === message.id ? speech.status : "idle"
            }
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
  userRow: { alignItems: "flex-end", gap: 6 },
  assistantRow: { alignItems: "stretch" },
  assistantInner: { gap: 4 },
  attachmentsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 6,
    maxWidth: "85%",
  },
  userBubble: {
    maxWidth: "85%",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userText: { fontSize: 15, lineHeight: 22 },
});
