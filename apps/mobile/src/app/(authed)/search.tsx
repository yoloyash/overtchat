import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import type { SearchHit } from "@overtchat/shared";
import { router, Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useChatSession } from "@/lib/chat/session";
import { useChatsSearch } from "@/lib/queries/search";
import { parseSnippet } from "@/lib/search/highlight";
import { useTheme, type Theme } from "@/lib/theme";

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function SearchScreen() {
  const theme = useTheme();
  const { colors, radii, fonts } = theme;
  const { setActiveChatId } = useChatSession();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 150);

  const { data, isFetching, error } = useChatsSearch(debounced);
  const hits = data ?? [];
  const trimmed = debounced.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < 2;
  const hasQuery = trimmed.length >= 2;

  function pickHit(hit: SearchHit) {
    setActiveChatId(hit.chatId);
    router.replace("/chat");
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: () => (
            <Text
              style={{
                color: colors.foreground,
                fontFamily: fonts.serifSemiBold,
                fontSize: 18,
              }}
            >
              Search
            </Text>
          ),
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          headerBackTitle: "Back",
        }}
      />
      <SafeAreaView
        edges={["bottom", "left", "right"]}
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: colors.muted,
              borderRadius: radii.md,
            },
          ]}
        >
          <Ionicons
            name="search-outline"
            size={18}
            color={colors.mutedForeground}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search chats…"
            placeholderTextColor={colors.mutedForeground}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={[
              styles.searchInput,
              { color: colors.foreground, fontFamily: fonts.sansRegular },
            ]}
          />
          {query.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery("")}
              hitSlop={8}
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.mutedForeground}
              />
            </Pressable>
          )}
        </View>

        <View style={styles.results}>
          {!hasQuery ? (
            <Text
              style={[
                styles.hint,
                { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
              ]}
            >
              {tooShort
                ? "Type a few more characters."
                : "Search across your chats by content or title."}
            </Text>
          ) : isFetching && hits.length === 0 ? (
            <ActivityIndicator
              color={colors.mutedForeground}
              style={{ marginTop: 32 }}
            />
          ) : error ? (
            <Text
              style={[
                styles.hint,
                {
                  color: colors.destructive,
                  fontFamily: fonts.sansRegular,
                },
              ]}
            >
              {error instanceof Error ? error.message : "Search failed"}
            </Text>
          ) : hits.length === 0 ? (
            <Text
              style={[
                styles.hint,
                { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
              ]}
            >
              No chats match "{trimmed}".
            </Text>
          ) : (
            <FlashList<SearchHit>
              data={hits}
              keyExtractor={(h) => `${h.chatId}-${h.messageId ?? "title"}`}
              contentContainerStyle={styles.listContent}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <SearchRow hit={item} theme={theme} onPress={pickHit} />
              )}
            />
          )}
        </View>
      </SafeAreaView>
    </>
  );
}

function SearchRow({
  hit,
  theme,
  onPress,
}: {
  hit: SearchHit;
  theme: Theme;
  onPress: (hit: SearchHit) => void;
}) {
  const { colors, fonts, radii } = theme;
  const segments = useMemo(
    () => (hit.snippet ? parseSnippet(hit.snippet) : []),
    [hit.snippet],
  );

  return (
    <Pressable
      onPress={() => onPress(hit)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.muted : "transparent",
          borderRadius: radii.md,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.rowTitle,
          { color: colors.foreground, fontFamily: fonts.sansSemiBold },
        ]}
      >
        {hit.title?.trim() || "Untitled"}
      </Text>
      {segments.length > 0 && (
        <Text
          numberOfLines={2}
          style={[
            styles.rowSnippet,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          {segments.map((seg, i) =>
            seg.mark ? (
              <Text
                key={i}
                style={{
                  color: colors.foreground,
                  fontFamily: fonts.sansSemiBold,
                  backgroundColor: colors.accent,
                }}
              >
                {seg.text}
              </Text>
            ) : (
              <Text key={i}>{seg.text}</Text>
            ),
          )}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  results: { flex: 1 },
  hint: {
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 32,
    paddingTop: 32,
  },
  listContent: { paddingHorizontal: 8, paddingVertical: 8 },
  row: { paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
  rowTitle: { fontSize: 15 },
  rowSnippet: { fontSize: 13, lineHeight: 18 },
});
