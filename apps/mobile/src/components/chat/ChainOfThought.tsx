import {
  Feather,
  Ionicons,
  MaterialCommunityIcons,
} from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  LayoutAnimation,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  cleanDomain,
  faviconUrl,
  type FetchUrlPart,
  type WebSearchPart,
  type WebSearchResult,
} from "@overtchat/shared";
import { useTheme } from "@/lib/theme";
import { MarkdownBody } from "./MarkdownBody";

type ReasoningPart = { type: "reasoning"; text: string; state?: string };
export type ActivityPart = WebSearchPart | FetchUrlPart | ReasoningPart;

function isWebSearch(p: ActivityPart): p is WebSearchPart {
  return p.type === "tool-web_search";
}
function isFetchUrl(p: ActivityPart): p is FetchUrlPart {
  return p.type === "tool-fetch_url";
}
function isReasoning(p: ActivityPart): p is ReasoningPart {
  return p.type === "reasoning";
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

  const hasTools = parts.some((p) => isWebSearch(p) || isFetchUrl(p));
  const last = parts[parts.length - 1];
  const label = active ? activeLabel(last) : settledLabel(hasTools, duration);

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
        <StatusIcon active={active} hasTools={hasTools} color={colors.mutedForeground} />
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
  color,
}: {
  active: boolean;
  hasTools: boolean;
  color: string;
}) {
  if (active) {
    return <ActivityIndicator size="small" color={color} style={styles.statusIcon} />;
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
  const icon = isWebSearch(part)
    ? "search"
    : isFetchUrl(part)
      ? "globe"
      : "brain";

  return (
    <View style={styles.step}>
      <Rail icon={icon} isLast={isLast} />
      <View style={styles.stepBody}>
        {isWebSearch(part) ? (
          <SearchStep part={part} />
        ) : isFetchUrl(part) ? (
          <FetchStep part={part} />
        ) : isReasoning(part) ? (
          <ThinkingContent content={part.text} />
        ) : null}
      </View>
    </View>
  );
}

type RailIcon = "search" | "globe" | "brain";

/** Left gutter: the step's icon with a connecting line down to the next node. */
function Rail({ icon, isLast }: { icon: RailIcon; isLast: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.rail}>
      <View style={[styles.railDot, { backgroundColor: colors.muted }]}>
        {icon === "search" ? (
          <Ionicons name="search" size={11} color={colors.mutedForeground} />
        ) : icon === "globe" ? (
          <Ionicons name="globe-outline" size={11} color={colors.mutedForeground} />
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
  const results = part.output ?? [];
  const running =
    part.state !== "output-available" && part.state !== "output-error";
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
            {results.length} {results.length === 1 ? "result" : "results"}
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
      ) : running && results.length === 0 ? null : (
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
  const running =
    part.state !== "output-available" && part.state !== "output-error";
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
  return "Thinking";
}

function settledLabel(hasTools: boolean, duration: number): string {
  if (hasTools) return "Searched the web";
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
});
