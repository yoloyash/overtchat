import { useMemo } from "react";
import { Linking, StyleSheet } from "react-native";
import Markdown, { type ASTNode, type RenderRules } from "react-native-markdown-display";
import MarkdownIt from "markdown-it";
import { useTheme } from "@/lib/theme";
import { CodeBlock } from "./CodeBlock";

type Variant = "body" | "thinking";

export function MarkdownBody({
  text,
  variant = "body",
}: {
  text: string;
  variant?: Variant;
}) {
  const { colors, fonts, radii } = useTheme();

  const styles = useMemo(
    () => buildStyles({ colors, fonts, radii, variant }),
    [colors, fonts, radii, variant],
  );

  const markdownit = useMemo(
    () => MarkdownIt({ typographer: true, linkify: true, breaks: true }),
    [],
  );

  const rules = useMemo<RenderRules>(
    () => ({
      fence: (node: ASTNode) => (
        <CodeBlock
          key={node.key}
          code={trimTrailingNewline(node.content)}
          language={(node as ASTNode & { sourceInfo?: string }).sourceInfo ?? ""}
        />
      ),
      code_block: (node: ASTNode) => (
        <CodeBlock
          key={node.key}
          code={trimTrailingNewline(node.content)}
          language=""
        />
      ),
    }),
    [],
  );

  return (
    <Markdown
      markdownit={markdownit}
      style={styles}
      rules={rules}
      onLinkPress={(url) => {
        Linking.openURL(url).catch(() => {});
        return true;
      }}
    >
      {text}
    </Markdown>
  );
}

function trimTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s.slice(0, -1) : s;
}

function buildStyles({
  colors,
  fonts,
  radii,
  variant,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  fonts: ReturnType<typeof useTheme>["fonts"];
  radii: ReturnType<typeof useTheme>["radii"];
  variant: Variant;
}) {
  const isThinking = variant === "thinking";
  const baseColor = isThinking ? colors.mutedForeground : colors.foreground;
  const baseSize = isThinking ? 13 : 16;
  const baseLine = isThinking ? 20 : 24;

  return StyleSheet.create({
    body: {
      color: baseColor,
      fontFamily: fonts.sansRegular,
      fontSize: baseSize,
      lineHeight: baseLine,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 10,
    },
    heading1: {
      color: colors.foreground,
      fontFamily: fonts.sansSemiBold,
      fontSize: 22,
      lineHeight: 28,
      marginTop: 12,
      marginBottom: 8,
    },
    heading2: {
      color: colors.foreground,
      fontFamily: fonts.sansSemiBold,
      fontSize: 19,
      lineHeight: 26,
      marginTop: 12,
      marginBottom: 6,
    },
    heading3: {
      color: colors.foreground,
      fontFamily: fonts.sansSemiBold,
      fontSize: 17,
      lineHeight: 24,
      marginTop: 10,
      marginBottom: 4,
    },
    heading4: {
      color: colors.foreground,
      fontFamily: fonts.sansSemiBold,
      fontSize: 16,
      lineHeight: 22,
      marginTop: 8,
      marginBottom: 4,
    },
    heading5: {
      color: colors.foreground,
      fontFamily: fonts.sansMedium,
      fontSize: 15,
      lineHeight: 22,
      marginTop: 8,
      marginBottom: 2,
    },
    heading6: {
      color: colors.mutedForeground,
      fontFamily: fonts.sansMedium,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 8,
      marginBottom: 2,
    },
    strong: { fontFamily: fonts.sansSemiBold },
    em: { fontStyle: "italic" },
    link: { color: colors.primary, textDecorationLine: "underline" },
    bullet_list: { marginVertical: 4 },
    ordered_list: { marginVertical: 4 },
    list_item: { marginVertical: 2 },
    bullet_list_icon: { color: baseColor, marginRight: 6, marginLeft: 0 },
    ordered_list_icon: { color: baseColor, marginRight: 6, marginLeft: 0 },
    blockquote: {
      backgroundColor: colors.muted,
      borderLeftColor: colors.border,
      borderLeftWidth: 3,
      paddingVertical: 6,
      paddingHorizontal: 10,
      marginVertical: 6,
      borderRadius: radii.sm,
    },
    code_inline: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontFamily: fonts.mono,
      fontSize: baseSize - 1,
      paddingHorizontal: 4,
      borderRadius: radii.sm,
    },
    hr: {
      backgroundColor: colors.border,
      height: StyleSheet.hairlineWidth,
      marginVertical: 12,
    },
  });
}
