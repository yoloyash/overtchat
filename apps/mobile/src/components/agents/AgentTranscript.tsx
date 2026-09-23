import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import {
  projectAgentTranscript,
  agentActiveTurnStart,
  describeAgentActivity,
  describeAgentTool,
  type AgentActivityEntry,
  type AgentTranscriptItem,
} from "@overtchat/shared/agent-presentation";
import { AgentForkMenu } from "./AgentForkMenu";
import { AgentRewindMenu } from "./AgentRewindMenu";
import type {
  AgentRewindMode,
  AgentRuntimeCapabilities,
  AgentRuntimeSnapshot,
} from "@overtchat/agent-bridge";
import { MarkdownBody } from "@/components/chat/MarkdownBody";
import { record, text } from "@/lib/agents/model";
import { useTheme } from "@/lib/theme";
import { toastError } from "@/lib/toast";
import type { useSpeech } from "@/lib/useSpeech";
import { AgentToolRow, AgentToolDetails } from "./AgentToolDetails";
import { AgentButton, AgentText, AgentSheet } from "./AgentPrimitives";
import { AgentImage } from "./AgentImage";

const position = {
  autoscrollToBottomThreshold: 0.15,
  startRenderingFromBottom: true,
  animateAutoScrollToBottom: false,
};

export function AgentTranscript({
  speech,
  snapshot,
  question,
  onImplementPlan,
  onFork,
  onRewind,
  disabled,
}: {
  speech: ReturnType<typeof useSpeech>;
  snapshot: AgentRuntimeSnapshot;
  question?: React.ReactElement;
  onImplementPlan: (plan: string) => void;
  onFork?: (messageId: string, chooseWorkspace: boolean) => Promise<void>;
  onRewind?: (messageId: string, mode: AgentRewindMode) => Promise<void>;
  disabled: boolean;
}) {
  const { colors } = useTheme();
  const items = useMemo(
    () => projectAgentTranscript(snapshot.messages),
    [snapshot.messages],
  );
  const list = useRef<FlashListRef<AgentTranscriptItem>>(null);
  const [away, setAway] = useState(false);
  const userScrolled = useRef(false);
  const measureFrame = useRef<number | null>(null);
  const jumpToLatest = useCallback((animated = true) => {
    // FlashList can suppress native scroll callbacks during its own position
    // correction. Clear the button explicitly for both initial load and jumps.
    userScrolled.current = false;
    setAway(false);
    list.current?.scrollToEnd({ animated });
  }, []);
  const measurePosition = useCallback(() => {
    if (measureFrame.current !== null)
      cancelAnimationFrame(measureFrame.current);
    measureFrame.current = requestAnimationFrame(() => {
      measureFrame.current = null;
      if (!userScrolled.current || !list.current) return;
      const viewport = list.current.getWindowSize().height;
      const height = list.current.getChildContainerDimensions().height;
      const offset = list.current.getAbsoluteLastScrollOffset();
      if (viewport > 0) setAway(height - viewport - offset > 140);
    });
  }, []);
  useEffect(
    () => () => {
      if (measureFrame.current !== null)
        cancelAnimationFrame(measureFrame.current);
    },
    [],
  );
  const active = snapshot.status === "running";
  const activeTurnStart = agentActiveTurnStart(items, active);
  return (
    <View style={{ flex: 1 }}>
      <FlashList
        ref={list}
        style={{ flex: 1 }}
        data={items}
        extraData={{ activeId: speech.activeId, status: speech.status, active }}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
        maintainVisibleContentPosition={position}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        onLoad={() => jumpToLatest(false)}
        onScrollBeginDrag={() => {
          userScrolled.current = true;
        }}
        onLayout={measurePosition}
        onContentSizeChange={measurePosition}
        onMomentumScrollEnd={measurePosition}
        onEndReached={() => setAway(false)}
        onEndReachedThreshold={0.1}
        onScroll={({ nativeEvent }) => {
          if (
            !userScrolled.current ||
            nativeEvent.layoutMeasurement.height <= 0
          )
            return;
          setAway(
            nativeEvent.contentSize.height -
              nativeEvent.contentOffset.y -
              nativeEvent.layoutMeasurement.height >
              140,
          );
        }}
        scrollEventThrottle={16}
        ListEmptyComponent={
          question ? null : (
            <View style={{ paddingVertical: 36, gap: 8 }}>
              <AgentText title>What would you like to work on?</AgentText>
              <AgentText muted>
                Messages run in this workspace on your connected machine.
              </AgentText>
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <TranscriptItem
            speech={speech}
            turnActive={index >= activeTurnStart}
            item={item}
            active={active}
            disabled={disabled}
            onImplementPlan={onImplementPlan}
            onFork={onFork}
            onRewind={onRewind}
            capabilities={snapshot.capabilities}
          />
        )}
        ListFooterComponent={
          question ?? (active ? <AgentText muted>Working…</AgentText> : null)
        }
      />
      {away && (
        <View
          pointerEvents="box-none"
          style={{ position: "absolute", bottom: 8, alignSelf: "center" }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Jump to latest"
            onPress={() => jumpToLatest()}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.muted : colors.card,
              alignItems: "center",
              justifyContent: "center",
            })}
          >
            <Ionicons name="arrow-down" size={20} color={colors.foreground} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const TranscriptItem = memo(function TranscriptItem({
  speech,
  turnActive,
  item,
  active,
  disabled,
  onImplementPlan,
  onFork,
  onRewind,
  capabilities,
}: {
  speech: ReturnType<typeof useSpeech>;
  turnActive: boolean;
  item: AgentTranscriptItem;
  active: boolean;
  capabilities: AgentRuntimeCapabilities;
  disabled: boolean;
  onImplementPlan: (plan: string) => void;
  onFork?: (messageId: string, chooseWorkspace: boolean) => Promise<void>;
  onRewind?: (messageId: string, mode: AgentRewindMode) => Promise<void>;
}) {
  const { colors, radii } = useTheme();
  let content;
  switch (item.type) {
    case "assistant_text":
      content = (
        <View>
          <MarkdownBody text={item.text} />
          {!turnActive && item.actionable && item.messageId && onFork && (
            <AgentForkMenu
              disabled={disabled}
              onFork={(chooseWorkspace) =>
                onFork(item.messageId!, chooseWorkspace)
              }
            />
          )}
          {!turnActive && (
            <AgentSpeakButton id={item.key} text={item.text} speech={speech} />
          )}
        </View>
      );
      break;
    case "assistant_error":
      content = (
        <AgentText danger>
          {item.error.summary}
          {item.error.details ? `\n${item.error.details}` : ""}
        </AgentText>
      );
      break;
    case "notification":
      content = (
        <AgentText
          muted={item.notification.level === "info"}
          danger={item.notification.level === "error"}
        >
          {item.notification.message}
        </AgentText>
      );
      break;
    case "turn_footer":
      content = (
        <View>
          <TurnFooter item={item} />
          {item.messageId && onFork && (
            <AgentForkMenu
              disabled={disabled}
              onFork={(chooseWorkspace) =>
                onFork(item.messageId!, chooseWorkspace)
              }
            />
          )}
        </View>
      );
      break;
    case "activity":
      content = (
        <Activity key={item.key} entries={item.entries} active={active} />
      );
      break;
    case "plan":
      content = (
        <View style={{ gap: 8 }}>
          <AgentText title>Plan</AgentText>
          <MarkdownBody text={item.text} />
          {item.steps.map((step, i) => (
            <AgentText key={i}>
              {step.status === "completed" ? "✓" : "○"} {step.step}
            </AgentText>
          ))}
          {!turnActive && (
            <AgentSpeakButton id={item.key} text={item.text} speech={speech} />
          )}
          {item.actionable && (
            <AgentButton
              label="Implement plan"
              disabled={disabled || active}
              onPress={() => onImplementPlan(item.text)}
            />
          )}
        </View>
      );
      break;
    case "task_list":
      content = (
        <View style={{ gap: 4 }}>
          {item.snapshot.tasks.map((task, i) => (
            <AgentText key={i}>
              {task.status === "completed"
                ? "✓"
                : task.status === "in_progress"
                  ? "●"
                  : "○"}{" "}
              {task.step}
            </AgentText>
          ))}
        </View>
      );
      break;
    case "message": {
      const message = record(item.message);
      const parts = Array.isArray(message.content)
        ? message.content.map(record)
        : [];
      const body =
        typeof message.content === "string"
          ? message.content
          : parts
              .filter((part) => part.type === "text")
              .map((part) => text(part.text))
              .join("\n");
      content = (
        <View
          style={{
            gap: 8,
            backgroundColor:
              message.role === "user" ? colors.muted : "transparent",
            borderRadius: radii.lg,
            padding: message.role === "user" ? 12 : 0,
          }}
        >
          {!!body && <MarkdownBody text={body} />}
          {message.role === "user" &&
            message.overtchatRewindable !== false &&
            typeof message.id === "string" &&
            !message.id.startsWith("submission:") &&
            onRewind && (
              <AgentRewindMenu
                capabilities={capabilities}
                disabled={disabled}
                onRewind={(mode) => onRewind(message.id as string, mode)}
              />
            )}
          {parts
            .filter((part) => part.type === "image")
            .map((part, i) => (
              <AgentImage
                key={i}
                label={text(part.filename) || "Attached image"}
                url={
                  text(part.url) ||
                  (part.data
                    ? `data:${text(part.mimeType)};base64,${text(part.data)}`
                    : "")
                }
              />
            ))}
        </View>
      );
      break;
    }
  }
  return <View style={{ paddingBottom: 14 }}>{content}</View>;
});

function AgentSpeakButton({
  id,
  text,
  speech,
}: {
  id: string;
  text: string;
  speech: ReturnType<typeof useSpeech>;
}) {
  const { colors } = useTheme();
  const spokenText = text.trim();
  if (!spokenText) return null;
  const active = speech.activeId === id;
  const loading = active && speech.status === "loading";
  const tooLong = spokenText.length > 5_000;
  const disabled = !active && tooLong;
  const label = active
    ? loading ? "Cancel loading speech" : "Stop reading"
    : tooLong ? "Read aloud supports up to 5,000 characters" : "Read aloud";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => void speech.play(id, spokenText)}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
        backgroundColor: pressed ? colors.muted : "transparent",
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.mutedForeground} />
      ) : (
        <Ionicons
          name={active ? "stop-outline" : "volume-medium-outline"}
          size={18}
          color={colors.mutedForeground}
        />
      )}
    </Pressable>
  );
}

function TurnFooter({
  item,
}: {
  item: Extract<AgentTranscriptItem, { type: "turn_footer" }>;
}) {
  // Footer text is the full response for clipboard actions, not another message.
  if (!item.text && item.durationMs === null) return null;
  const seconds =
    item.durationMs === null ? null : Math.round(item.durationMs / 1000);
  const duration =
    seconds === null
      ? null
      : seconds < 60
        ? `${seconds}s`
        : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {!!item.text && <CopyResponseButton key={item.text} text={item.text} />}
      {duration !== null && <AgentText muted>Worked for {duration}</AgentText>}
    </View>
  );
}

function CopyResponseButton({ text }: { text: string }) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? "Copied response" : "Copy response"}
      onPress={() => {
        void Clipboard.setStringAsync(text)
          .then(() => {
            if (!mounted.current) return;
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1200);
          })
          .catch((error) => toastError("Couldn't copy response", error));
      }}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors.muted : "transparent",
      })}
    >
      <Ionicons
        name={copied ? "checkmark" : "copy-outline"}
        size={18}
        color={colors.mutedForeground}
      />
    </Pressable>
  );
}

function Activity({
  entries,
  active,
}: {
  entries: AgentActivityEntry[];
  active: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = describeAgentActivity(entries, active);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const selected = entries.find(
    (entry) => entry.type === "tool" && entry.id === selectedToolId,
  );
  const selectedTool = selected?.type === "tool" ? selected.tool : undefined;
  return (
    <View>
      <AgentButton
        label={summary.label}
        icon={expanded ? "chevron-down" : "chevron-forward"}
        detail={summary.secondary ?? undefined}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && (
        <View style={{ paddingHorizontal: 12, gap: 12 }}>
          {entries.map((entry) => {
            if (entry.type === "thinking")
              return (
                <MarkdownBody
                  key={entry.id}
                  text={entry.content}
                  variant="thinking"
                />
              );
            if (entry.type === "subagent")
              return (
                <View key={entry.id}>
                  <AgentText>
                    {entry.activity.action} · {entry.activity.status}
                  </AgentText>
                  {entry.activity.prompt && (
                    <AgentText muted>{entry.activity.prompt}</AgentText>
                  )}
                  <AgentText muted>
                    {entry.activity.events.join("\n")}
                  </AgentText>
                </View>
              );
            return (
              <AgentToolRow
                key={entry.id}
                tool={entry.tool}
                active={active}
                onPress={() => setSelectedToolId(entry.id)}
              />
            );
          })}
        </View>
      )}
      <AgentSheet
        title={
          selectedTool ? describeAgentTool(selectedTool).label : "Tool details"
        }
        visible={!!selectedTool}
        onClose={() => setSelectedToolId(null)}
        closeLabel="Close tool details"
        snapPoints={["60%", "90%"]}
      >
        {selectedTool && (
          <AgentToolDetails tool={selectedTool} active={active} />
        )}
      </AgentSheet>
    </View>
  );
}
