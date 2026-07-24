import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  Image,
  LayoutAnimation,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { UIMessage } from "ai";
import {
  buildWebCitationIndex,
  cleanDomain,
  faviconUrl,
  type WebSearchResult,
} from "@overtchat/shared";
import { useTheme } from "@/lib/theme";

export function Sources({ message }: { message: UIMessage }) {
  const { colors, fonts } = useTheme();
  const [open, setOpen] = useState(false);

  const all: WebSearchResult[] = buildWebCitationIndex(message.parts).sources;
  if (all.length === 0) return null;

  function toggle() {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(180, "easeInEaseOut", "opacity"),
    );
    setOpen((o) => !o);
  }

  const previewSources = all.slice(0, 5);

  return (
    <View style={styles.wrap}>
      <Pressable onPress={toggle} hitSlop={6} style={styles.header}>
        <View style={styles.faviconStack}>
          {previewSources.map((r, i) => {
            const domain = cleanDomain(r.link);
            return (
              <Image
                key={r.link}
                source={{ uri: faviconUrl(domain) }}
                style={[
                  styles.stackedFavicon,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.background,
                    marginLeft: i === 0 ? 0 : -6,
                  },
                ]}
              />
            );
          })}
        </View>
        <Text
          style={[
            styles.headerText,
            { color: colors.mutedForeground, fontFamily: fonts.sansSemiBold },
          ]}
        >
          {all.length} {all.length === 1 ? "Source" : "Sources"}
        </Text>
        <Ionicons
          name={open ? "chevron-down" : "chevron-forward"}
          size={14}
          color={colors.mutedForeground}
        />
      </Pressable>

      {open && (
        <View style={styles.list}>
          {all.map((r, i) => {
            const domain = cleanDomain(r.link);
            return (
              <Pressable
                key={r.link}
                onPress={() => Linking.openURL(r.link).catch(() => {})}
                style={({ pressed }) => [
                  styles.row,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text
                  style={[
                    styles.index,
                    {
                      color: colors.mutedForeground,
                      fontFamily: fonts.sansRegular,
                    },
                  ]}
                >
                  {i + 1}.
                </Text>
                <View style={styles.rowBody}>
                  <Text
                    style={[
                      styles.title,
                      {
                        color: colors.foreground,
                        fontFamily: fonts.sansSemiBold,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {r.title}
                  </Text>
                  <View style={styles.domainRow}>
                    <Image
                      source={{ uri: faviconUrl(domain) }}
                      style={styles.rowFavicon}
                    />
                    <Text
                      style={[
                        styles.domain,
                        {
                          color: colors.mutedForeground,
                          fontFamily: fonts.sansRegular,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {domain}
                    </Text>
                  </View>
                  {r.snippet ? (
                    <Text
                      style={[
                        styles.snippet,
                        {
                          color: colors.mutedForeground,
                          fontFamily: fonts.sansRegular,
                        },
                      ]}
                      numberOfLines={2}
                    >
                      {r.snippet}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  headerText: { fontSize: 12 },
  faviconStack: { flexDirection: "row" },
  stackedFavicon: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  list: { marginTop: 6, gap: 8 },
  row: { flexDirection: "row", gap: 6 },
  index: { width: 18, textAlign: "right", fontSize: 12, lineHeight: 18 },
  rowBody: { flex: 1, gap: 1 },
  title: { fontSize: 13 },
  domainRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  rowFavicon: { width: 12, height: 12, borderRadius: 6 },
  domain: { fontSize: 11, flexShrink: 1 },
  snippet: { fontSize: 12, lineHeight: 16, marginTop: 2 },
});
