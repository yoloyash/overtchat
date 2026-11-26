import {
  Feather,
  Ionicons,
  MaterialCommunityIcons,
} from "@expo/vector-icons";
import { useLayoutState } from "@shopify/flash-list";
import { memo, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Animated,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  cleanDomain,
  codeExecutionFiles,
  codeRunStatus,
  faviconUrl,
  type CodeExecutionPart,
  type FetchedImage,
  type FetchUrlPart,
  calendarActivityLabel,
  type CalendarToolPart,
  describeCalendarToolPart,
  describeGmailToolPart,
  formatCalendarEventTime,
  gmailActivityLabel,
  type GmailToolPart,
  isCalendarToolPart,
  isCodeExecutionPart,
  isGmailToolPart,
  isReadFilePart,
  isScheduledTaskToolPart,
  isSearchFilesPart,
  isToolSettled,
  isViewSkillToolPart,
  parseMcpToolName,
  readFileRangeLabel,
  type ReadFilePart,
  scheduledTaskActivityLabel,
  type ScheduledTaskToolPart,
  type SearchFilesPart,
  viewSkillActivityLabel,
  type ViewSkillToolPart,
  webSearchProviderLabel,
  webSearchResults,
  type WebSearchPart,
  type WebSearchResult,
} from "@overtchat/shared";
import { agentThoughtPreview } from "@overtchat/shared/agent-presentation";
import type { DynamicToolUIPart } from "ai";
import { useFormatLocale } from "@/components/I18nProvider";
import { getApiBase } from "@/lib/api";
import { useAuthCookie } from "@/lib/auth/useAuthCookie";
import { useChatPreferences } from "@/lib/chatPreferences";
import { sameItems, shallowEqual } from "@/lib/equal";
import { useTheme } from "@/lib/theme";
import { CalendarLogo } from "../CalendarLogo";
import { GmailLogo } from "../GmailLogo";
import { CodeBlock } from "./CodeBlock";
import { CodeExecutionFiles } from "./CodeExecutionFiles";
import { MarkdownBody } from "./MarkdownBody";

type ReasoningPart = { type: "reasoning"; text: string; state?: string };
export type ActivityPart =
  | WebSearchPart
  | FetchUrlPart
  | ReadFilePart
  | SearchFilesPart
  | CodeExecutionPart
  | GmailToolPart
  | CalendarToolPart
  | ViewSkillToolPart
  | ScheduledTaskToolPart
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
function isMcpTool(p: ActivityPart): p is DynamicToolUIPart {
  return p.type === "dynamic-tool" && parseMcpToolName(p.toolName) !== null;
}
function isFileTool(p: ActivityPart): p is ReadFilePart | SearchFilesPart {
  return isReadFilePart(p) || isSearchFilesPart(p);
}
function isTool(
  p: ActivityPart,
): p is Exclude<ActivityPart, ReasoningPart> {
  return (
    isWebSearch(p) ||
    isFetchUrl(p) ||
    isFileTool(p) ||
    isCodeExecutionPart(p) ||
    isGmailToolPart(p) ||
    isCalendarToolPart(p) ||
    isViewSkillToolPart(p) ||
    isScheduledTaskToolPart(p) ||
    isMcpTool(p)
  );
}

/**
 * One run of model "work" — interleaved reasoning + web tool calls — rendered
 * as a chain-of-thought timeline: a single live status line up top, then a
 * left-rail timeline where each part is its own typed step node, in order.
 * When the run used tools, each reasoning step is a collapsed "Thought" row so
 * the tool steps can be scanned without reading the thinking. Adding a new
 * activity kind (e.g. code execution) is one new step icon + renderer;
 * nothing else moves. Mirrors the web ChainOfThought, RN-native.
 */
function ChainOfThoughtView({
  parts,
  active,
}: {
  parts: ActivityPart[];
  active: boolean;
}) {
  const { colors, fonts } = useTheme();
  const { t } = useTranslation();
  const { expandActivity } = useChatPreferences();
  // A tap wins; until then the device preference decides, live.
  const [toggled, setToggled] = useLayoutState<boolean | null>(null);
  const open = toggled ?? expandActivity;
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

  const lastTool = [...parts].reverse().find(isTool);
  // Reasoning stays inline when it is all the run did.
  const collapseThoughts = lastTool !== undefined;
  // Keyed by position in `parts`, so dropping an empty thought never shifts
  // another step's open state onto its neighbour.
  const steps = parts
    .map((part, index) => ({ part, index }))
    .filter(
      ({ part }) =>
        !isReasoning(part) ||
        part.text.trim() !== "" ||
        part.state === "streaming",
    );
  const toolKind = lastTool
    ? isFileTool(lastTool)
      ? "file"
      : isCodeExecutionPart(lastTool)
        ? "code"
        : isGmailToolPart(lastTool)
          ? "mail"
          : isCalendarToolPart(lastTool)
            ? "calendar"
            : isScheduledTaskToolPart(lastTool)
              ? "scheduled"
              : "web"
    : null;
  const lastToolFailed = lastTool?.state === "output-error";
  const last = parts[parts.length - 1];
  const label = active ? activeLabel(last, t) : settledLabel(parts, duration, t);

  function toggle() {
    setToggled(!open);
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
          toolKind={toolKind}
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
          {steps.map(({ part, index }, i) => (
            <Step
              key={index}
              part={part}
              isLast={i === steps.length - 1}
              collapseThoughts={collapseThoughts}
              expandByDefault={expandActivity}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Leading status glyph: spinner while active, else the tool kind / brain. */
function StatusIcon({
  active,
  toolKind,
  failed,
  color,
}: {
  active: boolean;
  toolKind: "web" | "file" | "code" | "mail" | "calendar" | "scheduled" | null;
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
  if (toolKind === "file") {
    return (
      <Ionicons
        name="document-text-outline"
        size={15}
        color={color}
        style={styles.statusIcon}
      />
    );
  }
  if (toolKind === "code") {
    return (
      <Ionicons name="code-slash-outline" size={15} color={color} style={styles.statusIcon} />
    );
  }
  if (toolKind === "mail") {
    return (
      <View style={styles.statusIcon}>
        <GmailLogo size={15} />
      </View>
    );
  }
  if (toolKind === "calendar") {
    return (
      <View style={styles.statusIcon}>
        <CalendarLogo size={15} />
      </View>
    );
  }
  if (toolKind === "scheduled") {
    return (
      <Ionicons name="calendar-outline" size={15} color={color} style={styles.statusIcon} />
    );
  }
  if (toolKind === "web") {
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
  const [opacity] = useState(() => new Animated.Value(1));

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
function StepView({
  part,
  isLast,
  collapseThoughts,
  expandByDefault,
}: {
  part: ActivityPart;
  isLast: boolean;
  collapseThoughts: boolean;
  expandByDefault: boolean;
}) {
  const icon: RailIcon =
    isTool(part) && part.state === "output-error"
      ? "failed"
      : isWebSearch(part)
        ? "search"
        : isFetchUrl(part)
          ? "globe"
          : isReadFilePart(part)
            ? "file"
            : isSearchFilesPart(part)
              ? "file-search"
              : isCodeExecutionPart(part)
                ? "code"
                : isGmailToolPart(part)
                  ? "mail"
                  : isCalendarToolPart(part) || isScheduledTaskToolPart(part)
                    ? "calendar"
                    : isScheduledTaskToolPart(part)
                      ? "scheduled"
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
        ) : isReadFilePart(part) ? (
          <ReadFileStep part={part} />
        ) : isSearchFilesPart(part) ? (
          <SearchFilesStep part={part} />
        ) : isCodeExecutionPart(part) ? (
          <CodeStep part={part} />
        ) : isGmailToolPart(part) ? (
          <GmailStep part={part} />
        ) : isCalendarToolPart(part) ? (
          <CalendarStep part={part} />
        ) : isViewSkillToolPart(part) ? (
          <SkillStep part={part} />
        ) : isScheduledTaskToolPart(part) ? (
          <ScheduledTaskStep part={part} />
        ) : isMcpTool(part) ? (
          <McpStep part={part} />
        ) : isReasoning(part) ? (
          collapseThoughts ? (
            <ThoughtStep part={part} expandByDefault={expandByDefault} />
          ) : (
            <ThinkingContent content={part.text} />
          )
        ) : null}
      </View>
    </View>
  );
}

// A streamed update hands every part over as a new object, changed or not, so
// both compare parts by content: only the step that changed renders again.
const Step = memo(
  StepView,
  (earlier, next) =>
    earlier.isLast === next.isLast &&
    earlier.collapseThoughts === next.collapseThoughts &&
    earlier.expandByDefault === next.expandByDefault &&
    shallowEqual(earlier.part, next.part),
);

export const ChainOfThought = memo(
  ChainOfThoughtView,
  (earlier, next) => earlier.active === next.active && sameItems(earlier.parts, next.parts),
);

type RailIcon =
  | "search"
  | "globe"
  | "file"
  | "file-search"
  | "code"
  | "mail"
  | "calendar"
  | "scheduled"
  | "tool"
  | "brain"
  | "failed";

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
        ) : icon === "file" ? (
          <Ionicons name="document-text-outline" size={11} color={colors.mutedForeground} />
        ) : icon === "file-search" ? (
          <MaterialCommunityIcons name="file-search-outline" size={11} color={colors.mutedForeground} />
        ) : icon === "code" ? (
          <Ionicons name="code-slash-outline" size={11} color={colors.mutedForeground} />
        ) : icon === "mail" ? (
          <GmailLogo size={11} />
        ) : icon === "calendar" ? (
          <CalendarLogo size={11} />
        ) : icon === "scheduled" ? (
          <Ionicons name="calendar-outline" size={11} color={colors.mutedForeground} />
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

function McpStep({ part }: { part: DynamicToolUIPart }) {
  const { colors, fonts } = useTheme();
  const { t } = useTranslation();
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
          {running ? t("chat.activity.running") : part.state === "output-error" ? t("chat.activity.failed") : t("chat.activity.done")}
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
        <ToolValue label={t("chat.mobile.activity.inputHeader")} value={part.input} />
      )}
      {part.state === "output-available" ? (
        <ToolValue label={t("chat.mobile.activity.outputHeader")} value={part.output} />
      ) : null}
    </View>
  );
}

function CodeStep({ part }: { part: CodeExecutionPart }) {
  const { colors, fonts } = useTheme();
  const { t } = useTranslation();
  const output = part.output;
  const code = part.input?.code ?? "";
  const files = codeExecutionFiles(part);
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
          {/* eslint-disable-next-line i18next/no-literal-string -- Programming language name */}
          {"Python"}
        </Text>
        <Text
          style={[
            styles.metaText,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          {codeRunStatus(part, t)}
        </Text>
      </View>
      {code ? <CodeBlock code={code} language="python" /> : null}
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
      {output?.stdout ? (
        <ToolValue
          label={
            output.stdoutTruncated
              ? t("chat.mobile.activity.outputTruncatedHeader")
              : t("chat.mobile.activity.outputHeader")
          }
          value={output.stdout}
          mono
        />
      ) : null}
      {output?.stderr ? (
        <ToolValue
          label={
            output.stderrTruncated
              ? t("chat.mobile.activity.errorsTruncatedHeader")
              : t("chat.mobile.activity.errorsHeader")
          }
          value={output.stderr}
          mono
        />
      ) : null}
      {files.length ? <CodeExecutionFiles files={files} /> : null}
    </View>
  );
}

function ToolValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: unknown;
  mono?: boolean;
}) {
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
        {label}
      </Text>
      <Text
        selectable
        style={[
          styles.toolValueText,
          { color: colors.foreground, fontFamily: mono ? fonts.mono : fonts.sansRegular },
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

/** A reasoning step among tool steps: one line until opened. */
function ThoughtStep({
  part,
  expandByDefault,
}: {
  part: ReasoningPart;
  expandByDefault: boolean;
}) {
  const { colors, fonts } = useTheme();
  const { t } = useTranslation();
  const [toggled, setToggled] = useLayoutState<boolean | null>(null);
  const open = toggled ?? expandByDefault;
  const label = part.state === "streaming" ? t("chat.activity.thinking") : t("chat.activity.thought");
  const preview = agentThoughtPreview(part.text);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={preview || undefined}
        accessibilityState={{ expanded: open }}
        onPress={() => setToggled(!open)}
        hitSlop={6}
        style={({ pressed }) => [styles.thoughtHeader, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={styles.thoughtTitle}>
          <Text
            style={[
              styles.thoughtLabel,
              { color: colors.foreground, fontFamily: fonts.sansMedium },
            ]}
          >
            {label}
          </Text>
          {!open && !!preview && (
            <Text
              numberOfLines={1}
              style={[
                styles.thoughtPreview,
                { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
              ]}
            >
              {preview}
            </Text>
          )}
        </View>
        <Feather
          name={open ? "chevron-down" : "chevron-right"}
          size={13}
          color={colors.mutedForeground}
        />
      </Pressable>
      {open ? (
        <View style={styles.thoughtBody}>
          <ThinkingContent content={part.text} />
        </View>
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
  const { t } = useTranslation();
  const [showAll, setShowAll] = useLayoutState(false);
  const query = part.input?.query?.trim();
  const results = webSearchResults(part.output);
  const provider = webSearchProviderLabel(part.output, t);
  const hasAnswer =
    part.output !== undefined &&
    !Array.isArray(part.output) &&
    Boolean(part.output.answer);
  const visible = showAll ? results : results.slice(0, RESULTS_PREVIEW);
  const hidden = results.length - visible.length;

  function toggleShowAll() {
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
          {query || t("common.states.searching")}
        </Text>
        {part.state === "output-available" ? (
          <Text
            style={[
              styles.metaText,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {results.length > 0
              ? t("chat.activity.results", { count: results.length })
              : hasAnswer
                ? t("chat.activity.answer")
                : t("chat.activity.noResults")}
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
                {showAll ? t("common.actions.showLess") : t("common.actions.showCountMore", { count: hidden })}
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
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const cookie = useAuthCookie();
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
          {domain ? t("chat.activity.readDomain", { domain }) : t("chat.activity.readPage")}
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
    const source = cookie ? {
      uri: `${getApiBase()}${page.uploadUrl}`,
      headers: { Cookie: cookie },
    } : undefined;
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
          {t("chat.activity.image")}
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
        {page?.title ?? (running ? t("chat.activity.readingEllipsis") : domain)}
      </Text>
      {page ? (
        <Text
          style={[
            styles.resultDomain,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          {t("chat.activity.wordCount", { count: page.wordCount.toLocaleString(locale) })}
        </Text>
      ) : null}
    </Pressable>
  );
}

function gmailShortDate(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/**
 * A Gmail tool call: senders and subjects, never message bodies. A saved
 * draft is not a step; it shows as its own card.
 */
function GmailStep({ part }: { part: GmailToolPart }) {
  const { colors, fonts } = useTheme();
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const [showAll, setShowAll] = useLayoutState(false);
  const display = describeGmailToolPart(part, t);
  const visible = showAll
    ? display.rows
    : display.rows.slice(0, RESULTS_PREVIEW);
  const hidden = display.rows.length - visible.length;
  const muted = { color: colors.mutedForeground, fontFamily: fonts.sansRegular };
  const running = display.status === "running";

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
          {display.detail ?? (running ? `${display.title}…` : display.title)}
        </Text>
        <Text style={[styles.metaText, muted]}>
          {display.status === "error"
            ? t("chat.steps.failed")
            : running
              ? display.detail
                ? `${display.title}…`
                : ""
              : display.note}
        </Text>
      </View>
      {display.error ? (
        <Text
          style={[
            styles.errorText,
            { color: colors.destructive, fontFamily: fonts.sansRegular },
          ]}
        >
          {display.error}
        </Text>
      ) : display.rows.length === 0 ? null : (
        <View
          style={[
            styles.resultList,
            { borderColor: colors.border, backgroundColor: colors.muted },
          ]}
        >
          {visible.map((row, index) => (
            <View
              key={index}
              style={[
                styles.resultRow,
                index > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.gmailSender,
                  {
                    color: colors.foreground,
                    fontFamily: row.unread
                      ? fonts.sansMedium
                      : fonts.sansRegular,
                  },
                ]}
              >
                {row.sender || t("chat.steps.unknownSender")}
              </Text>
              {row.attachments ? (
                <Ionicons
                  name="attach"
                  size={13}
                  color={colors.mutedForeground}
                />
              ) : null}
              <Text
                numberOfLines={1}
                style={[
                  styles.resultTitle,
                  {
                    color: row.unread
                      ? colors.foreground
                      : colors.mutedForeground,
                    fontFamily: fonts.sansRegular,
                  },
                ]}
              >
                {row.subject ?? row.attachments?.join(", ")}
              </Text>
              <Text style={[styles.metaText, muted]}>
                {gmailShortDate(row.date, locale)}
              </Text>
            </View>
          ))}
          {hidden > 0 || showAll ? (
            <Pressable
              onPress={() => setShowAll((shown) => !shown)}
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
                {showAll ? t("common.actions.showLess") : t("common.actions.showCountMore", { count: hidden })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

/**
 * A Google Calendar tool call: the events that were listed, or the one that
 * was added, changed or deleted, with times and titles but never descriptions.
 */
function CalendarStep({ part }: { part: CalendarToolPart }) {
  const { colors, fonts } = useTheme();
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const [showAll, setShowAll] = useLayoutState(false);
  const display = describeCalendarToolPart(part, t);
  const visible = showAll
    ? display.rows
    : display.rows.slice(0, RESULTS_PREVIEW);
  const hidden = display.rows.length - visible.length;
  const muted = { color: colors.mutedForeground, fontFamily: fonts.sansRegular };
  const running = display.status === "running";

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
          {display.detail ?? (running ? `${display.title}…` : display.title)}
        </Text>
        <Text style={[styles.metaText, muted]}>
          {display.status === "error"
            ? t("chat.steps.failed")
            : running
              ? display.detail
                ? `${display.title}…`
                : ""
              : display.note}
        </Text>
      </View>
      {display.error ? (
        <Text
          style={[
            styles.errorText,
            { color: colors.destructive, fontFamily: fonts.sansRegular },
          ]}
        >
          {display.error}
        </Text>
      ) : display.rows.length === 0 ? null : (
        <View
          style={[
            styles.resultList,
            { borderColor: colors.border, backgroundColor: colors.muted },
          ]}
        >
          {visible.map((row, index) => (
            <Pressable
              key={index}
              disabled={!row.href}
              accessibilityRole={row.href ? "link" : undefined}
              accessibilityHint={
                row.href ? t("chat.mobile.activity.opensInGoogleCalendar") : undefined
              }
              onPress={() => {
                if (row.href) Linking.openURL(row.href).catch(() => {});
              }}
              style={({ pressed }) => [
                styles.resultRow,
                index > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                },
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text numberOfLines={1} style={[styles.calendarWhen, muted]}>
                {formatCalendarEventTime(row, locale)}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.resultTitle,
                  {
                    color: row.gone ? colors.mutedForeground : colors.foreground,
                    fontFamily: fonts.sansRegular,
                    textDecorationLine: row.gone ? "line-through" : "none",
                  },
                ]}
              >
                {row.title}
              </Text>
              {row.guests > 0 ? (
                <>
                  <Ionicons
                    name="people-outline"
                    size={13}
                    color={colors.mutedForeground}
                  />
                  <Text style={[styles.metaText, muted]}>{row.guests}</Text>
                </>
              ) : null}
            </Pressable>
          ))}
          {hidden > 0 || showAll ? (
            <Pressable
              onPress={() => setShowAll((shown) => !shown)}
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
                {showAll ? t("common.actions.showLess") : t("common.actions.showCountMore", { count: hidden })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** A model scheduling, changing, listing or deleting the user's tasks. */
function ScheduledTaskStep({ part }: { part: ScheduledTaskToolPart }) {
  const { colors, fonts } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.searchStep}>
      <Text
        style={[
          styles.stepTitle,
          { color: colors.foreground, fontFamily: fonts.sansMedium },
        ]}
      >
        {scheduledTaskActivityLabel(part, !isToolSettled(part), t)}
      </Text>
      {part.state === "output-error" && part.errorText ? (
        <Text
          style={[
            styles.metaText,
            { color: colors.destructive, fontFamily: fonts.sansRegular },
          ]}
        >
          {part.errorText}
        </Text>
      ) : null}
    </View>
  );
}

/** A model reading a skill's instructions before using it. */
function SkillStep({ part }: { part: ViewSkillToolPart }) {
  const { colors, fonts } = useTheme();
  const { t } = useTranslation();
  const note =
    part.state === "output-error"
      ? part.errorText
      : typeof part.output === "string" && part.output.startsWith("Error:")
        ? part.output.slice(7)
        : undefined;
  return (
    <View style={styles.searchStep}>
      <Text
        style={[
          styles.stepTitle,
          { color: colors.foreground, fontFamily: fonts.sansMedium },
        ]}
      >
        {viewSkillActivityLabel(part, !isToolSettled(part), t)}
      </Text>
      {note ? (
        <Text
          style={[
            styles.metaText,
            {
              color:
                part.state === "output-error"
                  ? colors.destructive
                  : colors.mutedForeground,
              fontFamily: fonts.sansRegular,
            },
          ]}
        >
          {note}
        </Text>
      ) : null}
    </View>
  );
}

function ReadFileStep({ part }: { part: ReadFilePart }) {
  const { colors, fonts } = useTheme();
  const { t } = useTranslation();
  const output = part.output;
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
          {output?.file ?? part.input?.file ?? t("chat.activity.fileFallback")}
        </Text>
        <Text
          style={[
            styles.metaText,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          {part.state === "output-error"
            ? t("chat.activity.failed")
            : output
              ? readFileRangeLabel(output, t)
              : t("chat.activity.readingEllipsis")}
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
      ) : null}
    </View>
  );
}

function SearchFilesStep({ part }: { part: SearchFilesPart }) {
  const { colors, fonts } = useTheme();
  const { t } = useTranslation();
  const query = part.input?.query?.trim();
  const output = part.output;
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
          {query || t("chat.activity.searchingFilesEllipsis")}
        </Text>
        {output ? (
          <Text
            style={[
              styles.metaText,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {output.totalMatches === 0
              ? t("chat.activity.noMatches")
              : t("chat.activity.matches", {
                  count: output.totalMatches,
                  formattedCount: String(output.totalMatches),
                })}
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
      ) : output && output.matches.length > 0 ? (
        <View
          style={[
            styles.resultList,
            { borderColor: colors.border, backgroundColor: colors.muted },
          ]}
        >
          {output.matches.map((match, i) => (
            <View
              key={i}
              style={[
                styles.matchRow,
                i > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.resultTitle,
                  { color: colors.foreground, fontFamily: fonts.sansMedium },
                ]}
              >
                {match.file}
              </Text>
              <Text
                numberOfLines={2}
                style={[
                  styles.metaText,
                  { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                ]}
              >
                {match.snippet}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
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

function activeLabel(last: ActivityPart | undefined, t: TFunction): string {
  if (!last) return t("common.states.working");
  if (last.type === "tool-web_search") {
    const query = last.input?.query?.trim();
    return query
      ? t("chat.activity.searchingQuery", { query })
      : t("chat.activity.searchingWeb");
  }
  if (last.type === "tool-fetch_url") {
    const url = last.input?.url;
    return url
      ? t("chat.activity.readingDomain", { domain: cleanDomain(url) })
      : t("chat.activity.readingPage");
  }
  if (isReadFilePart(last)) {
    const file = last.input?.file;
    return file
      ? t("chat.activity.readingNamedFile", { file })
      : t("chat.activity.readingFile");
  }
  if (isSearchFilesPart(last)) {
    const query = last.input?.query?.trim();
    return query
      ? t("chat.activity.searchingFilesQuery", { query })
      : t("chat.activity.searchingFilesEllipsis");
  }
  if (isCodeExecutionPart(last)) return t("chat.activity.runningCode");
  if (isGmailToolPart(last)) return gmailActivityLabel(last, true, t);
  if (isCalendarToolPart(last)) return calendarActivityLabel(last, true, t);
  if (isViewSkillToolPart(last)) return viewSkillActivityLabel(last, true, t);
  if (isScheduledTaskToolPart(last)) {
    return scheduledTaskActivityLabel(last, true, t);
  }
  if (isMcpTool(last)) {
    const parsed = parseMcpToolName(last.toolName);
    return parsed
      ? t("chat.activity.runningMcpServerTool", {
          server: parsed.serverName,
          tool: parsed.toolName,
        })
      : t("chat.activity.runningMcpTool");
  }
  return t("chat.activity.thinking");
}

function settledLabel(
  parts: ActivityPart[],
  duration: number,
  t: TFunction,
): string {
  const lastTool = [...parts].reverse().find(isTool);
  if (lastTool?.type === "tool-web_search") {
    if (lastTool.state === "output-error") return t("chat.activity.webSearchFailed");
    if (lastTool.state === "output-available") return t("chat.activity.searchedWeb");
    return t("chat.activity.webSearchIncomplete");
  }
  if (lastTool?.type === "tool-fetch_url") {
    if (lastTool.state === "output-error") return t("chat.activity.pageFetchFailed");
    if (lastTool.state === "output-available") {
      return isFetchedImage(lastTool.output)
        ? t("chat.activity.viewedImage")
        : t("chat.activity.readPage");
    }
    return t("chat.activity.pageFetchIncomplete");
  }
  if (lastTool && isReadFilePart(lastTool)) {
    if (lastTool.state === "output-error") return t("chat.activity.fileReadFailed");
    if (lastTool.state === "output-available") {
      const file = lastTool.output?.file ?? lastTool.input?.file;
      return file
        ? t("chat.activity.readNamedFile", { file })
        : t("chat.activity.readFile");
    }
    return t("chat.activity.fileReadIncomplete");
  }
  if (lastTool && isSearchFilesPart(lastTool)) {
    if (lastTool.state === "output-error") return t("chat.activity.fileSearchFailed");
    if (lastTool.state === "output-available") return t("chat.activity.searchedFiles");
    return t("chat.activity.fileSearchIncomplete");
  }
  if (lastTool && isCodeExecutionPart(lastTool)) {
    if (lastTool.state === "output-error") return t("chat.activity.codeRunFailed");
    if (lastTool.state !== "output-available") return t("chat.activity.codeRunIncomplete");
    const ok = lastTool.output?.exitCode === 0;
    // Run files show inside the steps, so the summary says they are there.
    const files = parts.filter(isCodeExecutionPart).flatMap(codeExecutionFiles).length;
    if (files > 0) {
      return ok
        ? t("chat.activity.ranCodeWithFiles", { count: files })
        : t("chat.activity.codeEndedWithErrorWithFiles", { count: files });
    }
    return ok ? t("chat.activity.ranCode") : t("chat.activity.codeEndedWithError");
  }
  if (lastTool && isGmailToolPart(lastTool)) {
    return gmailActivityLabel(lastTool, false, t);
  }
  if (lastTool && isCalendarToolPart(lastTool)) {
    return calendarActivityLabel(lastTool, false, t);
  }
  if (lastTool && isViewSkillToolPart(lastTool)) {
    return viewSkillActivityLabel(lastTool, false, t);
  }
  if (lastTool && isScheduledTaskToolPart(lastTool)) {
    return scheduledTaskActivityLabel(lastTool, false, t);
  }
  if (lastTool && isMcpTool(lastTool)) {
    const parsed = parseMcpToolName(lastTool.toolName);
    const label = parsed ? `${parsed.serverName} · ${parsed.toolName}` : null;
    if (lastTool.state === "output-error") {
      return label
        ? t("chat.activity.mcpNamedFailed", { label })
        : t("chat.activity.mcpToolFailed");
    }
    if (lastTool.state === "output-available") {
      return label
        ? t("chat.activity.mcpNamedUsed", { label })
        : t("chat.activity.mcpToolUsed");
    }
    return label
      ? t("chat.activity.mcpNamedIncomplete", { label })
      : t("chat.activity.mcpToolIncomplete");
  }
  return duration > 0
    ? t("chat.activity.thoughtForSeconds", { duration })
    : t("chat.activity.thoughts");
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
  thoughtHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 20,
  },
  thoughtTitle: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  thoughtLabel: { flexShrink: 0, fontSize: 13 },
  thoughtPreview: { flex: 1, minWidth: 0, fontSize: 12 },
  thoughtBody: { paddingTop: 6 },

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
  gmailSender: { width: "32%", flexShrink: 0, fontSize: 13 },
  calendarWhen: { width: "44%", flexShrink: 0, fontSize: 12 },
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
  matchRow: { gap: 2, paddingHorizontal: 10, paddingVertical: 8 },

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
});
