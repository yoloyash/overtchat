import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AgentAttentionCounts } from "@overtchat/shared/agent-attention";
import { agentSessionStateColor } from "@/components/agents/AgentSessionStatus";
import type { SidebarMode } from "@/lib/agents/sidebarMode";
import { useTheme } from "@/lib/theme";

const MODES: {
  mode: SidebarMode;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}[] = [
  { mode: "chat", label: "Chat", icon: "chatbubbles-outline" },
  { mode: "agents", label: "Agents", icon: "terminal-outline" },
];

/** How the Agents half announces what waits there while Chat is shown. */
export function agentsToggleBadgeLabel(counts: AgentAttentionCounts): string {
  if (counts.needsYou > 0) {
    return `${counts.needsYou} ${counts.needsYou === 1 ? "needs" : "need"} you`;
  }
  if (counts.unread > 0) {
    return `${counts.unread} finished to review`;
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
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.group, { backgroundColor: colors.muted, borderRadius: radii.lg }]}
    >
      {MODES.map(({ mode: option, label, icon }) => {
        const selected = option === mode;
        const badge = option === "agents" && !selected ? agentsToggleBadgeLabel(agentCounts) : "";
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={badge ? `${label}, ${badge}` : label}
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
            {badge && agentCounts.needsYou > 0 ? (
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
            ) : badge ? (
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
