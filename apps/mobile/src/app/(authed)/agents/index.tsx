import { useMemo, useState } from "react";
import { Pressable, SectionList, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AgentButton,
  AgentFeedback,
  AgentText,
} from "@/components/agents/AgentPrimitives";
import {
  AgentSearch,
  AgentSessionRow,
} from "@/components/agents/AgentNavigation";
import { AgentWorkingIndicator } from "@/components/agents/AgentWorkingIndicator";
import { AgentProviderIcon } from "@/components/agents/AgentProviderIcon";
import { useAgentConnections } from "@/lib/queries/agents";
import {
  groupWorkspaces,
  matchingSessions,
  workspaceMatches,
  WORKSPACE_CHAT_PREVIEW,
  type WorkspaceGroup,
} from "@/lib/agents/workspaces";
import { agentJson } from "@/lib/agents/api";
import { useTheme } from "@/lib/theme";

const RECENT_CHAT_LIMIT = 5;

export default function AgentsScreen() {
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const connections = useAgentConnections();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const groups = useMemo(
    () => groupWorkspaces(connections.data ?? []),
    [connections.data],
  );
  const recentChats = useMemo(
    () =>
      groups
        .flatMap((group) =>
          group.sessions.map((item) => ({ item, group })),
        )
        .sort(
          (a, b) =>
            (b.item.session.modifiedAt ?? b.item.session.createdAt ?? 0) -
            (a.item.session.modifiedAt ?? a.item.session.createdAt ?? 0),
        )
        .slice(0, RECENT_CHAT_LIMIT),
    [groups],
  );
  const sections = useMemo(
    () =>
      groups.flatMap((group) => {
        const matches = matchingSessions(group, search);
        if (
          search.trim() &&
          !workspaceMatches(group, search) &&
          !matches.length
        )
          return [];
        const closed = !search.trim() && !expanded.has(group.key);
        return [
          {
            ...group,
            closed,
            matchedCount: matches.length,
            runningCount: group.sessions.filter(
              ({ session }) => session.runtimeStatus === "running",
            ).length,
            data: closed ? [] : matches.slice(0, WORKSPACE_CHAT_PREVIEW),
          },
        ];
      }),
    [groups, search, expanded],
  );
  function openWorkspace(group: WorkspaceGroup, create = false) {
    if (create && group.targets.length === 1) {
      const target = group.targets[0];
      router.push({
        pathname: "/agents/new",
        params: {
          workspace: target.workspace.id,
          provider: target.provider,
          name: group.name,
        },
      });
      return;
    }
    router.push({
      pathname: "/agents/workspace",
      params: {
        workspace: group.targets[0].workspace.id,
        name: group.name,
        ...(create ? { create: "1" } : {}),
        ...(search.trim() ? { search } : {}),
      },
    });
  }
  async function sync() {
    setSyncing(true);
    setSyncError(undefined);
    try {
      const { result } = await agentJson<{
        result: { failures: { message: string }[] };
      }>("/api/agent-workspaces/sync", {});
      if (result.failures.length)
        setSyncError(
          result.failures.map((failure) => failure.message).join("\n"),
        );
      await connections.refetch();
    } catch (error) {
      setSyncError(
        error instanceof Error ? error.message : "Couldn't sync sessions.",
      );
    } finally {
      setSyncing(false);
    }
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: "Agent Connections",
          headerRight: () => (
            <AgentButton
              label={syncing ? "Syncing…" : "Sync"}
              icon="sync-outline"
              disabled={syncing}
              onPress={() => void sync()}
            />
          ),
        }}
      />
      <AgentSearch value={search} onChangeText={setSearch} />
      {(connections.isPending || connections.error || syncError) && (
        <AgentFeedback
          loading={connections.isPending}
          error={syncError ?? connections.error?.message}
          retry={() => {
            setSyncError(undefined);
            void connections.refetch();
          }}
        />
      )}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.session.id}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        refreshing={connections.refreshing}
        onRefresh={() => void connections.refresh()}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingBottom: insets.bottom + 20,
        }}
        ListHeaderComponent={
          !search.trim() && groups.length > 0 ? (
            <View>
              {recentChats.length > 0 && (
                <View style={{ paddingBottom: 12 }}>
                  <Text
                    accessibilityRole="header"
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      color: colors.foreground,
                      fontFamily: fonts.sansSemiBold,
                      fontSize: 16,
                    }}
                  >
                    Recent chats
                  </Text>
                  {recentChats.map(({ item, group }) => (
                    <AgentSessionRow
                      key={item.session.id}
                      item={item}
                      workspaceName={group.name}
                      contextLabel={`${group.name} · ${group.host.name}`}
                    />
                  ))}
                </View>
              )}
              <Text
                accessibilityRole="header"
                style={{
                  paddingHorizontal: 12,
                  paddingTop: 8,
                  color: colors.foreground,
                  fontFamily: fonts.sansSemiBold,
                  fontSize: 16,
                }}
              >
                Workspaces
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          !connections.isPending && !connections.error ? (
            <View style={{ padding: 24, gap: 12, alignItems: "center" }}>
              <Ionicons
                name="folder-open-outline"
                size={32}
                color={colors.mutedForeground}
              />
              <AgentText title>
                {search
                  ? "No matching workspaces or chats"
                  : "Your agents, on your phone"}
              </AgentText>
              <AgentText muted>
                {search
                  ? "Try another search."
                  : "Add an Agent Connection and workspace on the web, then sync to discover your chats."}
              </AgentText>
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <View style={{ paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${search.trim() ? "Open" : section.closed ? "Expand" : "Collapse"} ${section.name}`}
                accessibilityState={{ expanded: !section.closed }}
                onPress={() => {
                  if (search.trim()) {
                    openWorkspace(section);
                    return;
                  }
                  setExpanded((current) => {
                    const next = new Set(current);
                    next.has(section.key)
                      ? next.delete(section.key)
                      : next.add(section.key);
                    return next;
                  });
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  minWidth: 0,
                  minHeight: 52,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 9,
                  paddingHorizontal: 8,
                  borderRadius: 10,
                  backgroundColor: pressed ? colors.muted : "transparent",
                })}
              >
                <Ionicons
                  name={section.closed ? "chevron-forward" : "chevron-down"}
                  size={16}
                  color={colors.mutedForeground}
                />
                {section.closed && section.runningCount > 0 ? (
                  <AgentWorkingIndicator
                    label={`${section.runningCount} ${section.runningCount === 1 ? "agent working" : "agents working"} in ${section.name}`}
                  />
                ) : (
                  <Ionicons
                    name="folder-outline"
                    size={20}
                    color={colors.foreground}
                  />
                )}
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.foreground,
                      fontFamily: fonts.sansSemiBold,
                      fontSize: 15,
                    }}
                  >
                    {section.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: fonts.sansRegular,
                      fontSize: 12,
                    }}
                  >
                    {section.host.name} · {section.matchedCount}{" "}
                    {section.matchedCount === 1 ? "chat" : "chats"}
                    {section.runningCount > 0
                      ? ` · ${section.runningCount} working`
                      : ""}
                  </Text>
                </View>
                {section.closed && (
                  <View style={{ flexDirection: "row", gap: 4 }}>
                    {section.targets.map((target) => (
                      <AgentProviderIcon
                        key={target.workspace.id}
                        provider={target.provider}
                        size={16}
                      />
                    ))}
                  </View>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`New chat in ${section.name}`}
                onPress={() => openWorkspace(section, true)}
                style={{ padding: 12, minHeight: 44 }}
              >
                <Ionicons name="add" size={22} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>
        )}
        renderItem={({ item, section }) => (
          <View
            style={{
              marginLeft: 23,
              borderLeftWidth: 1,
              borderColor: colors.border,
              paddingLeft: 6,
            }}
          >
            <AgentSessionRow item={item} workspaceName={section.name} />
          </View>
        )}
        renderSectionFooter={({ section }) =>
          section.closed ? null : (
            <View style={{ marginLeft: 30, paddingBottom: 12 }}>
              {!section.data.length && (
                <AgentText muted>No chats yet</AgentText>
              )}
              <AgentButton
                label={
                  section.matchedCount > WORKSPACE_CHAT_PREVIEW
                    ? `View all ${section.matchedCount} chats`
                    : "Open workspace"
                }
                icon="arrow-forward-outline"
                onPress={() => openWorkspace(section)}
              />
            </View>
          )
        }
      />
    </View>
  );
}
