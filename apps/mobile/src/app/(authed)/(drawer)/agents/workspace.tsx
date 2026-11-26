import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  agentSessionState,
  agentSessionStateSince,
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
  workspaceNewSessionParams,
} from "@/lib/agents/workspaces";
import { useTheme } from "@/lib/theme";
import { useNow } from "@/lib/useNow";

/** One folder: where it is, its branch, and every session in it. */
export default function AgentWorkspaceScreen() {
  const { t } = useTranslation();
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
        ? matchingSessions(group, search).map((item) => {
            const state = agentSessionState(item.session);
            return {
              item,
              group,
              state,
              since: agentSessionStateSince(item.session, state),
            };
          })
        : [],
    [group, search],
  );
  const working = sessions.some(({ state }) => state === "working");
  const now = useNow(working ? 1_000 : 30_000);
  function startSession() {
    if (!group) return;
    router.navigate({ pathname: "/agents", params: workspaceNewSessionParams(group) });
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: group?.name ?? params.name ?? t("agents.setup.workspace"),
          headerRight: () => (
            <AgentButton
              label={t("agents.session.newSession")}
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
        placeholder={t("agents.mobile.workspace.searchPlaceholder")}
      />
      {(connections.isPending || connections.error) && (
        <AgentFeedback
          loading={connections.isPending}
          error={connections.error?.message}
          retry={() => void connections.refetch()}
        />
      )}
      {!connections.isPending && !connections.error && !group && (
        <AgentFeedback error={t("agents.mobile.errors.workspaceUnavailableSync")} />
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
                  ? t("agents.mobile.workspace.matchingSessions", {
                      count: sessions.length,
                    })
                  : t("agents.mobile.workspace.sessionsMostRecent", {
                      count: sessions.length,
                    })}
              </AgentText>
            </View>
          ) : null
        }
        ListEmptyComponent={
          group ? (
            <View style={{ padding: 24, gap: 8 }}>
              <AgentText title>
                {search
                  ? t("agents.mobile.workspace.noMatchingSessions")
                  : t("agents.mobile.workspace.startFirstSession")}
              </AgentText>
              <AgentText muted>
                {search
                  ? t("agents.mobile.workspace.tryAnotherSearch")
                  : t("agents.mobile.workspace.startFirstSessionHint")}
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
