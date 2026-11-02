import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { AgentRewindMode } from "@overtchat/agent-bridge";
import type { AgentRewindCapabilities } from "@overtchat/shared/agent-presentation";
import { useMeasuredPopoverAnchor } from "@/components/ui/useMeasuredPopoverAnchor";
import { record, text } from "@/lib/agents/model";
import { useTheme } from "@/lib/theme";
import { AgentImage } from "./AgentImage";
import { AgentMenu } from "./AgentMenu";
import { AgentCopyButton, useCopied } from "./AgentMessageActions";
import {
  AGENT_REWIND_NOTE,
  AgentRewindMenu,
  agentRewindMenuItems,
} from "./AgentRewindMenu";

export function agentUserMessageParts(message: unknown) {
  const value = record(message);
  const parts = Array.isArray(value.content) ? value.content.map(record) : [];
  return {
    body:
      typeof value.content === "string"
        ? value.content
        : parts
            .filter((part) => part.type === "text")
            .map((part) => text(part.text))
            .join("\n"),
    images: parts
      .filter((part) => part.type === "image")
      .map((part) => ({
        label: text(part.filename) || "Attached image",
        url:
          text(part.url) ||
          (part.data ? `data:${text(part.mimeType)};base64,${text(part.data)}` : ""),
      })),
  };
}

export function formatAgentMessageTime(timestamp: number, now = Date.now()) {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return new Date(now).toDateString() === date.toDateString()
    ? time
    : `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

export function AgentUserMessage({
  message,
  timestamp,
  capabilities,
  disabled,
  onRewind,
}: {
  message: unknown;
  timestamp?: number;
  capabilities: AgentRewindCapabilities;
  disabled: boolean;
  onRewind?: (messageId: string, mode: AgentRewindMode) => Promise<void>;
}) {
  const { colors, radii, fonts } = useTheme();
  const menu = useMeasuredPopoverAnchor();
  const { copy } = useCopied();
  const [rewinding, setRewinding] = useState(false);
  const value = record(message);
  const { body, images } = agentUserMessageParts(message);
  const id = typeof value.id === "string" ? value.id : null;
  const sending = !!id?.startsWith("submission:");
  const rewindable =
    !!onRewind && !!id && !sending && value.overtchatRewindable !== false;
  const rewind = (mode: AgentRewindMode) => {
    if (!id || !onRewind) return;
    setRewinding(true);
    void onRewind(id, mode).finally(() => setRewinding(false));
  };
  const menuSections = [
    {
      items: body
        ? [
            {
              key: "copy",
              label: "Copy",
              icon: "copy-outline" as const,
              onSelect: () => copy(body, "Couldn't copy message"),
            },
          ]
        : [],
    },
    {
      note: AGENT_REWIND_NOTE,
      items:
        rewindable && !disabled && !rewinding
          ? agentRewindMenuItems(capabilities, rewind)
          : [],
    },
  ];
  const hasMenu = menuSections.some((section) => section.items.length > 0);
  const single = images.length === 1;
  return (
    <View style={styles.row}>
      {images.length > 0 && (
        <View style={styles.images}>
          {images.map((image, index) => (
            <AgentImage
              key={index}
              url={image.url}
              label={image.label}
              width={single ? 220 : 104}
              height={single ? 165 : 104}
            />
          ))}
        </View>
      )}
      {!!body && (
        <Pressable
          ref={menu.anchorRef}
          collapsable={false}
          accessibilityHint={hasMenu ? "Long press for message actions" : undefined}
          onLongPress={() => {
            if (!hasMenu) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            menu.open();
          }}
          delayLongPress={300}
          style={({ pressed }) => [
            styles.bubble,
            {
              backgroundColor: colors.secondary,
              borderRadius: radii.xxl,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Text
            style={{
              color: colors.secondaryForeground,
              fontFamily: fonts.sansRegular,
              fontSize: 15,
              lineHeight: 22,
            }}
          >
            {body}
          </Text>
        </Pressable>
      )}
      <View style={styles.meta}>
        {(sending || timestamp !== undefined) && (
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: fonts.sansRegular,
              fontSize: 12,
              fontVariant: ["tabular-nums"],
              paddingHorizontal: 4,
            }}
          >
            {sending ? "Sending…" : formatAgentMessageTime(timestamp!)}
          </Text>
        )}
        {rewindable && (
          <AgentRewindMenu
            capabilities={capabilities}
            disabled={disabled}
            pending={rewinding}
            onRewind={rewind}
          />
        )}
        {!!body && (
          <AgentCopyButton
            text={body}
            label="Copy message"
            copiedLabel="Copied message"
          />
        )}
      </View>
      <AgentMenu
        from={menu.anchorRect}
        visible={menu.visible}
        sections={menuSections}
        onClose={menu.close}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "flex-end", gap: 6 },
  images: {
    maxWidth: "85%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 6,
  },
  bubble: { maxWidth: "85%", paddingHorizontal: 16, paddingVertical: 11 },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
    marginRight: -6,
    minHeight: 32,
  },
});
