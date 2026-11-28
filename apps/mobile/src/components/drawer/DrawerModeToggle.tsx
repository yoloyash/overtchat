import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AgentAttentionCounts } from "@overtchat/shared/agent-attention";
import { agentSessionStateColor } from "@/components/agents/AgentSessionStatus";
import type { SidebarMode } from "@/lib/agents/sidebarMode";
import { useTheme } from "@/lib/theme";

const MODES: {
  mode: SidebarMode;
  labelKey: "sidebar.mode.chat" | "sidebar.mode.agents";
  icon: React.ComponentProps<typeof Ionicons>["name"];
}[] = [
  { mode: "chat", labelKey: "sidebar.mode.chat", icon: "chatbubbles-outline" },
  { mode: "agents", labelKey: "sidebar.mode.agents", icon: "terminal-outline" },
];

/** How the Agents half announces what waits there while Chat is shown. */
export function agentsToggleBadgeLabel(
  counts: AgentAttentionCounts,
  t: TFunction,
): string {
  if (counts.needsYou > 0) {
    return t("sidebar.mobile.mode.badgeNeedsYou", {
      count: counts.needsYou,
    });
  }
  if (counts.unread > 0) {
    return t("sidebar.mobile.mode.badgeUnread", {
      count: counts.unread,
    });
  }
  return "";
}

/**
 * Switches the drawer between chats and agents, as the web sidebar's toggle
 * does. In Chat mode the Agents half counts sessions that need you, or shows
 * a dot when finished results are waiting.
 */
export function DrawerModeToggle({
  mode,
  agentCounts,
  onSelect,
}: {
  mode: SidebarMode;
  agentCounts: AgentAttentionCounts;
  onSelect: (mode: SidebarMode) => void;
}) {
  const theme = useTheme();
  const { colors, fonts, radii } = theme;
  const { t } = useTranslation();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.group, { backgroundColor: colors.muted, borderRadius: radii.lg }]}
    >
      {MODES.map(({ mode: option, labelKey, icon }) => {
        const selected = option === mode;
        const label = t(labelKey);
        const showAgentsBadge = option === "agents" && !selected;
        const accessibilityLabel =
          showAgentsBadge && agentCounts.needsYou > 0
            ? t("sidebar.mode.needsYou", { label, count: agentCounts.needsYou })
            : showAgentsBadge && agentCounts.unread > 0
              ? t("sidebar.mode.unreadToReview", {
                  label,
                  count: agentCounts.unread,
                })
              : label;
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={accessibilityLabel}
            onPress={() => onSelect(option)}
            style={({ pressed }) => [
              styles.option,
              {
                borderRadius: radii.md,
                backgroundColor: selected
                  ? colors.background
                  : pressed
                    ? colors.accent
                    : "transparent",
              },
            ]}
          >
            <Ionicons
              name={icon}
              size={15}
              color={selected ? colors.foreground : colors.mutedForeground}
            />
            <Text
              style={[
                styles.label,
                {
                  color: selected ? colors.foreground : colors.mutedForeground,
                  fontFamily: fonts.sansMedium,
                },
              ]}
            >
              {label}
            </Text>
            {showAgentsBadge && agentCounts.needsYou > 0 ? (
              <View
                style={[
                  styles.count,
                  {
                    borderRadius: radii.pill,
                    backgroundColor: agentSessionStateColor("approval", theme),
                  },
                ]}
              >
                <Text style={[styles.countText, { fontFamily: fonts.sansSemiBold }]}>
                  {agentCounts.needsYou > 9 ? "9+" : agentCounts.needsYou}
                </Text>
              </View>
            ) : showAgentsBadge && agentCounts.unread > 0 ? (
              <View
                style={[styles.dot, { backgroundColor: agentSessionStateColor("unread", theme) }]}
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: "row",
    gap: 2,
    padding: 2,
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 6,
  },
  option: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 8,
  },
  label: { fontSize: 13 },
  count: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { color: "#ffffff", fontSize: 10, fontVariant: ["tabular-nums"] },
  dot: { width: 6, height: 6, borderRadius: 6 },
});
