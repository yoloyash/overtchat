import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { useDrawerStatus } from "expo-router/build/react-navigation/drawer";
import * as SecureStore from "expo-secure-store";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AgentSessionRow } from "@/components/agents/AgentNavigation";
import { groupWorkspaces, recentAgentChats } from "@/lib/agents/workspaces";
import { useAgentConnections } from "@/lib/queries/agents";
import { useTheme } from "@/lib/theme";

const EXPANDED_KEY = "overtchat.drawer.agentsExpanded";

export function DrawerAgents({ onNavigate }: { onNavigate: () => void }) {
  const { colors, fonts } = useTheme();
  const pathname = usePathname();
  const open = useDrawerStatus() === "open";
  const [expanded, setExpanded] = useState(
    () => SecureStore.getItem(EXPANDED_KEY) === "1",
  );
  // Only poll while recent chats are visible.
  const connections = useAgentConnections({ enabled: open && expanded });
  const recent = useMemo(
    () => recentAgentChats(groupWorkspaces(connections.data ?? [])),
    [connections.data],
  );

  return (
    <View
      style={{
        paddingBottom: expanded ? 8 : 0,
        borderBottomWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Collapse agents" : "Expand agents"}
        accessibilityState={{ expanded }}
        onPress={() => {
          const next = !expanded;
          SecureStore.setItem(EXPANDED_KEY, next ? "1" : "0");
          setExpanded(next);
        }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          minHeight: 48,
          borderRadius: 10,
          backgroundColor: pressed ? colors.muted : "transparent",
        })}
      >
        <Ionicons
          name={expanded ? "chevron-down" : "chevron-forward"}
          size={14}
          color={colors.mutedForeground}
        />
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: fonts.sansMedium,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          Agents
        </Text>
      </Pressable>
      {expanded && (
        <>
          {recent.map(({ item, group }) => (
            <AgentSessionRow
              key={item.session.id}
              item={item}
              workspaceName={group.name}
              contextLabel={`${group.name} · ${group.host.name}`}
              compact
              selected={
                pathname === `/agents/${encodeURIComponent(item.session.id)}`
              }
              onPress={() => {
                onNavigate();
                router.navigate({
                  pathname: "/agents/[id]",
                  params: {
                    id: item.session.id,
                    workspace: item.workspaceId,
                    name: group.name,
                  },
                });
              }}
            />
          ))}
          {connections.isPending && (
            <ActivityIndicator
              color={colors.mutedForeground}
              style={{ padding: 12 }}
            />
          )}
          {connections.error ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading agent chats"
              onPress={() => void connections.refetch()}
              style={{ padding: 12 }}
            >
              <Text
                style={{
                  color: colors.destructive,
                  fontFamily: fonts.sansRegular,
                  fontSize: 12,
                }}
              >
                Couldn't refresh agents. Tap to retry.
              </Text>
            </Pressable>
          ) : !connections.isPending && !recent.length ? (
            <Text
              style={{
                paddingHorizontal: 12,
                paddingBottom: 8,
                color: colors.mutedForeground,
                fontFamily: fonts.sansRegular,
                fontSize: 12,
              }}
            >
              No agent chats yet
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View all agents"
            onPress={() => {
              onNavigate();
              router.navigate("/agents");
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 12,
              minHeight: 48,
              borderRadius: 10,
              backgroundColor: pressed ? colors.muted : "transparent",
            })}
          >
            <Text
              style={{
                flex: 1,
                color: colors.mutedForeground,
                fontFamily: fonts.sansMedium,
                fontSize: 13,
              }}
            >
              View all
            </Text>
            <Ionicons
              name="chevron-forward"
              size={14}
              color={colors.mutedForeground}
            />
          </Pressable>
        </>
      )}
    </View>
  );
}
