import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import { useFormatLocale } from "@/components/I18nProvider";
import { useTheme } from "@/lib/theme";
import {
  agentSessionRowMeta,
  agentSessionRowTime,
  agentSessionRowTitle,
  type AgentAttentionItem,
  type AgentSessionRowContext,
} from "@/lib/agents/attention";
import { agentHostLabel } from "@/lib/agents/workspaces";
import { useAgentGitStatus } from "@/lib/queries/agents";
import { AgentProviderIcon } from "./AgentProviderIcon";
import {
  AgentSessionStatusIcon,
  agentSessionStateColor,
  agentSessionStateLabel,
} from "./AgentSessionStatus";

export function AgentSearch({
  value,
  onChangeText,
  placeholder,
  autoFocus = false,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("agents.history.searchPlaceholder");
  const resolvedLabel = placeholder ?? t("agents.history.searchLabel");
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: colors.muted,
        borderRadius: 12,
        marginHorizontal: 16,
        marginVertical: 12,
        paddingHorizontal: 12,
      }}
    >
      <Ionicons
        name="search-outline"
        size={18}
        color={colors.mutedForeground}
      />
      <TextInput
        accessibilityLabel={resolvedLabel}
        placeholder={resolvedPlaceholder}
        placeholderTextColor={colors.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus={autoFocus}
        returnKeyType="search"
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 44,
          color: colors.foreground,
          fontFamily: fonts.sansRegular,
          fontSize: 15,
        }}
      />
      {!!value && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.actions.clearSearch")}
          onPress={() => onChangeText("")}
          hitSlop={10}
          style={{ padding: 8 }}
        >
          <Ionicons
            name="close-circle"
            size={18}
            color={colors.mutedForeground}
          />
        </Pressable>
      )}
    </View>
  );
}

/** What a row announces: its state, title, agent and folder. */
export function agentSessionRowLabel(
  entry: AgentAttentionItem,
  t: TFunction,
): string {
  const { item, group, state } = entry;
  const stateLabel = agentSessionStateLabel(state, t);
  const params = {
    title: agentSessionRowTitle(entry),
    provider: agentProviderMetadata(item.provider).label,
    workspace: group.name,
    host: agentHostLabel(group.host),
  };
  return stateLabel
    ? t("agents.mobile.navigation.sessionRowLabelWithState", {
        ...params,
        state: stateLabel,
      })
    : t("agents.mobile.navigation.sessionRowLabel", params);
}

/**
 * One agent session, in the web sidebar's row design: its state in a fixed
 * slot before the title, the age or live working time on the right, and a
 * second line led by the agent's mark. An optional third line carries what
 * the session asks, why it failed, or how it last replied.
 */
export function AgentSessionRow({
  entry,
  context,
  now,
  time,
  selected = false,
  detail,
  onPress,
  onLongPress,
}: {
  entry: AgentAttentionItem;
  context: AgentSessionRowContext;
  now: number;
  /** Replaces the age, where a list is sorted by another time. */
  time?: string;
  selected?: boolean;
  detail?: string | null;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const theme = useTheme();
  const { colors, fonts, radii } = theme;
  const { item, state } = entry;
  const emphasised = state !== "idle" && state !== "working";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={agentSessionRowLabel(entry, t)}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      style={({ pressed }) => [
        styles.row,
        {
          borderRadius: radii.md,
          backgroundColor: selected
            ? colors.accent
            : pressed
              ? colors.muted
              : "transparent",
        },
      ]}
    >
      <View style={styles.statusSlot}>
        <AgentSessionStatusIcon state={state} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleLine}>
          <Text
            numberOfLines={1}
            style={[
              styles.title,
              {
                color: selected ? colors.accentForeground : colors.foreground,
                fontFamily: emphasised ? fonts.sansMedium : fonts.sansRegular,
              },
            ]}
          >
            {agentSessionRowTitle(entry)}
          </Text>
          <Text
            style={[
              styles.time,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {time ?? agentSessionRowTime(entry, now, t, locale)}
          </Text>
        </View>
        <View style={styles.metaLine}>
          <AgentProviderIcon provider={item.provider} size={12} />
          <Text
            numberOfLines={1}
            style={[
              styles.meta,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {agentSessionRowMeta(entry, context)}
          </Text>
        </View>
        {!!detail && (
          <Text
            numberOfLines={2}
            style={[
              styles.detail,
              {
                color:
                  state === "failed" || state === "approval" || state === "question"
                    ? agentSessionStateColor(state, theme)
                    : colors.mutedForeground,
                fontFamily: fonts.sansRegular,
              },
            ]}
          >
            {detail}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export function AgentBranch({
  workspace,
  fallback,
}: {
  workspace: string;
  fallback?: string;
}) {
  const { t } = useTranslation();
  const { colors, fonts } = useTheme();
  const query = useAgentGitStatus(workspace);
  if (
    query.isPending ||
    (!query.error && !query.data?.isGit) ||
    (query.error && fallback)
  )
    return fallback ? (
      <Text
        numberOfLines={1}
        style={{
          color: colors.mutedForeground,
          fontFamily: fonts.sansRegular,
          fontSize: 12,
          lineHeight: 16,
          flexShrink: 1,
        }}
      >
        {fallback}
      </Text>
    ) : null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        flexShrink: 1,
      }}
    >
      <Ionicons
        name="git-branch-outline"
        size={14}
        color={colors.mutedForeground}
      />
      <Text
        numberOfLines={1}
        style={{
          color: colors.mutedForeground,
          fontFamily: fonts.mono,
          fontSize: 12,
          flexShrink: 1,
        }}
      >
        {query.error
          ? t("agents.mobile.navigation.gitUnavailable")
          : (query.data?.branch ?? t("agents.branch.detachedHead"))}
      </Text>
      {!query.error && query.data?.dirty && (
        <Ionicons
          accessibilityLabel={t("agents.mobile.navigation.uncommittedChanges")}
          name="ellipse"
          size={5}
          color={colors.mutedForeground}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 9,
    paddingLeft: 10,
    paddingRight: 12,
    minHeight: 52,
  },
  statusSlot: {
    width: 14,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, minWidth: 0, gap: 3 },
  titleLine: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 20 },
  time: { fontSize: 12, lineHeight: 20, fontVariant: ["tabular-nums"] },
  metaLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  meta: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 16 },
  detail: { fontSize: 12, lineHeight: 16, marginTop: 2 },
});
