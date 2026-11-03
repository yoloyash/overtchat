import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  agentAttentionSections,
  agentSessionCanToggleRead,
  agentSessionHasUnseenTurn,
  type AgentSessionState,
} from "@overtchat/shared/agent-attention";
import {
  AgentMenu,
  type AgentMenuItem,
  type AgentMenuSection,
} from "@/components/agents/AgentMenu";
import { AgentSessionRow } from "@/components/agents/AgentNavigation";
import { AgentSessionStatusIcon } from "@/components/agents/AgentSessionStatus";
import { useMeasuredPopoverAnchor } from "@/components/ui/useMeasuredPopoverAnchor";
import {
  agentDrawerEntries,
  type AgentAttentionItem,
  type AgentDrawerEntry,
  type AgentDrawerGrouping,
} from "@/lib/agents/attention";
import {
  agentHostLabel,
  groupWorkspaces,
  type WorkspaceGroup,
} from "@/lib/agents/workspaces";
import {
  useAgentConnections,
  useSetAgentSessionRead,
  useSyncAgentWorkspaces,
} from "@/lib/queries/agents";
import { useTheme } from "@/lib/theme";
import { toastError, toastSuccess } from "@/lib/toast";
import { useNow } from "@/lib/useNow";

// Kept per device, like the web sidebar's grouping and folded groups.
const GROUPING_KEY = "overtchat.drawer.agentGrouping";
const COLLAPSED_KEY = "overtchat.drawer.agentGroupsCollapsed";

function readGrouping(): AgentDrawerGrouping {
  return SecureStore.getItem(GROUPING_KEY) === "workspace" ? "workspace" : "status";
}

function readCollapsed(): string[] {
  try {
    const value = JSON.parse(SecureStore.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

/** The session an agent screen shows, or null elsewhere. */
export function agentSessionIdForPath(pathname: string): string | null {
  const match = /^\/agent\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * The Agents half of the drawer: a new session, history, then every session
 * grouped by what it needs from you, or by folder.
 */
export function AgentsDrawer({
  connections,
  pathname,
  onNavigate,
}: {
  connections: ReturnType<typeof useAgentConnections>;
  pathname: string;
  onNavigate: () => void;
}) {
  const { colors, fonts, radii } = useTheme();
  const [grouping, setGroupingState] = useState<AgentDrawerGrouping>(readGrouping);
  const [collapsed, setCollapsedState] = useState<string[]>(readCollapsed);
  const [showAllDone, setShowAllDone] = useState(false);
  const activeSessionId = agentSessionIdForPath(pathname);
  const groups = useMemo(
    () => groupWorkspaces(connections.data ?? []),
    [connections.data],
  );
  const entries = useMemo(
    () =>
      agentDrawerEntries(groups, {
        grouping,
        collapsed,
        showAllDone,
        activeSessionId,
      }),
    [groups, grouping, collapsed, showAllDone, activeSessionId],
  );
  const working = useMemo(
    () => groups.some((group) => group.sessions.some(({ session }) => session.runtimeStatus === "running")),
    [groups],
  );
  // Running times tick each second; ages only need the minute.
  const now = useNow(working ? 1_000 : 30_000);
  const setRead = useSetAgentSessionRead();
  const sync = useSyncAgentWorkspaces();

  function setGrouping(next: AgentDrawerGrouping) {
    SecureStore.setItem(GROUPING_KEY, next);
    setGroupingState(next);
  }
  function toggleCollapsed(key: string) {
    const next = collapsed.includes(key)
      ? collapsed.filter((item) => item !== key)
      : [...collapsed, key];
    SecureStore.setItem(COLLAPSED_KEY, JSON.stringify(next));
    setCollapsedState(next);
  }
  function openSession(entry: AgentAttentionItem) {
    onNavigate();
    router.navigate({
      pathname: "/agent/[id]",
      params: {
        id: entry.item.session.id,
        workspace: entry.item.workspaceId,
        name: entry.group.name,
      },
    });
  }
  function openWorkspace(group: WorkspaceGroup) {
    onNavigate();
    router.push({
      pathname: "/agents/workspace",
      params: { workspace: group.targets[0]!.workspace.id, name: group.name },
    });
  }
  function startSession(group?: WorkspaceGroup) {
    onNavigate();
    if (!group) {
      router.navigate("/agents");
      return;
    }
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
  function markAllRead() {
    const { ready } = agentAttentionSections(groups);
    for (const entry of ready) {
      setRead.mutate({ sessionId: entry.item.session.id, read: true });
    }
  }
  function refresh() {
    sync.mutate(undefined, {
      onSuccess: (result) => {
        if (result.failures.length) {
          toastError(
            "Some workspaces couldn't refresh",
            new Error(result.failures.map((failure) => failure.message).join("\n")),
          );
        } else {
          toastSuccess("Sessions refreshed");
        }
      },
      onError: (error) => toastError("Couldn't refresh sessions", error),
    });
  }

  const readyCount = useMemo(
    () => agentAttentionSections(groups).ready.length,
    [groups],
  );
  const listActions: AgentMenuItem[] = [];
  if (readyCount > 0) {
    listActions.push({
      key: "read-all",
      label: "Mark all as read",
      icon: "checkmark-done-outline",
      onSelect: markAllRead,
    });
  }
  listActions.push(
    {
      key: "add-workspace",
      label: "Add workspace…",
      icon: "add-circle-outline",
      onSelect: () => {
        onNavigate();
        router.push("/settings/connections");
      },
    },
    {
      key: "refresh",
      label: "Refresh sessions",
      icon: "refresh-outline",
      disabled: sync.isPending,
      onSelect: refresh,
    },
  );
  const listOptions: AgentMenuSection[] = [
    {
      items: [
        grouping === "status"
          ? {
              key: "group-workspace",
              label: "Group by workspace",
              icon: "folder-outline",
              onSelect: () => setGrouping("workspace"),
            }
          : {
              key: "group-status",
              label: "Group by status",
              icon: "pulse-outline",
              onSelect: () => setGrouping("status"),
            },
      ],
    },
    { items: listActions },
  ];

  return (
    <>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New agent"
          onPress={() => startSession()}
          style={({ pressed }) => [
            styles.newAgent,
            {
              backgroundColor: pressed ? colors.accent : "transparent",
              borderRadius: radii.md,
            },
          ]}
        >
          <Ionicons name="create-outline" size={20} color={colors.foreground} />
          <Text
            style={[
              styles.newAgentText,
              { color: colors.foreground, fontFamily: fonts.sansSemiBold },
            ]}
          >
            New agent
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search agent sessions"
          onPress={() => {
            onNavigate();
            router.push({ pathname: "/agents/history", params: { focus: "1" } });
          }}
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconButton,
            {
              backgroundColor: pressed ? colors.accent : "transparent",
              borderRadius: radii.pill,
            },
          ]}
        >
          <Ionicons name="search-outline" size={20} color={colors.foreground} />
        </Pressable>
      </View>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View style={styles.list}>
        <FlashList<AgentDrawerEntry>
          data={connections.isPending || connections.error ? [] : entries}
          keyExtractor={(entry) => entry.key}
          getItemType={(entry) => entry.kind}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshing={connections.refreshing}
          onRefresh={() => void connections.refresh()}
          ListHeaderComponent={
            <ListLabel
              label={grouping === "workspace" ? "Workspaces" : "Sessions"}
              options={listOptions}
            />
          }
          ListEmptyComponent={
            connections.isPending ? (
              <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 24 }} />
            ) : connections.error ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading agent sessions"
                onPress={() => void connections.refetch()}
                style={{ padding: 16 }}
              >
                <Text
                  style={[
                    styles.empty,
                    { color: colors.destructive, fontFamily: fonts.sansRegular },
                  ]}
                >
                  Couldn't load agent sessions. Tap to retry.
                </Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item: entry }) => {
            switch (entry.kind) {
              case "group":
                return (
                  <GroupHeader
                    label={entry.label}
                    state={entry.state}
                    collapsed={entry.collapsed}
                    onToggle={() => toggleCollapsed(entry.key)}
                  />
                );
              case "workspace":
                return (
                  <WorkspaceHeader
                    group={entry.group}
                    state={entry.state}
                    collapsed={entry.collapsed}
                    onToggle={() => toggleCollapsed(entry.key)}
                    onOpen={() => openWorkspace(entry.group)}
                    onNewSession={() => startSession(entry.group)}
                  />
                );
              case "session":
                return (
                  <SessionRow
                    entry={entry.entry}
                    context={entry.context}
                    now={now}
                    selected={entry.entry.item.session.id === activeSessionId}
                    onOpen={() => openSession(entry.entry)}
                    onOpenWorkspace={() => openWorkspace(entry.entry.group)}
                    onSetRead={(read) =>
                      setRead.mutate({ sessionId: entry.entry.item.session.id, read })
                    }
                  />
                );
              case "more":
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      entry.expanded ? "Show fewer sessions" : `Show ${entry.hidden} more sessions`
                    }
                    accessibilityState={{ expanded: entry.expanded }}
                    onPress={() => setShowAllDone((current) => !current)}
                    style={({ pressed }) => [
                      styles.more,
                      {
                        borderRadius: radii.md,
                        backgroundColor: pressed ? colors.muted : "transparent",
                      },
                    ]}
                  >
                    <Ionicons
                      name={entry.expanded ? "chevron-up" : "chevron-down"}
                      size={14}
                      color={colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.moreText,
                        { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                      ]}
                    >
                      {entry.expanded ? "Show less" : `Show ${entry.hidden} more`}
                    </Text>
                  </Pressable>
                );
              case "empty":
                return (
                  <Text
                    style={[
                      styles.emptyRow,
                      { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                    ]}
                  >
                    {entry.text}
                  </Text>
                );
            }
          }}
        />
      </View>
    </>
  );
}

/** The list's heading, with its options behind a kebab as on the web. */
function ListLabel({
  label,
  options,
}: {
  label: string;
  options: AgentMenuSection[];
}) {
  const { colors, fonts, radii } = useTheme();
  const menu = useMeasuredPopoverAnchor();
  return (
    <View style={styles.listLabel}>
      <Text
        accessibilityRole="header"
        style={[
          styles.sectionLabel,
          { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
        ]}
      >
        {label}
      </Text>
      <View ref={menu.anchorRef} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Agent list options"
          onPress={menu.open}
          hitSlop={8}
          style={({ pressed }) => [
            styles.optionsButton,
            {
              borderRadius: radii.sm,
              backgroundColor: pressed ? colors.muted : "transparent",
            },
          ]}
        >
          <Ionicons name="ellipsis-horizontal" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>
      <AgentMenu
        from={menu.anchorRect}
        visible={menu.visible}
        title="List options"
        sections={options}
        onClose={menu.close}
      />
    </View>
  );
}

/** A status group's heading; it wears the mark its rows do, and folds. */
function GroupHeader({
  label,
  state,
  collapsed,
  onToggle,
}: {
  label: string;
  state: AgentSessionState;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { colors, fonts, radii } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${label}`}
      accessibilityState={{ expanded: !collapsed }}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.groupHeader,
        {
          borderRadius: radii.md,
          backgroundColor: pressed ? colors.muted : "transparent",
        },
      ]}
    >
      <View style={styles.groupMark}>
        {collapsed ? (
          <Ionicons name="chevron-forward" size={13} color={colors.mutedForeground} />
        ) : (
          <AgentSessionStatusIcon state={state} />
        )}
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.groupLabel,
          { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A folder's heading in the workspace grouping. Closed, it shows the most
 * urgent state of its sessions; a long press opens the folder's own screen.
 */
function WorkspaceHeader({
  group,
  state,
  collapsed,
  onToggle,
  onOpen,
  onNewSession,
}: {
  group: WorkspaceGroup;
  state: AgentSessionState;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onNewSession: () => void;
}) {
  const { colors, fonts, radii } = useTheme();
  const count = group.sessions.length;
  return (
    <View style={styles.workspaceRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${group.name}`}
        accessibilityState={{ expanded: !collapsed }}
        accessibilityHint="Long press to open the workspace"
        onPress={onToggle}
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          onOpen();
        }}
        delayLongPress={300}
        style={({ pressed }) => [
          styles.workspaceHeader,
          {
            borderRadius: radii.md,
            backgroundColor: pressed ? colors.muted : "transparent",
          },
        ]}
      >
        <View style={styles.groupMark}>
          {collapsed && state !== "idle" ? (
            <AgentSessionStatusIcon state={state} />
          ) : (
            <Ionicons
              name={collapsed ? "chevron-forward" : "chevron-down"}
              size={13}
              color={colors.mutedForeground}
            />
          )}
        </View>
        <View style={styles.workspaceBody}>
          <Text
            numberOfLines={1}
            style={[
              styles.workspaceName,
              { color: colors.foreground, fontFamily: fonts.sansMedium },
            ]}
          >
            {group.name}
          </Text>
          <Text
            numberOfLines={1}
            style={[
              styles.workspaceMeta,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {agentHostLabel(group.host)} · {count} {count === 1 ? "session" : "sessions"}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`New session in ${group.name}`}
        onPress={onNewSession}
        hitSlop={8}
        style={({ pressed }) => [
          styles.workspaceAdd,
          {
            borderRadius: radii.sm,
            backgroundColor: pressed ? colors.muted : "transparent",
          },
        ]}
      >
        <Ionicons name="add" size={18} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

/** A session row whose long press offers read state and its workspace. */
function SessionRow({
  entry,
  context,
  now,
  selected,
  onOpen,
  onOpenWorkspace,
  onSetRead,
}: {
  entry: AgentAttentionItem;
  context: "all" | "workspace";
  now: number;
  selected: boolean;
  onOpen: () => void;
  onOpenWorkspace: () => void;
  onSetRead: (read: boolean) => void;
}) {
  const menu = useMeasuredPopoverAnchor();
  const { session } = entry.item;
  const unseen = agentSessionHasUnseenTurn(session);
  const items: AgentMenuItem[] = [];
  if (agentSessionCanToggleRead(session, entry.state)) {
    items.push({
      key: "read",
      label: unseen ? "Mark as read" : "Mark as unread",
      icon: unseen ? "checkmark-outline" : "ellipse-outline",
      onSelect: () => onSetRead(unseen),
    });
  }
  items.push({
    key: "workspace",
    label: "Open workspace",
    icon: "folder-open-outline",
    onSelect: onOpenWorkspace,
  });
  const sections: AgentMenuSection[] = [{ items }];
  return (
    <View ref={menu.anchorRef} collapsable={false}>
      <AgentSessionRow
        entry={entry}
        context={context}
        now={now}
        selected={selected}
        onPress={onOpen}
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          menu.open();
        }}
      />
      <AgentMenu
        from={menu.anchorRect}
        visible={menu.visible}
        title={entry.item.session.name || entry.item.session.firstMessage || "New session"}
        sections={sections}
        onClose={menu.close}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  newAgent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  newAgentText: { fontSize: 15 },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 12 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 8, paddingBottom: 16 },
  listLabel: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    paddingRight: 4,
    paddingTop: 12,
    paddingBottom: 2,
    gap: 8,
  },
  sectionLabel: {
    flex: 1,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  optionsButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 40,
    paddingLeft: 10,
    paddingRight: 12,
    marginTop: 6,
  },
  groupMark: { width: 14, alignItems: "center", justifyContent: "center" },
  groupLabel: { flex: 1, fontSize: 13 },
  workspaceRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  workspaceHeader: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 6,
  },
  workspaceBody: { flex: 1, minWidth: 0, gap: 2 },
  workspaceName: { fontSize: 14, lineHeight: 18 },
  workspaceMeta: { fontSize: 12, lineHeight: 16 },
  workspaceAdd: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  more: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 40,
    paddingLeft: 10,
    paddingRight: 12,
  },
  moreText: { fontSize: 13 },
  empty: { fontSize: 13, textAlign: "center" },
  emptyRow: { fontSize: 13, paddingHorizontal: 12, paddingVertical: 8 },
});
