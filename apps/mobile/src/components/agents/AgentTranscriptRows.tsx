import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  describeAgentActivity,
  describeAgentTool,
  type AgentActivityEntry,
  type AgentErrorPresentation,
  type AgentNotificationPresentation,
  type AgentTask,
  type AgentTaskListSnapshot,
  type AgentToolStatus,
  type AgentTranscriptItem,
} from "@overtchat/shared/agent-presentation";
import { MarkdownBody } from "@/components/chat/MarkdownBody";
import { useTheme } from "@/lib/theme";
import { AgentToolDetails, AgentToolRow, agentToolIcon } from "./AgentToolDetails";
import { AgentSheet, AgentText } from "./AgentPrimitives";
import { AgentWorkingIndicator } from "./AgentWorkingIndicator";

function Chevron({ open, size = 14 }: { open: boolean; size?: number }) {
  const { colors } = useTheme();
  const rotation = useSharedValue(open ? 90 : 0);
  useEffect(() => {
    rotation.value = withTiming(open ? 90 : 0, {
      duration: 180,
      reduceMotion: ReduceMotion.System,
    });
  }, [open, rotation]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
  return (
    <Animated.View
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Ionicons name="chevron-forward" size={size} color={colors.mutedForeground} />
    </Animated.View>
  );
}

function ActivityIcon({
  entries,
  status,
}: {
  entries: AgentActivityEntry[];
  status: AgentToolStatus;
}) {
  const { colors } = useTheme();
  if (status === "running") return <AgentWorkingIndicator label="Working" />;
  if (status === "failed")
    return <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} />;
  const tools = entries.flatMap((entry) => (entry.type === "tool" ? [entry.tool] : []));
  const categories = new Set(tools.map((tool) => describeAgentTool(tool).category));
  const name = tools.length
    ? categories.size === 1
      ? agentToolIcon(describeAgentTool(tools[0]).category)
      : "construct-outline"
    : entries.some((entry) => entry.type === "subagent")
      ? "people-outline"
      : "bulb-outline";
  return <Ionicons name={name} size={16} color={colors.mutedForeground} />;
}

/** One collapsible group of tool calls, thinking, or subagent work. */
export function AgentActivityGroup({
  entries,
  active,
  onToggle,
}: {
  entries: AgentActivityEntry[];
  active: boolean;
  /** Called before the group opens or closes. */
  onToggle?: () => void;
}) {
  const { colors, fonts } = useTheme();
  const summary = describeAgentActivity(entries, active);
  const [expanded, setExpanded] = useState(summary.status === "failed");
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const selected = entries.find(
    (entry) => entry.type === "tool" && entry.id === selectedToolId,
  );
  const selectedTool = selected?.type === "tool" ? selected.tool : undefined;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary.label}
        accessibilityHint={summary.secondary ?? undefined}
        accessibilityState={{ expanded }}
        onPress={() => {
          onToggle?.();
          setExpanded((current) => !current);
        }}
        style={({ pressed }) => [styles.activityHeader, { opacity: pressed ? 0.6 : 1 }]}
      >
        <View style={styles.activityIcon}>
          <ActivityIcon entries={entries} status={summary.status} />
        </View>
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            color: summary.status === "failed" ? colors.destructive : colors.mutedForeground,
            fontFamily: fonts.sansRegular,
            fontSize: 14,
          }}
        >
          {summary.label}
        </Text>
        {!!summary.secondary && (
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 1,
              color: colors.mutedForeground,
              fontFamily: fonts.mono,
              fontSize: 12,
            }}
          >
            {summary.secondary}
          </Text>
        )}
        <Chevron open={expanded} />
      </Pressable>
      {expanded && (
        <View style={[styles.rail, { borderLeftColor: colors.border }]}>
          {entries.map((entry) => {
            if (entry.type === "thinking")
              return (
                <View key={entry.id} style={{ paddingVertical: 4 }}>
                  <MarkdownBody text={entry.content} variant="thinking" fuzzyLinks={false} />
                </View>
              );
            if (entry.type === "subagent")
              return (
                <View key={entry.id} style={{ gap: 2, paddingVertical: 4 }}>
                  <AgentText>
                    {entry.activity.action} · {entry.activity.status}
                  </AgentText>
                  {!!entry.activity.prompt && (
                    <AgentText muted>{entry.activity.prompt}</AgentText>
                  )}
                  {entry.activity.events.length > 0 && (
                    <AgentText muted>{entry.activity.events.join("\n")}</AgentText>
                  )}
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
        title={selectedTool ? describeAgentTool(selectedTool).label : "Tool details"}
        visible={!!selectedTool}
        onClose={() => setSelectedToolId(null)}
        closeLabel="Close tool details"
        snapPoints={["60%", "90%"]}
      >
        {selectedTool && <AgentToolDetails tool={selectedTool} active={active} />}
      </AgentSheet>
    </View>
  );
}

/** Folded work for a settled turn; expanding it reveals the steps in place. */
export function AgentWorkSummary({
  label,
  expanded,
  onPress,
}: {
  label: string;
  expanded: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.workSummary,
        { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: fonts.sansRegular,
          fontSize: 14,
          fontVariant: ["tabular-nums"],
        }}
      >
        {label}
      </Text>
      <Chevron open={expanded} />
    </Pressable>
  );
}

function Card({
  icon,
  title,
  trailing,
  children,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { colors, fonts, radii } = useTheme();
  return (
    <View
      style={{
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        borderRadius: radii.xl,
        backgroundColor: colors.card,
        overflow: "hidden",
      }}
    >
      <View
        style={[
          styles.cardHeader,
          { borderBottomColor: colors.border, backgroundColor: colors.muted },
        ]}
      >
        <Ionicons name={icon} size={16} color={colors.mutedForeground} />
        <Text
          accessibilityRole="header"
          style={{
            flex: 1,
            color: colors.foreground,
            fontFamily: fonts.sansMedium,
            fontSize: 14,
          }}
        >
          {title}
        </Text>
        {trailing}
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function TaskRow({ task }: { task: AgentTask }) {
  const { colors, fonts } = useTheme();
  return (
    <View style={styles.taskRow}>
      <View style={styles.taskIcon}>
        {task.status === "completed" ? (
          <Ionicons
            accessibilityLabel="Completed"
            name="checkmark-circle"
            size={17}
            color={colors.mutedForeground}
          />
        ) : task.status === "in_progress" ? (
          <ActivityIndicator
            accessibilityLabel="In progress"
            size="small"
            color={colors.foreground}
            style={{ transform: [{ scale: 0.7 }] }}
          />
        ) : (
          <Ionicons
            accessibilityLabel="Pending"
            name="ellipse-outline"
            size={17}
            color={colors.mutedForeground}
          />
        )}
      </View>
      <Text
        style={{
          flex: 1,
          color: task.status === "completed" ? colors.mutedForeground : colors.foreground,
          fontFamily: task.status === "in_progress" ? fonts.sansMedium : fonts.sansRegular,
          fontSize: 14,
          lineHeight: 20,
          textDecorationLine: task.status === "completed" ? "line-through" : "none",
        }}
      >
        {task.step}
      </Text>
    </View>
  );
}

export function AgentTaskListCard({ snapshot }: { snapshot: AgentTaskListSnapshot }) {
  const { colors, fonts } = useTheme();
  const completed = snapshot.tasks.filter((task) => task.status === "completed").length;
  return (
    <Card
      icon="list-outline"
      title="Tasks"
      trailing={
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: fonts.sansRegular,
            fontSize: 12,
            fontVariant: ["tabular-nums"],
          }}
        >
          {completed}/{snapshot.tasks.length}
        </Text>
      }
    >
      {!!snapshot.explanation && <AgentText muted>{snapshot.explanation}</AgentText>}
      {snapshot.tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </Card>
  );
}

export function AgentPlanCard({
  item,
  footer,
}: {
  item: Extract<AgentTranscriptItem, { type: "plan" }>;
  footer?: React.ReactNode;
}) {
  return (
    <Card icon="map-outline" title="Plan">
      {!!item.explanation && <AgentText muted>{item.explanation}</AgentText>}
      {item.text ? (
        <MarkdownBody text={item.text} fuzzyLinks={false} />
      ) : (
        item.steps.map((step, index) => (
          <TaskRow
            key={`${index}:${step.step}`}
            task={{
              id: String(index),
              step: step.step,
              status:
                step.status === "completed" || step.status === "in_progress"
                  ? step.status
                  : "pending",
            }}
          />
        ))
      )}
      {footer}
    </Card>
  );
}

export function AgentErrorCard({
  error,
  onToggle,
}: {
  error: AgentErrorPresentation;
  /** Called before the details open or close. */
  onToggle?: () => void;
}) {
  const { colors, fonts, radii } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View
      style={{
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        borderRadius: radii.xl,
        backgroundColor: colors.muted,
        overflow: "hidden",
      }}
    >
      <View style={styles.errorRow}>
        <Ionicons name="alert-circle-outline" size={18} color={colors.destructive} />
        <Text
          accessibilityRole="alert"
          selectable
          style={{
            flex: 1,
            color: colors.foreground,
            fontFamily: fonts.sansRegular,
            fontSize: 14,
            lineHeight: 20,
          }}
        >
          {error.summary}
        </Text>
        {!!error.details && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={open ? "Hide error details" : "Show error details"}
            accessibilityState={{ expanded: open }}
            hitSlop={8}
            onPress={() => {
              onToggle?.();
              setOpen((current) => !current);
            }}
            style={styles.errorToggle}
          >
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: fonts.sansMedium,
                fontSize: 12,
              }}
            >
              Details
            </Text>
            <Ionicons
              name={open ? "chevron-up" : "chevron-down"}
              size={12}
              color={colors.mutedForeground}
            />
          </Pressable>
        )}
      </View>
      {open && !!error.details && (
        <Text
          selectable
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: colors.mutedForeground,
            fontFamily: fonts.mono,
            fontSize: 12,
            lineHeight: 18,
          }}
        >
          {error.details}
        </Text>
      )}
    </View>
  );
}

export function AgentNotificationRow({
  notification,
}: {
  notification: AgentNotificationPresentation;
}) {
  const { colors, fonts } = useTheme();
  const tint =
    notification.level === "error"
      ? colors.destructive
      : notification.level === "warning"
        ? "#d97706"
        : colors.mutedForeground;
  return (
    <View
      accessibilityRole={notification.level === "error" ? "alert" : undefined}
      style={styles.notification}
    >
      <Ionicons
        name={notification.level === "info" ? "information-circle-outline" : "warning-outline"}
        size={17}
        color={tint}
        style={{ marginTop: 2 }}
      />
      <Text
        selectable
        style={{
          flex: 1,
          color: colors.foreground,
          fontFamily: fonts.sansRegular,
          fontSize: 14,
          lineHeight: 21,
        }}
      >
        {notification.message}
      </Text>
    </View>
  );
}

export function AgentCompactionDivider({
  item,
}: {
  item: Extract<AgentTranscriptItem, { type: "compaction" }>;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityLabel={item.label}
      testID="agent-compaction"
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 }}
    >
      <View style={{ height: StyleSheet.hairlineWidth, flex: 1, backgroundColor: colors.border }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
        {item.active ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <Ionicons name="contract-outline" size={14} color={colors.mutedForeground} />
        )}
        <View style={{ flexShrink: 1, alignItems: "center" }}>
          <AgentText muted={!item.failed} danger={item.failed}>
            {item.label}
          </AgentText>
          {item.detail && <AgentText muted>{item.detail}</AgentText>}
        </View>
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, flex: 1, backgroundColor: colors.border }} />
    </View>
  );
}

const styles = StyleSheet.create({
  activityHeader: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  activityIcon: { width: 18, alignItems: "center" },
  rail: {
    marginLeft: 8,
    paddingLeft: 12,
    borderLeftWidth: 1,
    gap: 2,
    marginBottom: 4,
  },
  workSummary: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cardBody: { paddingHorizontal: 12, paddingVertical: 12, gap: 10 },
  taskRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  taskIcon: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingTop: 2,
  },
  notification: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
});
