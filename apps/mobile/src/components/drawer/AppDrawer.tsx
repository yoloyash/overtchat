import { Ionicons } from "@expo/vector-icons";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { FlashList } from "@shopify/flash-list";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import type { DrawerContentComponentProps } from "expo-router/build/react-navigation/drawer";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { getAuthClient } from "@/lib/auth/client";
import { useChatSession } from "@/lib/chat/session";
import { groupByDate, type DateBucket } from "@/lib/dateGroups";
import {
  useChats,
  useDeleteChat,
  useMoveChat,
  useRenameChat,
  type ChatListItem,
} from "@/lib/queries/chats";
import {
  useCreateProject,
  useProjects,
  type ProjectListItem,
} from "@/lib/queries/projects";
import { useTheme } from "@/lib/theme";
import { toastError, toastSuccess } from "@/lib/toast";
import { ChatRowMenu } from "./ChatRowMenu";
import { CreateProjectSheet } from "./CreateProjectSheet";
import { MoveToProjectSheet } from "./MoveToProjectSheet";
import { RenameChatSheet } from "./RenameChatSheet";

type ListEntry =
  | { kind: "section"; key: string; label: string }
  | { kind: "project-row"; key: string; project: ProjectListItem; expanded: boolean; isActive: boolean }
  | { kind: "project-chat"; key: string; chat: ChatListItem; isActive: boolean }
  | { kind: "project-empty"; key: string }
  | { kind: "new-project"; key: string }
  | { kind: "date-header"; key: string; label: DateBucket }
  | { kind: "chat-row"; key: string; chat: ChatListItem; isActive: boolean };

function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name && name.trim()) || (email && email.trim()) || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function AppDrawer(props: DrawerContentComponentProps) {
  const { colors, radii, fonts } = useTheme();
  const {
    activeChatId,
    openChat: openSession,
    startNewChat: startSessionNewChat,
  } = useChatSession();
  const { data: chats, isPending, isFetching, error, refetch } = useChats();
  const { data: projects } = useProjects();
  const session = getAuthClient().useSession();
  const user = session.data?.user as
    | { name?: string | null; email?: string | null }
    | undefined;

  const renameMutation = useRenameChat();
  const deleteMutation = useDeleteChat();
  const moveMutation = useMoveChat();
  const createProjectMutation = useCreateProject();

  const renameSheetRef = useRef<BottomSheetModal>(null);
  const deleteSheetRef = useRef<BottomSheetModal>(null);
  const moveSheetRef = useRef<BottomSheetModal>(null);
  const createProjectSheetRef = useRef<BottomSheetModal>(null);
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    title: string | null;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatListItem | null>(null);
  const [moveTarget, setMoveTarget] = useState<ChatListItem | null>(null);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const userRefreshing = useRef(false);
  const wasFetching = useRef(false);
  useEffect(() => {
    if (wasFetching.current && !isFetching && userRefreshing.current) {
      if (error) toastError("Couldn't refresh chats", error);
      userRefreshing.current = false;
    }
    wasFetching.current = isFetching;
  }, [isFetching, error]);

  function onPullToRefresh() {
    userRefreshing.current = true;
    refetch();
  }

  // Chats grouped by project, plus the unprojected list.
  const { chatsByProject, unprojected } = useMemo(() => {
    const byProject = new Map<string, ChatListItem[]>();
    const flat: ChatListItem[] = [];
    if (chats) {
      for (const c of chats) {
        if (c.projectId) {
          const list = byProject.get(c.projectId) ?? [];
          list.push(c);
          byProject.set(c.projectId, list);
        } else {
          flat.push(c);
        }
      }
    }
    return { chatsByProject: byProject, unprojected: flat };
  }, [chats]);

  // Auto-expand the project containing the active chat (matches web's hasActiveChat).
  const activeProjectId = useMemo(() => {
    if (!activeChatId || !chats) return null;
    return chats.find((c) => c.id === activeChatId)?.projectId ?? null;
  }, [activeChatId, chats]);

  useEffect(() => {
    if (activeProjectId && !expanded[activeProjectId]) {
      setExpanded((prev) => ({ ...prev, [activeProjectId]: true }));
    }
  }, [activeProjectId, expanded]);

  const entries = useMemo<ListEntry[]>(() => {
    const out: ListEntry[] = [];
    const projectList = projects ?? [];

    if (projectList.length > 0) {
      out.push({ kind: "section", key: "s-projects", label: "Projects" });
      for (const p of projectList) {
        const isOpen = !!expanded[p.id];
        const isActive = activeProjectId === p.id;
        out.push({
          kind: "project-row",
          key: `p-${p.id}`,
          project: p,
          expanded: isOpen,
          isActive,
        });
        if (isOpen) {
          const inside = chatsByProject.get(p.id) ?? [];
          if (inside.length === 0) {
            out.push({ kind: "project-empty", key: `pe-${p.id}` });
          } else {
            for (const c of inside) {
              out.push({
                kind: "project-chat",
                key: `pc-${c.id}`,
                chat: c,
                isActive: c.id === activeChatId,
              });
            }
          }
        }
      }
    }

    out.push({ kind: "new-project", key: "new-project" });

    if (unprojected.length > 0) {
      for (const g of groupByDate(unprojected)) {
        out.push({ kind: "date-header", key: `dh-${g.label}`, label: g.label });
        for (const c of g.items) {
          out.push({
            kind: "chat-row",
            key: c.id,
            chat: c,
            isActive: c.id === activeChatId,
          });
        }
      }
    }

    return out;
  }, [projects, expanded, chatsByProject, unprojected, activeChatId, activeProjectId]);

  function toggleProject(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function openProject(id: string) {
    props.navigation.closeDrawer();
    router.push(`/projects/${id}`);
  }

  function openChat(item: ChatListItem) {
    openSession(item.id);
    props.navigation.closeDrawer();
  }

  function startNewChatHere() {
    startSessionNewChat(null);
    props.navigation.closeDrawer();
  }

  function startNewChatInProject(projectId: string) {
    startSessionNewChat(projectId);
    props.navigation.closeDrawer();
  }

  function openRename(item: ChatListItem) {
    setRenameTarget({ id: item.id, title: item.title });
    renameSheetRef.current?.present();
  }

  function openMove(item: ChatListItem) {
    setMoveTarget(item);
    moveSheetRef.current?.present();
  }

  function openDeleteConfirm(item: ChatListItem) {
    setDeleteTarget(item);
    deleteSheetRef.current?.present();
  }

  function submitRename(id: string, title: string) {
    renameMutation.mutate(
      { id, title },
      {
        onSuccess: () => toastSuccess("Renamed"),
        onError: (e) => toastError("Couldn't rename chat", e),
      },
    );
  }

  function submitMove(projectId: string | null) {
    if (!moveTarget) return;
    if (moveTarget.projectId === projectId) return;
    const id = moveTarget.id;
    moveMutation.mutate(
      { id, projectId },
      {
        onSuccess: () => {
          if (projectId) {
            // Reveal the chat in its new home.
            setExpanded((prev) => ({ ...prev, [projectId]: true }));
          }
        },
        onError: (e) => toastError("Couldn't move chat", e),
      },
    );
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    deleteMutation.mutate(target.id, {
      onSuccess: () => {
        if (activeChatId === target.id) {
          startSessionNewChat(null);
        }
        toastSuccess("Chat deleted");
      },
      onError: (e) => toastError("Couldn't delete chat", e),
    });
  }

  function submitCreateProject(name: string) {
    createProjectMutation.mutate(
      { name },
      {
        onSuccess: ({ id }) => {
          createProjectSheetRef.current?.dismiss();
          props.navigation.closeDrawer();
          router.push(`/projects/${id}`);
        },
        onError: (e) => toastError("Couldn't create project", e),
      },
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.root, { backgroundColor: colors.card }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New chat"
          onPress={startNewChatHere}
          style={({ pressed }) => [
            styles.newChat,
            {
              backgroundColor: pressed ? colors.accent : "transparent",
              borderRadius: radii.md,
            },
          ]}
        >
          <Ionicons name="create-outline" size={20} color={colors.foreground} />
          <Text
            style={[
              styles.newChatText,
              { color: colors.foreground, fontFamily: fonts.sansSemiBold },
            ]}
          >
            New chat
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search chats"
          onPress={() => {
            props.navigation.closeDrawer();
            router.push("/search");
          }}
          hitSlop={8}
          style={({ pressed }) => [
            styles.searchBtn,
            {
              backgroundColor: pressed ? colors.accent : "transparent",
              borderRadius: radii.pill,
            },
          ]}
        >
          <Ionicons
            name="search-outline"
            size={20}
            color={colors.foreground}
          />
        </Pressable>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.list}>
        {isPending ? (
          <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 24 }} />
        ) : error ? (
          <Text
            style={[
              styles.empty,
              { color: colors.destructive, fontFamily: fonts.sansRegular },
            ]}
          >
            Couldn't load chats
          </Text>
        ) : entries.length === 1 ? (
          // Only the new-project entry — nothing else exists yet.
          <View>
            <NewProjectButton onPress={() => createProjectSheetRef.current?.present()} />
            <Text
              style={[
                styles.empty,
                { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
              ]}
            >
              No conversations yet
            </Text>
          </View>
        ) : (
          <FlashList<ListEntry>
            data={entries}
            keyExtractor={(e) => e.key}
            getItemType={(e) => e.kind}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshing={isFetching && !isPending}
            onRefresh={onPullToRefresh}
            renderItem={({ item: entry }) => {
              switch (entry.kind) {
                case "section":
                  return (
                    <Text
                      style={[
                        styles.sectionLabel,
                        {
                          color: colors.mutedForeground,
                          fontFamily: fonts.sansMedium,
                        },
                      ]}
                    >
                      {entry.label}
                    </Text>
                  );
                case "project-row":
                  return (
                    <ProjectRow
                      project={entry.project}
                      expanded={entry.expanded}
                      isActive={entry.isActive}
                      onToggle={() => toggleProject(entry.project.id)}
                      onOpen={() => openProject(entry.project.id)}
                      onNewChat={() => startNewChatInProject(entry.project.id)}
                    />
                  );
                case "project-chat":
                  return (
                    <ChatRow
                      item={entry.chat}
                      isActive={entry.isActive}
                      indented
                      onTap={openChat}
                      onRename={openRename}
                      onMove={openMove}
                      onDelete={openDeleteConfirm}
                    />
                  );
                case "project-empty":
                  return (
                    <Text
                      style={[
                        styles.projectEmpty,
                        {
                          color: colors.mutedForeground,
                          fontFamily: fonts.sansRegular,
                        },
                      ]}
                    >
                      No chats yet
                    </Text>
                  );
                case "new-project":
                  return (
                    <NewProjectButton
                      onPress={() => createProjectSheetRef.current?.present()}
                    />
                  );
                case "date-header":
                  return (
                    <Text
                      style={[
                        styles.groupLabel,
                        {
                          color: colors.mutedForeground,
                          fontFamily: fonts.sansMedium,
                        },
                      ]}
                    >
                      {entry.label}
                    </Text>
                  );
                case "chat-row":
                  return (
                    <ChatRow
                      item={entry.chat}
                      isActive={entry.isActive}
                      onTap={openChat}
                      onRename={openRename}
                      onMove={openMove}
                      onDelete={openDeleteConfirm}
                    />
                  );
              }
            }}
          />
        )}
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <View
          style={[
            styles.avatar,
            { backgroundColor: colors.primary, borderRadius: radii.pill },
          ]}
        >
          <Text
            style={[
              styles.avatarText,
              { color: colors.primaryForeground, fontFamily: fonts.sansSemiBold },
            ]}
          >
            {initialsOf(user?.name, user?.email)}
          </Text>
        </View>
        <View style={styles.userInfo}>
          {user?.name ? (
            <Text
              numberOfLines={1}
              style={[
                styles.userName,
                { color: colors.foreground, fontFamily: fonts.sansSemiBold },
              ]}
            >
              {user.name}
            </Text>
          ) : null}
          <Text
            numberOfLines={1}
            style={[
              styles.userEmail,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {user?.email ?? "Signed in"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => {
            props.navigation.closeDrawer();
            router.push("/settings");
          }}
          hitSlop={10}
          style={({ pressed }) => [styles.gearBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="settings-outline" size={20} color={colors.foreground} />
        </Pressable>
      </View>

      <RenameChatSheet
        ref={renameSheetRef}
        chatId={renameTarget?.id ?? null}
        initialTitle={renameTarget?.title ?? null}
        onSubmit={submitRename}
      />
      <ConfirmSheet
        ref={deleteSheetRef}
        title="Delete chat?"
        message={
          deleteTarget?.title?.trim()
            ? `"${deleteTarget.title.trim()}" will be permanently deleted.`
            : "This conversation will be permanently deleted."
        }
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
      <MoveToProjectSheet
        ref={moveSheetRef}
        projects={projects ?? []}
        currentProjectId={moveTarget?.projectId ?? null}
        onSelect={submitMove}
      />
      <CreateProjectSheet
        ref={createProjectSheetRef}
        submitting={createProjectMutation.isPending}
        onSubmit={submitCreateProject}
      />
    </SafeAreaView>
  );
}

function NewProjectButton({ onPress }: { onPress: () => void }) {
  const { colors, radii, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="New project"
      onPress={onPress}
      style={({ pressed }) => [
        styles.newProject,
        {
          backgroundColor: pressed ? colors.accent : "transparent",
          borderRadius: radii.md,
        },
      ]}
    >
      <Ionicons name="add-circle-outline" size={18} color={colors.mutedForeground} />
      <Text
        style={[
          styles.newProjectText,
          { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
        ]}
      >
        New project
      </Text>
    </Pressable>
  );
}

function ProjectRow({
  project,
  expanded,
  isActive,
  onToggle,
  onOpen,
  onNewChat,
}: {
  project: ProjectListItem;
  expanded: boolean;
  isActive: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onNewChat: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  return (
    <View style={styles.projectRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Collapse project" : "Expand project"}
        onPress={onToggle}
        hitSlop={6}
        style={({ pressed }) => [
          styles.chevronBtn,
          {
            backgroundColor: pressed ? colors.muted : "transparent",
            borderRadius: radii.sm,
          },
        ]}
      >
        <Ionicons
          name={expanded ? "chevron-down" : "chevron-forward"}
          size={14}
          color={colors.mutedForeground}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open project ${project.name}`}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.projectName,
          {
            backgroundColor: isActive
              ? colors.accent
              : pressed
                ? colors.muted
                : "transparent",
            borderRadius: radii.md,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.projectNameText,
            {
              color: isActive ? colors.accentForeground : colors.foreground,
              fontFamily: fonts.sansRegular,
            },
          ]}
        >
          {project.name}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`New chat in ${project.name}`}
        onPress={onNewChat}
        hitSlop={8}
        style={({ pressed }) => [
          styles.projectAddBtn,
          {
            backgroundColor: pressed ? colors.muted : "transparent",
            borderRadius: radii.sm,
          },
        ]}
      >
        <Ionicons name="add" size={16} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

function ChatRow({
  item,
  isActive,
  indented = false,
  onTap,
  onRename,
  onMove,
  onDelete,
}: {
  item: ChatListItem;
  isActive: boolean;
  indented?: boolean;
  onTap: (item: ChatListItem) => void;
  onRename: (item: ChatListItem) => void;
  onMove: (item: ChatListItem) => void;
  onDelete: (item: ChatListItem) => void;
}) {
  const { colors, radii, fonts } = useTheme();
  const anchorRef = useRef<View>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <View ref={anchorRef} collapsable={false}>
      <Pressable
        onPress={() => onTap(item)}
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          setMenuOpen(true);
        }}
        delayLongPress={300}
        style={({ pressed }) => [
          styles.row,
          indented && styles.rowIndented,
          {
            backgroundColor: isActive
              ? colors.accent
              : pressed
                ? colors.muted
                : "transparent",
            borderRadius: radii.md,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.rowText,
            {
              color: isActive ? colors.accentForeground : colors.foreground,
              fontFamily: fonts.sansRegular,
            },
          ]}
        >
          {item.title?.trim() || "Untitled"}
        </Text>
      </Pressable>
      <ChatRowMenu
        from={anchorRef}
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSelect={(action) => {
          if (action === "rename") onRename(item);
          else if (action === "move") onMove(item);
          else onDelete(item);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  newChat: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  newChatText: { fontSize: 15 },
  searchBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 12 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 8, paddingBottom: 16 },
  sectionLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 6,
  },
  groupLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 6,
  },
  projectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingRight: 4,
  },
  chevronBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
  },
  projectName: { flex: 1, paddingHorizontal: 6, paddingVertical: 8 },
  projectNameText: { fontSize: 14 },
  projectAddBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  projectEmpty: {
    fontSize: 12,
    paddingHorizontal: 28,
    paddingVertical: 6,
  },
  newProject: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
  newProjectText: { fontSize: 14 },
  row: { paddingHorizontal: 12, paddingVertical: 10 },
  rowIndented: { marginLeft: 24 },
  rowText: { fontSize: 14 },
  empty: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 24, textAlign: "center" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 13 },
  userInfo: { flex: 1 },
  userName: { fontSize: 14 },
  userEmail: { fontSize: 12 },
  gearBtn: { padding: 8 },
});
