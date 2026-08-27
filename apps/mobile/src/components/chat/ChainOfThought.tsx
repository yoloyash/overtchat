import {
  Feather,
  Ionicons,
  MaterialCommunityIcons,
} from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  LayoutAnimation,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { File as FsFile, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  cleanDomain,
  faviconUrl,
  type CodeExecutionArtifact,
  type CodeExecutionPart,
  type FetchedImage,
  type FetchUrlPart,
  isToolSettled,
  parseMcpToolName,
  webSearchProviderLabel,
  webSearchResults,
  type WebSearchPart,
  type WebSearchResult,
} from "@overtchat/shared";
import type { DynamicToolUIPart } from "ai";
import { authFetch, getApiBase, getAuthCookie } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { MarkdownBody } from "./MarkdownBody";

type ReasoningPart = { type: "reasoning"; text: string; state?: string };
export type ActivityPart =
  | WebSearchPart
  | FetchUrlPart
  | CodeExecutionPart
  | DynamicToolUIPart
  | ReasoningPart;

function isWebSearch(p: ActivityPart): p is WebSearchPart {
  return p.type === "tool-web_search";
}
function isFetchUrl(p: ActivityPart): p is FetchUrlPart {
  return p.type === "tool-fetch_url";
}
function isReasoning(p: ActivityPart): p is ReasoningPart {
  return p.type === "reasoning";
}
function isCodeExecution(p: ActivityPart): p is CodeExecutionPart {
  return p.type === "tool-execute_code";
}
function isMcpTool(p: ActivityPart): p is DynamicToolUIPart {
  return p.type === "dynamic-tool" && parseMcpToolName(p.toolName) !== null;
}

/**
 * One run of model "work" — interleaved reasoning + web tool calls — rendered
 * as a chain-of-thought timeline: a single live status line up top, then a
 * left-rail timeline where each part is its own typed step node, in order.
 * Adding a new activity kind (e.g. code execution) is one new step icon +
 * renderer; nothing else moves. Mirrors the web ChainOfThought, RN-native.
 */
export function ChainOfThought({
  parts,
  active,
}: {
  parts: ActivityPart[];
  active: boolean;
}) {
  const { colors, fonts } = useTheme();
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    if (active) {
      if (startedAtRef.current == null) startedAtRef.current = Date.now();
      settledRef.current = false;
      const tick = () => {
        if (startedAtRef.current != null) {
          setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
        }
      };
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    }
    if (startedAtRef.current != null && !settledRef.current) {
      settledRef.current = true;
      setDuration(
        Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)),
      );
    }
  }, [active]);

  const hasTools = parts.some(
    (p) => isWebSearch(p) || isFetchUrl(p) || isCodeExecution(p) || isMcpTool(p),
  );
  const lastTool = [...parts]
    .reverse()
    .find(
      (part) =>
        isWebSearch(part) ||
        isFetchUrl(part) ||
        isCodeExecution(part) ||
        isMcpTool(part),
    );
  const lastToolFailed = lastTool?.state === "output-error";
  const last = parts[parts.length - 1];
  const label = active ? activeLabel(last) : settledLabel(parts, duration);

  function toggle() {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(180, "easeInEaseOut", "opacity"),
    );
    setOpen((o) => !o);
  }

  return (
    <View style={styles.wrap}>
      {/* Live status line — the only thing visible when collapsed. */}
      <Pressable
        onPress={toggle}
        hitSlop={6}
        style={({ pressed }) => [styles.header, { opacity: pressed ? 0.7 : 1 }]}
      >
        <StatusIcon
          active={active}
          hasTools={hasTools}
          failed={lastToolFailed}
          color={colors.mutedForeground}
        />
        <ShimmerLabel active={active}>
          <Text
            numberOfLines={1}
            style={[
              styles.headerLabel,
              { color: colors.foreground, fontFamily: fonts.sansMedium },
            ]}
          >
            {label}
          </Text>
        </ShimmerLabel>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={14}
          color={colors.mutedForeground}
        />
      </Pressable>

      {/* Timeline — typed step nodes on a left rail, in original order. */}
      {open ? (
        <View style={styles.timeline}>
          {parts.map((part, i) => (
            <Step key={i} part={part} isLast={i === parts.length - 1} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Leading status glyph: spinner while active, else globe (tools) / brain. */
function StatusIcon({
  active,
  hasTools,
  failed,
  color,
}: {
  active: boolean;
  hasTools: boolean;
  failed: boolean;
  color: string;
}) {
  if (active) {
    return <ActivityIndicator size="small" color={color} style={styles.statusIcon} />;
  }
  if (failed) {
    return (
      <Ionicons
        name="alert-circle-outline"
        size={15}
        color={color}
        style={styles.statusIcon}
      />
    );
  }
  if (hasTools) {
    return (
      <Ionicons name="globe-outline" size={15} color={color} style={styles.statusIcon} />
    );
  }
  return (
    <MaterialCommunityIcons
      name="brain"
      size={15}
      color={color}
      style={styles.statusIcon}
    />
  );
}

/** Gentle opacity pulse on the label while the run is live (web's shimmer). */
function ShimmerLabel({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, opacity]);

  return (
    <Animated.View style={[styles.labelWrap, { opacity }]}>{children}</Animated.View>
  );
}

/** A single timeline node: left rail (icon + connector) + the step's content. */
function Step({ part, isLast }: { part: ActivityPart; isLast: boolean }) {
  const icon =
    (isWebSearch(part) ||
      isFetchUrl(part) ||
      isCodeExecution(part) ||
      isMcpTool(part)) &&
    part.state === "output-error"
        ? "failed"
      : isWebSearch(part)
          ? "search"
          : isFetchUrl(part)
            ? "globe"
            : isCodeExecution(part)
              ? "code"
            : isMcpTool(part)
              ? "tool"
            : "brain";

  return (
    <View style={styles.step}>
      <Rail icon={icon} isLast={isLast} />
      <View style={styles.stepBody}>
        {isWebSearch(part) ? (
          <SearchStep part={part} />
        ) : isFetchUrl(part) ? (
          <FetchStep part={part} />
        ) : isCodeExecution(part) ? (
          <CodeExecutionStep part={part} />
        ) : isMcpTool(part) ? (
          <McpStep part={part} />
        ) : isReasoning(part) ? (
          <ThinkingContent content={part.text} />
        ) : null}
      </View>
    </View>
  );
}

type RailIcon = "search" | "globe" | "code" | "tool" | "brain" | "failed";

/** Left gutter: the step's icon with a connecting line down to the next node. */
function Rail({ icon, isLast }: { icon: RailIcon; isLast: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.rail}>
      <View style={[styles.railDot, { backgroundColor: colors.muted }]}>
        {icon === "failed" ? (
          <Ionicons name="alert" size={11} color={colors.mutedForeground} />
        ) : icon === "search" ? (
          <Ionicons name="search" size={11} color={colors.mutedForeground} />
        ) : icon === "globe" ? (
          <Ionicons name="globe-outline" size={11} color={colors.mutedForeground} />
        ) : icon === "code" ? (
          <Ionicons name="code-slash-outline" size={11} color={colors.mutedForeground} />
        ) : icon === "tool" ? (
          <MaterialCommunityIcons name="wrench-outline" size={11} color={colors.mutedForeground} />
        ) : (
          <MaterialCommunityIcons name="brain" size={11} color={colors.mutedForeground} />
        )}
      </View>
      {!isLast ? (
        <View style={[styles.railLine, { backgroundColor: colors.border }]} />
      ) : null}
    </View>
  );
}

function CodeExecutionStep({ part }: { part: CodeExecutionPart }) {
  const { colors, fonts } = useTheme();
  const running = !["output-available", "output-error"].includes(part.state);
  return (
    <View style={styles.searchStep}>
      <View style={styles.searchHeader}>
        <Text
          style={[
            styles.stepTitle,
            { color: colors.foreground, fontFamily: fonts.sansMedium },
          ]}
        >
          Python
        </Text>
        <Text
          style={[
            styles.metaText,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          {running
            ? "Running"
            : part.state === "output-error" || part.output?.failed
              ? "Failed"
              : "Done"}
        </Text>
      </View>
      {part.input?.code ? <ToolValue label="Code" value={part.input.code} /> : null}
      {part.state === "output-error" ? (
        <Text
          style={[
            styles.errorText,
            { color: colors.destructive, fontFamily: fonts.sansRegular },
          ]}
        >
          {part.errorText}
        </Text>
      ) : null}
      {part.state === "output-available" && part.output ? (
        <>
          {part.output.stdout ? <ToolValue label="Stdout" value={part.output.stdout} /> : null}
          {part.output.result !== null && part.output.result !== undefined ? (
            <ToolValue label="Result" value={part.output.result} />
          ) : null}
          {part.output.stderr ? <ToolValue label="Stderr" value={part.output.stderr} /> : null}
          <CodeExecutionArtifacts artifacts={part.output.outputs} />
        </>
      ) : null}
    </View>
  );
}

function CodeExecutionArtifacts({
  artifacts,
}: {
  artifacts: readonly CodeExecutionArtifact[];
}) {
  return (
    <View style={styles.artifactList}>
      {artifacts.map((artifact) => (
        <CodeExecutionArtifactRow
          key={`${artifact.url}:${artifact.name}`}
          artifact={artifact}
        />
      ))}
    </View>
  );
}

function CodeExecutionArtifactRow({
  artifact,
}: {
  artifact: CodeExecutionArtifact;
}) {
  const { colors, fonts } = useTheme();
  const [saving, setSaving] = useState(false);
  const cookie = getAuthCookie();
  const source = {
    uri: `${getApiBase()}${artifact.url}`,
    headers: cookie ? { Cookie: cookie } : undefined,
  };

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const response = await authFetch(source.uri);
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const filename = artifact.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "output";
      const file = new FsFile(Paths.cache, `${Date.now()}-${filename}`);
      file.create();
      file.write(new Uint8Array(await response.arrayBuffer()));
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error("Sharing is unavailable on this device.");
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: artifact.mediaType,
        dialogTitle: `Save ${artifact.name}`,
      });
    } catch (cause) {
      Alert.alert(
        "Couldn’t save file",
        cause instanceof Error ? cause.message : "Download failed.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View
      style={[
        styles.artifact,
        { borderColor: colors.border, backgroundColor: colors.muted },
      ]}
    >
      {artifact.kind === "image" ? (
        <Image source={source} style={styles.artifactImage} resizeMode="contain" />
      ) : null}
      <Pressable
        onPress={() => void save()}
        style={({ pressed }) => [
          styles.artifactFooter,
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Ionicons
          name={artifact.kind === "image" ? "image-outline" : "document-outline"}
          size={16}
          color={colors.mutedForeground}
        />
        <Text
          numberOfLines={1}
          style={[
            styles.artifactName,
            { color: colors.foreground, fontFamily: fonts.sansMedium },
          ]}
        >
          {artifact.name}
        </Text>
        <Text
          style={[
            styles.metaText,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          {formatBytes(artifact.byteLength)}
        </Text>
        {saving ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <Ionicons name="download-outline" size={16} color={colors.mutedForeground} />
        )}
      </Pressable>
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function McpStep({ part }: { part: DynamicToolUIPart }) {
  const { colors, fonts } = useTheme();
  const parsed = parseMcpToolName(part.toolName);
  const title = part.title ?? parsed?.toolName ?? part.toolName;
  const server = parsed?.serverName ?? "MCP";
  const running = !["output-available", "output-error", "output-denied"].includes(
    part.state,
  );

  return (
    <View style={styles.searchStep}>
      <View style={styles.searchHeader}>
        <Text
          numberOfLines={1}
          style={[
            styles.stepTitle,
            { color: colors.foreground, fontFamily: fonts.sansMedium },
          ]}
        >
          {server} · {title}
        </Text>
        <Text
          style={[
            styles.metaText,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          {running ? "Running" : part.state === "output-error" ? "Failed" : "Done"}
        </Text>
      </View>
      {part.state === "output-error" ? (
        <Text
          style={[
            styles.errorText,
            { color: colors.destructive, fontFamily: fonts.sansRegular },
          ]}
        >
          {part.errorText}
        </Text>
      ) : (
        <ToolValue label="Input" value={part.input} />
      )}
      {part.state === "output-available" ? (
        <ToolValue label="Output" value={part.output} />
      ) : null}
    </View>
  );
}

function ToolValue({ label, value }: { label: string; value: unknown }) {
  const { colors, fonts } = useTheme();
  if (value === undefined) return null;
  const text = formatToolValue(value);
  if (!text) return null;
  return (
    <View
      style={[
        styles.toolValue,
        { borderColor: colors.border, backgroundColor: colors.muted },
      ]}
    >
      <Text
        style={[
          styles.toolValueLabel,
          { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
        ]}
      >
        {label.toUpperCase()}
      </Text>
      <Text
        selectable
        style={[
          styles.toolValueText,
          { color: colors.foreground, fontFamily: fonts.sansRegular },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

function formatToolValue(value: unknown): string {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  return text.length > 20_000 ? `${text.slice(0, 20_000)}\n…` : text;
}

/** A reasoning part's markdown, rendered as muted text inside a step. */
function ThinkingContent({ content }: { content: string }) {
  const trimmed = content.trim();
  if (!trimmed) return null;
  return <MarkdownBody text={trimmed} variant="thinking" />;
}

const RESULTS_PREVIEW = 5;

function SearchStep({ part }: { part: WebSearchPart }) {
  const { colors, fonts } = useTheme();
  const [showAll, setShowAll] = useState(false);
  const query = part.input?.query?.trim();
  const results = webSearchResults(part.output);
  const provider = webSearchProviderLabel(part.output);
  const hasAnswer =
    part.output !== undefined &&
    !Array.isArray(part.output) &&
    Boolean(part.output.answer);
  const visible = showAll ? results : results.slice(0, RESULTS_PREVIEW);
  const hidden = results.length - visible.length;

  function toggleShowAll() {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(180, "easeInEaseOut", "opacity"),
    );
    setShowAll((s) => !s);
  }

  return (
    <View style={styles.searchStep}>
      <View style={styles.searchHeader}>
        <Text
          numberOfLines={1}
          style={[
            styles.stepTitle,
            { color: colors.foreground, fontFamily: fonts.sansMedium },
          ]}
        >
          {query || "Searching…"}
        </Text>
        {part.state === "output-available" ? (
          <Text
            style={[
              styles.metaText,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {results.length > 0
              ? `${results.length} ${results.length === 1 ? "result" : "results"}`
              : hasAnswer
                ? "answer"
                : "no results"}
            {provider ? ` · ${provider}` : ""}
          </Text>
        ) : null}
      </View>

      {part.state === "output-error" ? (
        <Text
          style={[
            styles.errorText,
            { color: colors.destructive, fontFamily: fonts.sansRegular },
          ]}
        >
          {part.errorText}
        </Text>
      ) : results.length === 0 ? null : (
        <View
          style={[
            styles.resultList,
            { borderColor: colors.border, backgroundColor: colors.muted },
          ]}
        >
          {visible.map((r, i) => (
            <ResultRow
              key={`${r.link}-${i}`}
              result={r}
              first={i === 0}
            />
          ))}
          {hidden > 0 || showAll ? (
            <Pressable
              onPress={toggleShowAll}
              style={({ pressed }) => [
                styles.showAllRow,
                { borderTopColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text
                style={[
                  styles.showAllText,
                  { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
                ]}
              >
                {showAll ? "Show less" : `Show ${hidden} more`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

function ResultRow({
  result,
  first,
}: {
  result: WebSearchResult;
  first: boolean;
}) {
  const { colors, fonts } = useTheme();
  const domain = cleanDomain(result.link);
  return (
    <Pressable
      onPress={() => Linking.openURL(result.link).catch(() => {})}
      style={({ pressed }) => [
        styles.resultRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Favicon domain={domain} />
      <Text
        numberOfLines={1}
        style={[
          styles.resultTitle,
          { color: colors.foreground, fontFamily: fonts.sansRegular },
        ]}
      >
        {result.title}
      </Text>
      <Text
        numberOfLines={1}
        style={[
          styles.resultDomain,
          { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
        ]}
      >
        {domain}
      </Text>
    </Pressable>
  );
}

function FetchStep({ part }: { part: FetchUrlPart }) {
  const { colors, fonts } = useTheme();
  const url = part.input?.url;
  const domain = url ? cleanDomain(url) : "";
  const running = !isToolSettled(part);
  const page = part.output;

  if (part.state === "output-error") {
    return (
      <View style={styles.searchStep}>
        <Text
          style={[
            styles.stepTitle,
            { color: colors.foreground, fontFamily: fonts.sansMedium },
          ]}
        >
          Read {domain || "page"}
        </Text>
        <Text
          style={[
            styles.errorText,
            { color: colors.destructive, fontFamily: fonts.sansRegular },
          ]}
        >
          {part.errorText}
        </Text>
      </View>
    );
  }

  if (isFetchedImage(page)) {
    const cookie = getAuthCookie();
    const source = {
      uri: `${getApiBase()}${page.uploadUrl}`,
      headers: cookie ? { Cookie: cookie } : undefined,
    };
    return (
      <Pressable
        onPress={() => Linking.openURL(page.url).catch(() => {})}
        style={({ pressed }) => [
          styles.fetchRow,
          {
            borderColor: colors.border,
            backgroundColor: colors.muted,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Image source={source} style={styles.fetchedImage} />
        <View style={styles.fetchedImageText}>
          <Text
            numberOfLines={1}
            style={[
              styles.resultTitle,
              { color: colors.foreground, fontFamily: fonts.sansRegular },
            ]}
          >
            {page.filename}
          </Text>
          <Text
            numberOfLines={1}
            style={[
              styles.resultDomain,
              {
                color: colors.mutedForeground,
                fontFamily: fonts.sansRegular,
              },
            ]}
          >
            {cleanDomain(page.url)}
          </Text>
        </View>
        <Text
          style={[
            styles.resultDomain,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          Image
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => Linking.openURL(page?.url ?? url ?? "").catch(() => {})}
      style={({ pressed }) => [
        styles.fetchRow,
        { borderColor: colors.border, backgroundColor: colors.muted, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {running ? (
        <ActivityIndicator size="small" color={colors.mutedForeground} style={styles.favicon} />
      ) : (
        <Favicon domain={domain} />
      )}
      <Text
        numberOfLines={1}
        style={[
          styles.resultTitle,
          { color: colors.foreground, fontFamily: fonts.sansRegular },
        ]}
      >
        {page?.title ?? (running ? "Reading…" : domain)}
      </Text>
      {page ? (
        <Text
          style={[
            styles.resultDomain,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          {page.wordCount.toLocaleString()} words
        </Text>
      ) : null}
    </Pressable>
  );
}

function isFetchedImage(value: unknown): value is FetchedImage {
  return (
    Boolean(value && typeof value === "object") &&
    (value as Partial<FetchedImage>).kind === "image"
  );
}

/**
 * A domain favicon with a fallback chain: Google's favicon service →
 * DuckDuckGo → a globe glyph. Both services 404 on unknown domains, so the
 * client-side fallback is required, not optional.
 */
function Favicon({ domain }: { domain: string }) {
  const { colors } = useTheme();
  const [idx, setIdx] = useState(0);
  const sources = [
    faviconUrl(domain, 64),
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  ];

  if (idx >= sources.length) {
    return (
      <Ionicons
        name="globe-outline"
        size={14}
        color={colors.mutedForeground}
        style={styles.favicon}
      />
    );
  }
  return (
    <Image
      source={{ uri: sources[idx] }}
      onError={() => setIdx((i) => i + 1)}
      style={[styles.favicon, { backgroundColor: colors.background }]}
    />
  );
}

function activeLabel(last: ActivityPart | undefined): string {
  if (!last) return "Working…";
  if (last.type === "tool-web_search") {
    const query = last.input?.query?.trim();
    return query ? `Searching "${query}"` : "Searching the web…";
  }
  if (last.type === "tool-fetch_url") {
    const url = last.input?.url;
    return url ? `Reading ${cleanDomain(url)}` : "Reading page…";
  }
  if (last.type === "tool-execute_code") return "Running Python…";
  if (isMcpTool(last)) {
    const parsed = parseMcpToolName(last.toolName);
    return parsed
      ? `Running ${parsed.serverName} · ${parsed.toolName}`
      : "Running MCP tool…";
  }
  return "Thinking";
}

function settledLabel(parts: ActivityPart[], duration: number): string {
  const lastTool = [...parts]
    .reverse()
    .find(
      (part) =>
        isWebSearch(part) ||
        isFetchUrl(part) ||
        isCodeExecution(part) ||
        isMcpTool(part),
    );
  if (lastTool?.type === "tool-web_search") {
    if (lastTool.state === "output-error") return "Web search failed";
    if (lastTool.state === "output-available") return "Searched the web";
    return "Web search did not complete";
  }
  if (lastTool?.type === "tool-fetch_url") {
    if (lastTool.state === "output-error") return "Page fetch failed";
    if (lastTool.state === "output-available") {
      return isFetchedImage(lastTool.output) ? "Viewed image" : "Read page";
    }
    return "Page fetch did not complete";
  }
  if (lastTool?.type === "tool-execute_code") {
    if (lastTool.state === "output-error") return "Python failed";
    if (lastTool.state === "output-available") {
      if (lastTool.output?.failed) return "Python failed";
      return lastTool.output?.stderr ? "Ran Python with warnings" : "Ran Python";
    }
    return "Python did not complete";
  }
  if (lastTool && isMcpTool(lastTool)) {
    const parsed = parseMcpToolName(lastTool.toolName);
    const label = parsed
      ? `${parsed.serverName} · ${parsed.toolName}`
      : "MCP tool";
    if (lastTool.state === "output-error") return `${label} failed`;
    if (lastTool.state === "output-available") return `Used ${label}`;
    return `${label} did not complete`;
  }
  return duration > 0 ? `Thought for ${duration}s` : "Thoughts";
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 2 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingVertical: 4,
  },
  statusIcon: { width: 16, height: 16, alignItems: "center", justifyContent: "center" },
  labelWrap: { flexShrink: 1 },
  headerLabel: { fontSize: 13 },

  timeline: { marginTop: 4 },
  step: { flexDirection: "row", gap: 10 },
  rail: { alignItems: "center", width: 20 },
  railDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  railLine: { width: 1, flex: 1, marginTop: 4 },
  stepBody: { flex: 1, paddingBottom: 12 },

  searchStep: { gap: 6 },
  searchHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  stepTitle: { flexShrink: 1, fontSize: 13 },
  metaText: { fontSize: 12 },
  errorText: { fontSize: 12 },
  toolValue: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  toolValueLabel: { fontSize: 9, letterSpacing: 0.5 },
  toolValueText: { fontSize: 11, lineHeight: 16 },

  resultList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: "hidden",
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  resultTitle: { flex: 1, fontSize: 13 },
  resultDomain: { flexShrink: 0, maxWidth: "35%", fontSize: 12 },
  showAllRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  showAllText: { fontSize: 12 },

  fetchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  favicon: { width: 16, height: 16, borderRadius: 4 },
  fetchedImage: { width: 48, height: 48, borderRadius: 6 },
  fetchedImageText: { flex: 1, minWidth: 0 },
  artifactList: { gap: 8 },
  artifact: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: "hidden",
  },
  artifactImage: { width: "100%", height: 220 },
  artifactFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  artifactName: { flex: 1, fontSize: 12 },
});
