import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  LayoutAnimation,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useState } from "react";
import { cleanDomain, type FetchUrlPart, type WebSearchPart } from "@overtchat/shared";
import { useTheme } from "@/lib/theme";

export function ToolCall({ part }: { part: WebSearchPart | FetchUrlPart }) {
  const { colors, fonts, radii } = useTheme();
  const [open, setOpen] = useState(false);

  const isSearch = part.type === "tool-web_search";
  const label = isSearch
    ? part.input?.query?.trim() || "Searching…"
    : part.input?.url || "Fetching…";

  const status: "running" | "done" | "error" =
    part.state === "output-available"
      ? "done"
      : part.state === "output-error"
        ? "error"
        : "running";

  function toggle() {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(180, "easeInEaseOut", "opacity"),
    );
    setOpen((o) => !o);
  }

  return (
    <View
      style={[
        styles.wrap,
        {
          borderColor: colors.border,
          borderRadius: radii.md,
          backgroundColor: colors.muted,
        },
      ]}
    >
      <Pressable onPress={toggle} hitSlop={4} style={styles.header}>
        {status === "running" ? (
          <ActivityIndicator
            size="small"
            color={colors.mutedForeground}
            style={styles.statusIcon}
          />
        ) : status === "error" ? (
          <Ionicons
            name="alert-circle-outline"
            size={14}
            color={colors.destructive}
            style={styles.statusIcon}
          />
        ) : (
          <Ionicons
            name={isSearch ? "globe-outline" : "link-outline"}
            size={14}
            color={colors.mutedForeground}
            style={styles.statusIcon}
          />
        )}
        <Text
          numberOfLines={1}
          style={[
            styles.headerText,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          <Text
            style={[styles.headerLabel, { color: colors.foreground, fontFamily: fonts.sansSemiBold }]}
          >
            {isSearch ? "Search" : "Read"}
          </Text>
          {" · "}
          {label}
        </Text>
        <Ionicons
          name={open ? "chevron-down" : "chevron-forward"}
          size={14}
          color={colors.mutedForeground}
        />
      </Pressable>

      {open && (
        <View style={[styles.body, { borderTopColor: colors.border }]}>
          {part.state === "output-error" && (
            <Text
              style={[
                styles.errorText,
                { color: colors.destructive, fontFamily: fonts.sansRegular },
              ]}
            >
              {part.errorText}
            </Text>
          )}

          {isSearch && part.state === "output-available" && part.output && (
            <View style={styles.resultList}>
              {part.output.map((r, i) => (
                <Pressable
                  key={`${r.link}-${i}`}
                  onPress={() => Linking.openURL(r.link).catch(() => {})}
                  style={({ pressed }) => [
                    styles.resultRow,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text
                    style={[
                      styles.resultTitle,
                      { color: colors.foreground, fontFamily: fonts.sansSemiBold },
                    ]}
                    numberOfLines={1}
                  >
                    {r.title}
                  </Text>
                  <Text
                    style={[
                      styles.resultDomain,
                      { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                    ]}
                    numberOfLines={1}
                  >
                    {cleanDomain(r.link)}
                  </Text>
                  {r.snippet ? (
                    <Text
                      style={[
                        styles.resultSnippet,
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
                </Pressable>
              ))}
            </View>
          )}

          {!isSearch && part.state === "output-available" && part.output && (
            <Pressable
              onPress={() =>
                Linking.openURL(part.output!.url).catch(() => {})
              }
              style={({ pressed }) => [
                styles.resultRow,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text
                style={[
                  styles.resultTitle,
                  { color: colors.foreground, fontFamily: fonts.sansSemiBold },
                ]}
                numberOfLines={1}
              >
                {part.output.title}
              </Text>
              <Text
                style={[
                  styles.resultSnippet,
                  { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                ]}
              >
                {part.output.wordCount.toLocaleString()} words
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginVertical: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  statusIcon: { width: 14, height: 14 },
  headerText: { flex: 1, fontSize: 12 },
  headerLabel: { fontSize: 12 },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  errorText: { fontSize: 12 },
  resultList: { gap: 10 },
  resultRow: { gap: 2 },
  resultTitle: { fontSize: 13 },
  resultDomain: { fontSize: 11 },
  resultSnippet: { fontSize: 12, lineHeight: 16 },
});
