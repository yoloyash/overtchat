import { memo, useCallback, useMemo } from "react";
import { Linking, Text } from "react-native";
import {
  EnrichedMarkdownText,
  type LinkPressEvent,
  type MarkdownRenderers,
  type MarkdownStyle,
} from "react-native-enriched-markdown";
import { codeFileLinkName, type CodeExecutionFile } from "@overtchat/shared";
import { useTheme } from "@/lib/theme";
import {
  applyCitationsToMarkdown,
  CITATION_SCHEME,
  linkTarget,
  type SourceLookup,
} from "@/lib/chat/citations";
import { separateFileLinks } from "@/lib/chat/code-file-links";
import { CodeExecutionFiles, useSaveFile } from "./CodeExecutionFiles";

const NO_FILES: ReadonlyMap<string, CodeExecutionFile> = new Map();
// A single newline in a reply is a line break. Math is not compiled in.
const MD4C_FLAGS = { hardSoftBreaks: true, latexMath: false, admonitions: false };
// While a block is still being written it shows as it grows; a code block is
// highlighted once, when its fence closes, instead of on every chunk.
const STREAMING = { codeBlockMode: "progressive", tableMode: "progressive" } as const;

type Variant = "body" | "thinking";

/**
 * Markdown drawn by the platform's own text views, so a long reply or code
 * block is laid out natively and an update changes only what it appended.
 */
export const MarkdownBody = memo(function MarkdownBody({
  text,
  variant = "body",
  sourceLookup,
  codeFiles = NO_FILES,
  streaming = false,
}: {
  text: string;
  variant?: Variant;
  sourceLookup?: SourceLookup;
  /** Files the conversation's runs returned, which replies link by name. */
  codeFiles?: ReadonlyMap<string, CodeExecutionFile>;
  /** The text is still being written. */
  streaming?: boolean;
}) {
  const { colors, fonts, radii, scheme } = useTheme();
  const { save } = useSaveFile();

  const markdown = useMemo(
    () => separateFileLinks(sourceLookup ? applyCitationsToMarkdown(text, sourceLookup) : text),
    [text, sourceLookup],
  );
  const markdownStyle = useMemo(
    () => buildStyle({ colors, fonts, radii, variant, dark: scheme === "dark" }),
    [colors, fonts, radii, variant, scheme],
  );

  const onLinkPress = useCallback(
    ({ url }: LinkPressEvent) => {
      const name = codeFileLinkName(url);
      if (name !== null) {
        // A link to a run's file saves it; a name no run returned does nothing.
        const file = codeFiles.get(name.toLowerCase());
        if (file) void save(file);
        return;
      }
      Linking.openURL(linkTarget(url)).catch(() => {});
    },
    [codeFiles, save],
  );

  // An image, or a line that is only a link, naming a run's file shows the
  // file. A name no run returned keeps its text.
  const paragraph = markdownStyle.paragraph;
  const missingStyle = useMemo(
    () => ({
      color: paragraph?.color,
      fontFamily: paragraph?.fontFamily,
      fontSize: paragraph?.fontSize,
      lineHeight: paragraph?.lineHeight,
    }),
    [paragraph],
  );
  const renderers = useMemo<MarkdownRenderers>(() => {
    const fileBlock = (url: string, label: string) => {
      const name = codeFileLinkName(url);
      if (name === null) return undefined;
      const file = codeFiles.get(name.toLowerCase());
      if (file) return <CodeExecutionFiles files={[file]} large />;
      return label ? <Text style={missingStyle}>{label}</Text> : undefined;
    };
    return {
      image: ({ url, altText }) => fileBlock(url, altText),
      link: ({ url, label }) => fileBlock(url, label),
    };
  }, [codeFiles, missingStyle]);

  return (
    <EnrichedMarkdownText
      markdown={markdown}
      markdownStyle={markdownStyle}
      flavor="github"
      md4cFlags={MD4C_FLAGS}
      // The bubble around a reply owns long presses and copying.
      selectable={false}
      enableBlockContextMenu={false}
      enableLinkPreview={false}
      enableTaskListItemToggle={false}
      streamingAnimation={streaming}
      streamingConfig={STREAMING}
      onLinkPress={onLinkPress}
      renderers={renderers}
    />
  );
});

function buildStyle({
  colors,
  fonts,
  radii,
  variant,
  dark,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  fonts: ReturnType<typeof useTheme>["fonts"];
  radii: ReturnType<typeof useTheme>["radii"];
  variant: Variant;
  dark: boolean;
}): MarkdownStyle {
  const thinking = variant === "thinking";
  const color = thinking ? colors.mutedForeground : colors.foreground;
  const fontSize = thinking ? 13 : 16;
  const lineHeight = thinking ? 20 : 24;
  const text = { color, fontFamily: fonts.sansRegular, fontSize, lineHeight };
  const heading = (
    size: number,
    line: number,
    marginTop: number,
    marginBottom: number,
    fontFamily = fonts.sansSemiBold,
  ) => ({
    color: colors.foreground,
    fontFamily,
    // The family is already the weight; adding bold would synthesize a second one.
    fontWeight: "normal",
    fontSize: size,
    lineHeight: line,
    marginTop,
    marginBottom,
  });
  return {
    paragraph: { ...text, marginTop: 0, marginBottom: 10 },
    h1: heading(22, 28, 12, 8),
    h2: heading(19, 26, 12, 6),
    h3: heading(17, 24, 10, 4),
    h4: heading(16, 22, 8, 4),
    h5: heading(15, 22, 8, 2, fonts.sansMedium),
    h6: { ...heading(14, 20, 8, 2, fonts.sansMedium), color: colors.mutedForeground },
    strong: { fontFamily: fonts.sansSemiBold, fontWeight: "normal" },
    em: { fontStyle: "italic" },
    link: { color: colors.primary, underline: true },
    linkVariants: {
      [`^${CITATION_SCHEME}`]: {
        color: colors.foreground,
        backgroundColor: colors.muted,
        fontFamily: fonts.sansMedium,
        underline: false,
        pill: { borderRadius: radii.pill, paddingHorizontal: 6, paddingVertical: 1 },
      },
    },
    list: {
      ...text,
      bulletColor: color,
      markerColor: color,
      marginTop: 4,
      marginBottom: 4,
      itemSpacing: 4,
    },
    taskList: {
      checkedColor: colors.primary,
      borderColor: colors.mutedForeground,
      checkmarkColor: colors.primaryForeground,
      checkedTextColor: color,
      checkedStrikethrough: false,
    },
    blockquote: {
      ...text,
      backgroundColor: colors.muted,
      borderColor: colors.border,
      borderWidth: 3,
      borderRadius: radii.sm,
      padding: 8,
      marginTop: 6,
      marginBottom: 6,
    },
    code: {
      fontFamily: fonts.mono,
      fontSize: fontSize - 1,
      color: colors.foreground,
      backgroundColor: colors.muted,
      borderColor: colors.muted,
    },
    codeBlock: {
      fontFamily: fonts.mono,
      fontSize: 13,
      lineHeight: 19,
      color: colors.foreground,
      backgroundColor: colors.muted,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radii.md,
      padding: 12,
      marginTop: 6,
      marginBottom: 6,
      syntaxColors: dark ? DARK_SYNTAX : LIGHT_SYNTAX,
    },
    table: {
      ...text,
      fontSize: fontSize - 1,
      headerFontFamily: fonts.sansSemiBold,
      headerBackgroundColor: colors.muted,
      headerTextColor: colors.foreground,
      rowEvenBackgroundColor: colors.background,
      rowOddBackgroundColor: colors.background,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radii.sm,
      cellPaddingHorizontal: 10,
      cellPaddingVertical: 6,
    },
    thematicBreak: { color: colors.border, height: 1, marginTop: 12, marginBottom: 12 },
  };
}

const DARK_SYNTAX = {
  comment: "#7c7c7c",
  punctuation: "#c5c8c6",
  property: "#96cbfe",
  keyword: "#96cbfe",
  tag: "#96cbfe",
  type: "#ffffb6",
  constant: "#99cc99",
  number: "#ff73fd",
  attribute: "#a8ff60",
  string: "#a8ff60",
  variable: "#c6c5fe",
  operator: "#ededed",
  function: "#dad085",
};

const LIGHT_SYNTAX = {
  comment: "#008000",
  punctuation: "#393a34",
  property: "#36acaa",
  tag: "#36acaa",
  number: "#36acaa",
  constant: "#36acaa",
  attribute: "#e3116c",
  string: "#e3116c",
  operator: "#393a34",
  variable: "#36acaa",
  keyword: "#00a4db",
  function: "#d73a49",
  type: "#d73a49",
};
