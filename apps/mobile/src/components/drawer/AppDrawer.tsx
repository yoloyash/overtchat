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
  useRenameChat,
  type ChatListItem,
} from "@/lib/queries/chats";
import { useTheme } from "@/lib/theme";
import { toastError, toastSuccess } from "@/lib/toast";
import { ChatRowMenu } from "./ChatRowMenu";
import { RenameChatSheet } from "./RenameChatSheet";

type ListEntry =
  | { kind: "header"; key: string; label: DateBucket }
  | { kind: "row"; key: string; item: ChatListItem };

function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name && name.trim()) || (email && email.trim()) || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function AppDrawer(props: DrawerContentComponentProps) {
  const { colors, radii, fonts } = useTheme();
  const { activeChatId, setActiveChatId, bumpNewChat } = useChatSession();
  const { data: chats, isPending, isFetching, error, refetch } = useChats();
  const session = getAuthClient().useSession();
  const user = session.data?.user as
    | { name?: string | null; email?: string | null }
    | undefined;

  const renameMutation = useRenameChat();
  const deleteMutation = useDeleteChat();

  const renameSheetRef = useRef<BottomSheetModal>(null);
  const deleteSheetRef = useRef<BottomSheetModal>(null);
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    title: string | null;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatListItem | null>(null);

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

  const entries = useMemo<ListEntry[]>(() => {
    if (!chats) return [];
    const out: ListEntry[] = [];
    for (const g of groupByDate(chats)) {
      out.push({ kind: "header", key: `h-${g.label}`, label: g.label });
      for (const item of g.items) {
        out.push({ kind: "row", key: item.id, item });
      }
    }
    return out;
  }, [chats]);

  function openChat(item: ChatListItem) {
    setActiveChatId(item.id);
    props.navigation.closeDrawer();
  }

  function startNewChat() {
    setActiveChatId(null);
    bumpNewChat();
    props.navigation.closeDrawer();
  }

  function openRename(item: ChatListItem) {
    setRenameTarget({ id: item.id, title: item.title });
    renameSheetRef.current?.present();
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

  function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    deleteMutation.mutate(target.id, {
      onSuccess: () => {
        if (activeChatId === target.id) {
          setActiveChatId(null);
          bumpNewChat();
        }
        toastSuccess("Chat deleted");
      },
      onError: (e) => toastError("Couldn't delete chat", e),
    });
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.root, { backgroundColor: colors.card }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New chat"
          onPress={startNewChat}
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
        ) : entries.length === 0 ? (
          <Text
            style={[
              styles.empty,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            No conversations yet
          </Text>
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
              if (entry.kind === "header") {
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
              }
              return (
                <ChatRow
                  item={entry.item}
                  isActive={entry.item.id === activeChatId}
                  onTap={openChat}
                  onRename={openRename}
                  onDelete={openDeleteConfirm}
                />
              );
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
    </SafeAreaView>
  );
}

function ChatRow({
  item,
  isActive,
  onTap,
  onRename,
  onDelete,
}: {
  item: ChatListItem;
  isActive: boolean;
  onTap: (item: ChatListItem) => void;
  onRename: (item: ChatListItem) => void;
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
  groupLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 6,
  },
  row: { paddingHorizontal: 12, paddingVertical: 10 },
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
