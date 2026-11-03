import { useMemo, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  agentSessionActivityAt,
  agentSessionState,
} from "@overtchat/shared/agent-attention";
import {
  AgentButton,
  AgentFeedback,
  AgentText,
} from "@/components/agents/AgentPrimitives";
import {
  AgentBranch,
  AgentSearch,
  AgentSessionRow,
} from "@/components/agents/AgentNavigation";
import type { AgentAttentionItem } from "@/lib/agents/attention";
import { useAgentConnections } from "@/lib/queries/agents";
import {
  agentHostLabel,
  groupWorkspaces,
  matchingSessions,
} from "@/lib/agents/workspaces";
import { useTheme } from "@/lib/theme";
import { useNow } from "@/lib/useNow";

/** One folder: where it is, its branch, and every session in it. */
export default function AgentWorkspaceScreen() {
  const params = useLocalSearchParams<{
    workspace: string;
    name?: string;
    search?: string;
  }>();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const connections = useAgentConnections();
  const [search, setSearch] = useState(params.search ?? "");
  const group = useMemo(
    () =>
      groupWorkspaces(connections.data ?? []).find((group) =>
        group.targets.some(
          (target) => target.workspace.id === params.workspace,
        ),
      ),
    [connections.data, params.workspace],
  );
  const sessions = useMemo<AgentAttentionItem[]>(
    () =>
      group
        ? matchingSessions(group, search).map((item) => ({
            item,
            group,
            state: agentSessionState(item.session),
            since: agentSessionActivityAt(item.session),
          }))
        : [],
    [group, search],
  );
  const working = sessions.some(({ state }) => state === "working");
  const now = useNow(working ? 1_000 : 30_000);
  function startSession() {
    if (!group) return;
    // The folder's most recently used agent, else the first with a record of it.
    const recent = group.sessions[0];
    router.navigate({
      pathname: "/agents",
      params: {
        workspace: recent?.workspaceId ?? group.targets[0]!.workspace.id,
        provider: recent?.provider ?? group.targets[0]!.provider,
      },
    });
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: group?.name ?? params.name ?? "Workspace",
          headerRight: () => (
            <AgentButton
              label="New session"
              icon="add"
              disabled={!group}
              onPress={startSession}
            />
          ),
        }}
      />
      {group && (
        <View style={{ paddingHorizontal: 20, paddingVertical: 12, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons
              name={
                group.host.transport === "ssh"
                  ? "server-outline"
                  : "desktop-outline"
              }
              size={14}
              color={colors.mutedForeground}
            />
            <AgentText muted>{agentHostLabel(group.host)}</AgentText>
          </View>
          <Text
            numberOfLines={2}
            style={{
              color: colors.mutedForeground,
              fontFamily: fonts.mono,
              fontSize: 12,
            }}
          >
            {group.path}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <AgentBranch workspace={params.workspace} />
          </View>
        </View>
      )}
      <AgentSearch
        value={search}
        onChangeText={setSearch}
        placeholder="Search sessions in this workspace"
      />
      {(connections.isPending || connections.error) && (
        <AgentFeedback
          loading={connections.isPending}
          error={connections.error?.message}
          retry={() => void connections.refetch()}
        />
      )}
      {!connections.isPending && !connections.error && !group && (
        <AgentFeedback error="This workspace is no longer available. Go back to Agent Connections and sync." />
      )}
      <FlatList
        data={sessions}
        keyExtractor={(entry) => entry.item.session.id}
        keyboardShouldPersistTaps="handled"
        refreshing={connections.refreshing}
        onRefresh={() => void connections.refresh()}
        contentContainerStyle={{
          paddingHorizontal: 8,
          paddingBottom: insets.bottom + 20,
        }}
        ListHeaderComponent={
          group ? (
            <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
              <AgentText muted>
                {search
                  ? `${sessions.length} matching ${sessions.length === 1 ? "session" : "sessions"}`
                  : `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"} · Most recent first`}
              </AgentText>
            </View>
          ) : null
        }
        ListEmptyComponent={
          group ? (
            <View style={{ padding: 24, gap: 8 }}>
              <AgentText title>
                {search ? "No matching sessions" : "Start your first session"}
              </AgentText>
              <AgentText muted>
                {search
                  ? "Try another search."
                  : "Use New session; the agent can be changed before sending."}
              </AgentText>
            </View>
          ) : null
        }
        renderItem={({ item: entry }) => (
          <AgentSessionRow
            entry={entry}
            context="workspace"
            now={now}
            onPress={() =>
              router.push({
                pathname: "/agent/[id]",
                params: {
                  id: entry.item.session.id,
                  workspace: entry.item.workspaceId,
                  name: entry.group.name,
                },
              })
            }
          />
        )}
      />
    </View>
  );
}
