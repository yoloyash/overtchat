import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import * as Burnt from "burnt";
import { router } from "expo-router";
import type { DrawerContentComponentProps } from "expo-router/build/react-navigation/drawer";
import { useEffect, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthClient } from "@/lib/auth/client";
import { useChatSession } from "@/lib/chat/session";
import { groupByDate, type DateBucket } from "@/lib/dateGroups";
import { useChats, type ChatListItem } from "@/lib/queries/chats";
import { useTheme } from "@/lib/theme";

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

  const wasFetching = useRef(false);
  useEffect(() => {
    if (wasFetching.current && !isFetching && error) {
      Burnt.toast({
        title: "Couldn't refresh chats",
        message: error instanceof Error ? error.message : undefined,
        preset: "error",
      });
    }
    wasFetching.current = isFetching;
  }, [isFetching, error]);

  const entries = useMemo<ListEntry[]>(() => {
    if (!chats) return [];
    const groups = groupByDate(chats);
    const out: ListEntry[] = [];
    for (const g of groups) {
      out.push({ kind: "header", key: `h-${g.label}`, label: g.label });
      for (const item of g.items) {
        out.push({ kind: "row", key: item.id, item });
      }
    }
    return out;
  }, [chats]);

  function onTapChat(item: ChatListItem) {
    setActiveChatId(item.id);
    props.navigation.closeDrawer();
  }

  function onNewChat() {
    setActiveChatId(null);
    bumpNewChat();
    props.navigation.closeDrawer();
  }

  function onSettings() {
    props.navigation.closeDrawer();
    router.push("/settings");
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.root, { backgroundColor: colors.card }]}>
      <Pressable
        accessibilityRole="button"
        onPress={onNewChat}
        style={({ pressed }) => [
          styles.newChat,
          { backgroundColor: pressed ? colors.accent : "transparent" },
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
            onRefresh={() => {
              refetch();
            }}
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
              const isActive = entry.item.id === activeChatId;
              return (
                <Pressable
                  onPress={() => onTapChat(entry.item)}
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
                        color: isActive
                          ? colors.accentForeground
                          : colors.foreground,
                        fontFamily: fonts.sansRegular,
                      },
                    ]}
                  >
                    {entry.item.title?.trim() || "Untitled"}
                  </Text>
                </Pressable>
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
          onPress={onSettings}
          hitSlop={10}
          style={({ pressed }) => [styles.gearBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="settings-outline" size={20} color={colors.foreground} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  newChat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  newChatText: { fontSize: 15 },
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
