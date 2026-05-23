import * as Clipboard from "expo-clipboard";
import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import SyntaxHighlighter from "react-native-syntax-highlighter";
import { atomDark, vs } from "react-syntax-highlighter/styles/prism";
import { useTheme } from "@/lib/theme";

export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const { colors, fonts, radii, scheme } = useTheme();
  const [copied, setCopied] = useState(false);
  const lang = language.trim();

  async function copy() {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  const containerStyle = {
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
  } as const;

  return (
    <View style={[styles.container, containerStyle]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {lang ? (
          <Text
            style={[
              styles.lang,
              { color: colors.mutedForeground, fontFamily: fonts.mono },
            ]}
          >
            {lang}
          </Text>
        ) : (
          <View />
        )}
        <Pressable onPress={copy} hitSlop={12} style={styles.copyBtn}>
          <Feather
            name={copied ? "check" : "copy"}
            size={14}
            color={colors.mutedForeground}
          />
          <Text
            style={[
              styles.copyLabel,
              { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
            ]}
          >
            {copied ? "Copied" : "Copy"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.codeScroll}
      >
        {lang ? (
          <SyntaxHighlighter
            language={lang}
            highlighter="prism"
            style={scheme === "dark" ? atomDark : vs}
            fontFamily={fonts.mono}
            fontSize={13}
            customStyle={{ backgroundColor: "transparent", padding: 0 }}
          >
            {code}
          </SyntaxHighlighter>
        ) : (
          <Text
            style={{
              color: colors.foreground,
              fontFamily: fonts.mono,
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            {code}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    marginVertical: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lang: { fontSize: 11 },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  copyLabel: { fontSize: 11 },
  codeScroll: { paddingHorizontal: 12, paddingVertical: 10 },
});
