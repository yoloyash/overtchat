import { useMemo, useState } from "react";
import { Pressable, ScrollView, SectionList, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  agentProviderMetadata,
  type AgentProviderId,
} from "@overtchat/agent-bridge";
import { formatAgentSessionAge } from "@overtchat/shared/agent-attention";
import { AgentFeedback, AgentText } from "@/components/agents/AgentPrimitives";
import { AgentSearch, AgentSessionRow } from "@/components/agents/AgentNavigation";
import { AgentProviderIcon } from "@/components/agents/AgentProviderIcon";
import { SelectionSheet } from "@/components/ui/SelectionSheet";
import { agentSessionRowTitle, type AgentAttentionItem } from "@/lib/agents/attention";
import {
  agentSessionCreatedAt,
  agentSessionHosts,
  agentSessionProviders,
  agentSessionWorkspaces,
  searchAgentSessions,
  type AgentSessionSort,
} from "@/lib/agents/search";
import { groupWorkspaces } from "@/lib/agents/workspaces";
import { groupByDate } from "@/lib/dateGroups";
import { useAgentConnections } from "@/lib/queries/agents";
import { useTheme } from "@/lib/theme";
import { useNow } from "@/lib/useNow";

type Picker = "host" | "workspace" | "provider" | "sort";

/** The value a sheet uses for "every machine", "every folder", "every agent". */
const ALL = "";

/** What a history row says under its setup: the request, the error, or the reply. */
export function agentHistorySnippet(entry: AgentAttentionItem): string | null {
  const { session } = entry.item;
  if (session.attention) {
    return [session.attention.title, session.attention.detail].filter(Boolean).join(" · ");
  }
  if (entry.state === "failed") return session.lastTurn?.error || "The last turn failed.";
  if (session.lastTurn?.preview) return session.lastTurn.preview;
  const title = agentSessionRowTitle(entry);
  return session.firstMessage && session.firstMessage !== title ? session.firstMessage : null;
}

/**
 * Every session by date, searchable, narrowed by machine, folder and agent in
 * the same order as the new-session pickers, as on the web.
 */
export default function AgentHistoryScreen() {
  const params = useLocalSearchParams<{ focus?: string }>();
  const { colors, fonts, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const connections = useAgentConnections();
  const groups = useMemo(
    () => groupWorkspaces(connections.data ?? []),
    [connections.data],
  );
  const [query, setQuery] = useState("");
  const [host, setHost] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [provider, setProvider] = useState<AgentProviderId | null>(null);
  const [sort, setSort] = useState<AgentSessionSort>("activity");
  const [picker, setPicker] = useState<Picker | null>(null);
  const hosts = useMemo(() => agentSessionHosts(groups), [groups]);
  const workspaces = useMemo(() => agentSessionWorkspaces(groups, host), [groups, host]);
  const providers = useMemo(
    () => agentSessionProviders(groups, host, workspace),
    [groups, host, workspace],
  );
  const now = useNow(30_000);

  /** The agent filter, if it still has sessions in the narrowed scope. */
  function keptProvider(nextHost: string | null, nextWorkspace: string | null) {
    return provider && agentSessionProviders(groups, nextHost, nextWorkspace).includes(provider)
      ? provider
      : null;
  }
  // Changing the machine drops a folder or agent that has no sessions on it.
  function selectHost(next: string | null) {
    const nextWorkspace =
      workspace && agentSessionWorkspaces(groups, next).includes(workspace) ? workspace : null;
    setHost(next);
    setWorkspace(nextWorkspace);
    setProvider(keptProvider(next, nextWorkspace));
  }
  function selectWorkspace(next: string | null) {
    setWorkspace(next);
    setProvider(keptProvider(host, next));
  }

  const results = useMemo(
    () => searchAgentSessions(groups, { query, host, workspace, provider, sort }),
    [groups, query, host, workspace, provider, sort],
  );
  const sections = useMemo(
    () =>
      groupByDate(
        results.map((entry) => ({
          entry,
          updatedAt: sort === "created" ? agentSessionCreatedAt(entry) : entry.since,
        })),
        now,
      ).map((bucket) => ({ key: bucket.label, title: bucket.label, data: bucket.items })),
    [results, sort, now],
  );

  const filterPill = (
    label: string,
    active: boolean,
    icon: React.ComponentProps<typeof Ionicons>["name"] | null,
    onPress: () => void,
    accessibilityLabel: string,
  ) => (
    <Pressable
      key={accessibilityLabel}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        {
          borderRadius: radii.pill,
          backgroundColor: active ? colors.accent : pressed ? colors.muted : colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={13}
          color={active ? colors.accentForeground : colors.mutedForeground}
        />
      )}
      <Text
        numberOfLines={1}
        style={[
          styles.pillText,
          {
            color: active ? colors.accentForeground : colors.foreground,
            fontFamily: fonts.sansMedium,
          },
        ]}
      >
        {label}
      </Text>
      <Ionicons
        name="chevron-down"
        size={12}
        color={active ? colors.accentForeground : colors.mutedForeground}
      />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: "History" }} />
      <AgentSearch value={query} onChangeText={setQuery} autoFocus={params.focus === "1"} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.filters}
      >
        {hosts.length > 1 &&
          filterPill(
            host ?? "All machines",
            host !== null,
            "server-outline",
            () => setPicker("host"),
            "Filter by machine",
          )}
        {filterPill(
          workspace ?? "All folders",
          workspace !== null,
          "folder-outline",
          () => setPicker("workspace"),
          "Filter by folder",
        )}
        {filterPill(
          provider ? agentProviderMetadata(provider).label : "All agents",
          provider !== null,
          "terminal-outline",
          () => setPicker("provider"),
          "Filter by agent",
        )}
        {filterPill(
          sort === "created" ? "Created" : "Last active",
          false,
          "swap-vertical-outline",
          () => setPicker("sort"),
          "Sort sessions",
        )}
      </ScrollView>
      {(connections.isPending || connections.error) && (
        <AgentFeedback
          loading={connections.isPending}
          error={connections.error?.message}
          retry={() => void connections.refetch()}
        />
      )}
      <SectionList
        sections={sections}
        keyExtractor={({ entry }) => entry.item.session.id}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshing={connections.refreshing}
        onRefresh={() => void connections.refresh()}
        contentContainerStyle={{
          paddingHorizontal: 8,
          paddingBottom: insets.bottom + 20,
        }}
        ListEmptyComponent={
          !connections.isPending && !connections.error ? (
            <View style={{ padding: 24, gap: 8, alignItems: "center" }}>
              <Ionicons name="time-outline" size={32} color={colors.mutedForeground} />
              <AgentText title>
                {groups.length ? "No sessions match" : "No sessions yet"}
              </AgentText>
              <AgentText muted>
                {groups.length
                  ? "Try another search or widen the filters."
                  : "Sessions you start with an agent are listed here."}
              </AgentText>
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <Text
            accessibilityRole="header"
            style={[
              styles.dateLabel,
              { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
            ]}
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item: { entry, updatedAt } }) => (
          <AgentSessionRow
            entry={entry}
            context="all"
            now={now}
            time={formatAgentSessionAge(updatedAt, now)}
            detail={agentHistorySnippet(entry)}
            onPress={() =>
              router.navigate({
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
      <SelectionSheet
        title="Machine"
        visible={picker === "host"}
        value={host ?? ALL}
        options={[
          { value: ALL, label: "All machines" },
          ...hosts.map((label) => ({ value: label, label })),
        ]}
        onClose={() => setPicker(null)}
        onSelect={(value) => {
          setPicker(null);
          selectHost(value || null);
        }}
      />
      <SelectionSheet
        title="Folder"
        visible={picker === "workspace"}
        value={workspace ?? ALL}
        options={[
          { value: ALL, label: "All folders" },
          ...workspaces.map((name) => ({ value: name, label: name })),
        ]}
        onClose={() => setPicker(null)}
        onSelect={(value) => {
          setPicker(null);
          selectWorkspace(value || null);
        }}
      />
      <SelectionSheet
        title="Agent"
        visible={picker === "provider"}
        value={provider ?? ALL}
        options={[
          { value: ALL, label: "All agents" },
          ...providers.map((id) => ({
            value: id,
            label: agentProviderMetadata(id).label,
            leading: <AgentProviderIcon provider={id} size={22} />,
          })),
        ]}
        onClose={() => setPicker(null)}
        onSelect={(value) => {
          setPicker(null);
          setProvider((value || null) as AgentProviderId | null);
        }}
      />
      <SelectionSheet<AgentSessionSort>
        title="Sort by"
        visible={picker === "sort"}
        value={sort}
        options={[
          { value: "activity", label: "Last active" },
          { value: "created", label: "Created" },
        ]}
        onClose={() => setPicker(null)}
        onSelect={(value) => {
          setPicker(null);
          setSort(value);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  filters: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 32,
    paddingLeft: 10,
    paddingRight: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: { fontSize: 13, maxWidth: 180 },
  dateLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 6,
  },
});
