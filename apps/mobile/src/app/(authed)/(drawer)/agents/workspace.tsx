import { useEffect, useMemo, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import {
  AgentButton,
  AgentFeedback,
  AgentSheet,
  AgentText,
} from "@/components/agents/AgentPrimitives";
import {
  AgentBranch,
  AgentSearch,
  AgentSessionRow,
} from "@/components/agents/AgentNavigation";
import { AgentProviderIcon } from "@/components/agents/AgentProviderIcon";
import { useAgentConnections } from "@/lib/queries/agents";
import { groupWorkspaces, matchingSessions } from "@/lib/agents/workspaces";
import { useTheme } from "@/lib/theme";

export default function AgentWorkspaceScreen() {
  const params = useLocalSearchParams<{
    workspace: string;
    name?: string;
    create?: string;
    search?: string;
  }>();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const connections = useAgentConnections();
  const [search, setSearch] = useState(params.search ?? "");
  const [creating, setCreating] = useState(params.create === "1");
  const group = useMemo(
    () =>
      groupWorkspaces(connections.data ?? []).find((group) =>
        group.targets.some(
          (target) => target.workspace.id === params.workspace,
        ),
      ),
    [connections.data, params.workspace],
  );
  const sessions = useMemo(
    () => (group ? matchingSessions(group, search) : []),
    [group, search],
  );
  useEffect(() => {
    if (!creating || group?.targets.length !== 1) return;
    setCreating(false);
    const target = group.targets[0];
    router.push({
      pathname: "/agents/new",
      params: {
        workspace: target.workspace.id,
        provider: target.provider,
        name: group.name,
      },
    });
  }, [creating, group]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: group?.name ?? params.name ?? "Workspace",
          headerRight: () => (
            <AgentButton
              label="New chat"
              icon="add"
              disabled={!group}
              onPress={() => setCreating(true)}
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
            <AgentText muted>{group.host.name}</AgentText>
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
        placeholder="Search chats in this workspace"
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
        keyExtractor={(item) => item.session.id}
        keyboardShouldPersistTaps="handled"
        refreshing={connections.refreshing}
        onRefresh={() => void connections.refresh()}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingBottom: insets.bottom + 20,
        }}
        ListHeaderComponent={
          group ? (
            <View style={{ padding: 12 }}>
              <AgentText muted>
                {search
                  ? `${sessions.length} matching chats`
                  : `${sessions.length} chats · Most recent first`}
              </AgentText>
            </View>
          ) : null
        }
        ListEmptyComponent={
          group ? (
            <View style={{ padding: 24, gap: 8 }}>
              <AgentText title>
                {search ? "No matching chats" : "Start your first chat"}
              </AgentText>
              <AgentText muted>
                {search
                  ? "Try another search."
                  : "Choose an agent with the New chat button."}
              </AgentText>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <AgentSessionRow
            item={item}
            workspaceName={group?.name ?? "Workspace"}
          />
        )}
      />
      <AgentSheet
        visible={creating && !!group && group.targets.length > 1}
        snapPoints={[`${Math.min(70, 20 + (group?.targets.length ?? 0) * 9)}%`]}
        closeLabel="Close agent picker"
        title="Choose an agent"
        onClose={() => setCreating(false)}
      >
        <AgentText muted>{group?.name}</AgentText>
        {group?.targets.map((target) => (
          <AgentButton
            key={target.workspace.id}
            label={agentProviderMetadata(target.provider).label}
            leading={<AgentProviderIcon provider={target.provider} size={26} />}
            chevron
            onPress={() => {
              setCreating(false);
              router.push({
                pathname: "/agents/new",
                params: {
                  workspace: target.workspace.id,
                  provider: target.provider,
                  name: group.name,
                },
              });
            }}
          />
        ))}
      </AgentSheet>
    </View>
  );
}
