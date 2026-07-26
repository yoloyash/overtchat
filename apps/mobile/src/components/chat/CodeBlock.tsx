import * as Clipboard from "expo-clipboard";
import { Feather } from "@expo/vector-icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { refractor } from "refractor/all";
import { useTheme } from "@/lib/theme";

type HighlightNode = ReturnType<
  typeof refractor.highlight
>["children"][number];

const LANGUAGE_ALIASES: Record<string, string> = {
  "c#": "csharp",
  "c++": "cpp",
  "javascriptreact": "jsx",
  "objective-c": "objectivec",
  "shellscript": "bash",
  "typescriptreact": "tsx",
};

const DARK_TOKEN_COLORS: Record<string, string> = {
  comment: "#7c7c7c",
  prolog: "#7c7c7c",
  doctype: "#7c7c7c",
  cdata: "#7c7c7c",
  punctuation: "#c5c8c6",
  property: "#96cbfe",
  keyword: "#96cbfe",
  tag: "#96cbfe",
  "class-name": "#ffffb6",
  boolean: "#99cc99",
  constant: "#99cc99",
  symbol: "#f92672",
  deleted: "#f92672",
  number: "#ff73fd",
  selector: "#a8ff60",
  "attr-name": "#a8ff60",
  string: "#a8ff60",
  char: "#a8ff60",
  builtin: "#a8ff60",
  inserted: "#a8ff60",
  variable: "#c6c5fe",
  operator: "#ededed",
  entity: "#ffffb6",
  url: "#96cbfe",
  atrule: "#f9ee98",
  "attr-value": "#f9ee98",
  function: "#dad085",
  regex: "#e9c062",
  important: "#fd971f",
};

const LIGHT_TOKEN_COLORS: Record<string, string> = {
  comment: "#008000",
  prolog: "#008000",
  doctype: "#008000",
  cdata: "#008000",
  punctuation: "#393a34",
  property: "#36acaa",
  tag: "#36acaa",
  boolean: "#36acaa",
  number: "#36acaa",
  constant: "#36acaa",
  symbol: "#36acaa",
  deleted: "#36acaa",
  selector: "#e3116c",
  "attr-name": "#e3116c",
  string: "#e3116c",
  char: "#e3116c",
  builtin: "#e3116c",
  inserted: "#e3116c",
  operator: "#393a34",
  entity: "#393a34",
  url: "#393a34",
  variable: "#36acaa",
  atrule: "#00a4db",
  "attr-value": "#00a4db",
  keyword: "#00a4db",
  function: "#d73a49",
  "class-name": "#d73a49",
  regex: "#36acaa",
  important: "#36acaa",
};

export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const { colors, fonts, radii, scheme } = useTheme();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const languageLabel = language.trim().split(/\s+/, 1)[0] ?? "";
  const grammar = normalizeLanguage(languageLabel);
  const codeContent = useMemo<ReactNode>(() => {
    if (!grammar || !refractor.registered(grammar)) return code;

    try {
      const tree = refractor.highlight(code, grammar);
      const tokenColors =
        scheme === "dark" ? DARK_TOKEN_COLORS : LIGHT_TOKEN_COLORS;
      return tree.children.map((node, index) =>
        renderHighlightNode(node, String(index), tokenColors),
      );
    } catch {
      return code;
    }
  }, [code, grammar, scheme]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function copy() {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1200);
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
        {languageLabel ? (
          <Text
            style={[
              styles.lang,
              { color: colors.mutedForeground, fontFamily: fonts.mono },
            ]}
          >
            {languageLabel}
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
        <Text
          style={[
            styles.code,
            { color: colors.foreground, fontFamily: fonts.mono },
          ]}
        >
          {codeContent}
        </Text>
      </ScrollView>
    </View>
  );
}

function normalizeLanguage(language: string): string {
  const normalized = language.toLowerCase().replace(/^language-/, "");
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function renderHighlightNode(
  node: HighlightNode,
  key: string,
  tokenColors: Record<string, string>,
): ReactNode {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return null;

  const classNames = normalizeClassNames(node.properties.className);
  const color = classNames
    .map((className) => tokenColors[className])
    .find(Boolean);

  return (
    <Text key={key} style={color ? { color } : undefined}>
      {node.children.map((child, index) =>
        renderHighlightNode(child, `${key}.${index}`, tokenColors),
      )}
    </Text>
  );
}

function normalizeClassNames(value: unknown): string[] {
  if (typeof value === "string") return value.split(/\s+/);
  if (!Array.isArray(value)) return [];
  return value.map(String);
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
  code: { fontSize: 13, lineHeight: 19 },
  codeScroll: { paddingHorizontal: 12, paddingVertical: 10 },
});
