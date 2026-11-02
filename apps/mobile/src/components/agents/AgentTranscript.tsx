import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewProps,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import {
  projectAgentTranscript,
  foldAgentTranscript,
  agentActiveTurnStart,
  agentResponseActions,
  agentWorkLabel,
  describeAgentActivity,
  type AgentRewindCapabilities,
  type AgentTranscriptItem,
} from "@overtchat/shared/agent-presentation";
import type {
  AgentRewindMode,
  AgentRuntimeSnapshot,
} from "@overtchat/agent-bridge";
import { MarkdownBody } from "@/components/chat/MarkdownBody";
import { record, text } from "@/lib/agents/model";
import { createTranscriptStabilizer } from "@/lib/agents/transcript";
import { useTheme } from "@/lib/theme";
import type { useSpeech } from "@/lib/useSpeech";
import { AgentForkMenu } from "./AgentForkMenu";
import { AgentCopyButton, AgentSpeakButton } from "./AgentMessageActions";
import { AgentButton, AgentText } from "./AgentPrimitives";
import {
  AgentActivityGroup,
  AgentCompactionDivider,
  AgentErrorCard,
  AgentNotificationRow,
  AgentPlanCard,
  AgentTaskListCard,
  AgentWorkSummary,
} from "./AgentTranscriptRows";
import { AgentUserMessage } from "./AgentUserMessage";
import { AgentRunStatus } from "./AgentWorkingIndicator";

type Speech = Pick<ReturnType<typeof useSpeech>, "activeId" | "status" | "play">;

const revealWork = FadeIn.duration(160).reduceMotion(ReduceMotion.System);

/** Within this distance of the newest content, the transcript follows it. */
const FOLLOW_THRESHOLD = 24;
/** Offer a way back once the newest content is clearly out of view. */
const JUMP_THRESHOLD = 240;
/**
 * The list is inverted, so offset 0 is the newest content and growth there
 * needs no correction. Native position keeping holds the reader's place when
 * rows are added below it. The configuration stays constant: iOS keeps its
 * anchor from the last update made with position keeping enabled.
 */
const POSITION = { minIndexForVisible: 0 } as const;

/** Reports where each row sits in the list content. */
const CellLayoutContext = createContext<
  ((key: string, y: number, height: number) => void) | null
>(null);

function TranscriptCell({
  cellKey,
  onLayout,
  ...props
}: ViewProps & { cellKey: string }) {
  const report = useContext(CellLayoutContext);
  return (
    <View
      {...props}
      testID={`agent-transcript-cell:${cellKey}`}
      onLayout={(event: LayoutChangeEvent) => {
        const { y, height } = event.nativeEvent.layout;
        report?.(cellKey, y, height);
        onLayout?.(event);
      }}
    />
  );
}

function isUser(item: AgentTranscriptItem | undefined) {
  return item?.type === "message" && record(item.message).role === "user";
}

/** Vertical rhythm between a row and the row before it. */
function rowSpacing(
  item: AgentTranscriptItem,
  previous: AgentTranscriptItem | undefined,
) {
  if (!previous) return 0;
  if (item.type === "activity" && previous.type === "activity") return 0;
  if (item.type === "turn_footer") return 2;
  if (isUser(item)) return 24;
  if (
    item.type === "activity" ||
    previous.type === "activity" ||
    previous.type === "work_summary" ||
    isUser(previous)
  )
    return 10;
  return 18;
}

export function AgentTranscript({
  speech,
  history,
  snapshot,
  question,
  error,
  followSignal = 0,
  onImplementPlan,
  onFork,
  onRewind,
  disabled,
}: {
  speech: ReturnType<typeof useSpeech>;
  history?: {
    hasOlder: boolean;
    loading: boolean;
    error?: string;
    load: () => void;
  };
  snapshot: AgentRuntimeSnapshot;
  question?: React.ReactElement;
  /** A session-level failure, shown after the transcript. */
  error?: string;
  /** Changing this value returns the transcript to the newest content. */
  followSignal?: number;
  onImplementPlan: (plan: string) => void;
  onFork?: (messageId: string, chooseWorkspace: boolean) => Promise<void>;
  onRewind?: (messageId: string, mode: AgentRewindMode) => Promise<void>;
  disabled: boolean;
}) {
  const { colors, fonts } = useTheme();
  const [expandedTurns, setExpandedTurns] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const projectedItems = useMemo(
    () => projectAgentTranscript(snapshot.messages),
    [snapshot.messages],
  );
  const unsettled =
    snapshot.status !== "idle" ||
    Boolean(
      snapshot.error ||
        snapshot.pendingInteraction ||
        snapshot.state.isCompacting ||
        question,
    );
  const folded = useMemo(
    () =>
      foldAgentTranscript(projectedItems, { unsettled, expanded: expandedTurns }),
    [projectedItems, unsettled, expandedTurns],
  );
  const [stabilize] = useState(createTranscriptStabilizer);
  const items = useMemo(() => stabilize(folded), [stabilize, folded]);
  const responseActions = useMemo(
    () => agentResponseActions(projectedItems, unsettled),
    [projectedItems, unsettled],
  );
  const active = snapshot.status === "running";
  const activeTurnStart = agentActiveTurnStart(items, active);
  // The list is inverted: the newest row is first and sits at the bottom.
  const rows = useMemo(() => [...items].reverse(), [items]);

  // Rows receive stable callbacks; the latest handlers are read when invoked.
  const handlers = useRef({ onImplementPlan, onFork, onRewind, play: speech.play });
  useLayoutEffect(() => {
    handlers.current = { onImplementPlan, onFork, onRewind, play: speech.play };
  });
  const implementPlan = useCallback(
    (plan: string) => handlers.current.onImplementPlan(plan),
    [],
  );
  const fork = useCallback(
    async (messageId: string, chooseWorkspace: boolean) =>
      handlers.current.onFork?.(messageId, chooseWorkspace),
    [],
  );
  const rewind = useCallback(
    async (messageId: string, mode: AgentRewindMode) =>
      handlers.current.onRewind?.(messageId, mode),
    [],
  );
  const play = useCallback(
    (id: string, value: string) => handlers.current.play(id, value),
    [],
  );
  const rowSpeech = useMemo<Speech>(
    () => ({ activeId: speech.activeId, status: speech.status, play }),
    [speech.activeId, speech.status, play],
  );
  // Rows only read the rewind capabilities; keep them referentially stable.
  const { rewindConversation, rewindFiles, rewindBoth } = snapshot.capabilities;
  const capabilities = useMemo<AgentRewindCapabilities>(
    () => ({ rewindConversation, rewindFiles, rewindBoth }),
    [rewindConversation, rewindFiles, rewindBoth],
  );
  const canFork = !!onFork;
  const canRewind = !!onRewind;

  const list = useRef<FlatList<AgentTranscriptItem>>(null);
  const offset = useRef(0);
  // Whether the reader is at the newest content. Only the reader's own
  // scrolling changes this; position keeping and jumps move the list for them.
  const following = useRef(true);
  const userScrolling = useRef(false);
  // Screen readers scroll without drag events, so every scroll is the reader's.
  const screenReader = useRef(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((enabled) => {
        if (mounted) screenReader.current = enabled;
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      (enabled) => {
        screenReader.current = enabled;
      },
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  const dragEnd = useRef<number | null>(null);
  const jumpingUntil = useRef(0);
  const [away, setAway] = useState(false);
  const [disclosing, setDisclosing] = useState(false);
  // Each row's visual top, as a distance from the newest content.
  const cellTops = useRef(new Map<string, number>());
  const disclosure = useRef<{ key: string; top: number; offset: number } | null>(
    null,
  );
  const disclosureTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(
    () => () => {
      clearTimeout(disclosureTimer.current);
      if (dragEnd.current !== null) cancelAnimationFrame(dragEnd.current);
    },
    [],
  );

  // A row that expands or reveals steps keeps its top edge where it was, so
  // new content opens below it. In an inverted list the edge moves when rows
  // below it change or the row itself grows. Following it with an absolute
  // offset also holds when native position keeping already moved the list,
  // and ignores rows measured elsewhere.
  const holdRow = useCallback((key: string) => {
    const top = cellTops.current.get(key);
    disclosure.current =
      top === undefined ? null : { key, top, offset: Math.max(0, offset.current) };
    setDisclosing(true);
    clearTimeout(disclosureTimer.current);
    disclosureTimer.current = setTimeout(() => {
      disclosure.current = null;
      setDisclosing(false);
    }, 600);
  }, []);
  const toggleWork = useCallback(
    (key: string) => {
      holdRow(key);
      setExpandedTurns((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [holdRow],
  );

  const jumpToLatest = useCallback((animated = true) => {
    disclosure.current = null;
    following.current = true;
    jumpingUntil.current = animated ? Date.now() + 600 : 0;
    list.current?.scrollToOffset({ offset: 0, animated });
  }, []);
  useEffect(() => {
    if (followSignal) jumpToLatest();
  }, [followSignal, jumpToLatest]);

  const onScroll = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = nativeEvent.contentOffset.y;
      offset.current = y;
      setAway(y > JUMP_THRESHOLD);
      if (userScrolling.current || screenReader.current) {
        following.current = y <= FOLLOW_THRESHOLD;
        return;
      }
      // Position keeping moved the list for rows added below the reader. When
      // the reader was following the newest content, stay with it.
      if (
        following.current &&
        y > 1 &&
        !disclosure.current &&
        Date.now() > jumpingUntil.current
      )
        list.current?.scrollToOffset({ offset: 0, animated: false });
    },
    [],
  );
  const beginUserScroll = useCallback(() => {
    if (dragEnd.current !== null) cancelAnimationFrame(dragEnd.current);
    dragEnd.current = null;
    userScrolling.current = true;
    disclosure.current = null;
  }, []);
  const endUserScroll = useCallback(() => {
    userScrolling.current = false;
    following.current = offset.current <= FOLLOW_THRESHOLD;
  }, []);
  const onCellLayout = useCallback((key: string, y: number, height: number) => {
    cellTops.current.set(key, y + height);
    const pending = disclosure.current;
    if (pending?.key !== key) return;
    const target = Math.max(0, pending.offset + y + height - pending.top);
    following.current = target <= FOLLOW_THRESHOLD;
    if (Math.abs(target - offset.current) > 1)
      list.current?.scrollToOffset({ offset: target, animated: false });
  }, []);
  const loadOlder = useCallback(() => {
    if (history?.hasOlder && !history.loading && !history.error) history.load();
  }, [history]);

  const trailing = items.at(-1);
  const runningActivity =
    trailing?.type === "activity" &&
    describeAgentActivity(trailing.entries, true).status === "running";
  const runLabel = snapshot.state.isCompacting
    ? "Compacting context"
    : active && !runningActivity
      ? "Working"
      : null;
  const header = (
    <View style={styles.tail}>
      {question}
      {!question && runLabel && (
        <AgentRunStatus
          label={runLabel}
          startedAt={snapshot.activeTurn?.startedAt ?? null}
        />
      )}
      {!!error && <AgentErrorCard error={{ summary: error, details: null }} />}
    </View>
  );
  const footer =
    history && (history.loading || history.error) ? (
      <View style={styles.history}>
        {history.loading ? (
          <ActivityIndicator
            accessibilityLabel="Loading older messages"
            color={colors.mutedForeground}
          />
        ) : (
          <>
            <AgentText muted>{history.error}</AgentText>
            <AgentButton label="Retry" icon="refresh" onPress={history.load} />
          </>
        )}
      </View>
    ) : null;

  const renderItem = useCallback(
    ({ item, index }: { item: AgentTranscriptItem; index: number }) => {
      const position = items.length - 1 - index;
      const actions = responseActions.get(item.key);
      return (
        <Animated.View
          entering={disclosing && item.type === "activity" ? revealWork : undefined}
          style={{ paddingTop: rowSpacing(item, items[position - 1]) }}
        >
          <TranscriptItem
            item={item}
            active={active && index === 0}
            turnActive={position >= activeTurnStart}
            actionText={actions?.text}
            actionMessageId={actions?.messageId ?? null}
            speech={rowSpeech}
            disabled={disabled}
            capabilities={capabilities}
            onToggleWork={toggleWork}
            onHold={holdRow}
            onImplementPlan={implementPlan}
            onFork={canFork ? fork : undefined}
            onRewind={canRewind ? rewind : undefined}
          />
        </Animated.View>
      );
    },
    [
      items,
      responseActions,
      disclosing,
      active,
      activeTurnStart,
      rowSpeech,
      disabled,
      capabilities,
      toggleWork,
      holdRow,
      implementPlan,
      canFork,
      fork,
      canRewind,
      rewind,
    ],
  );

  if (!items.length && !question && !error && !history?.hasOlder && !runLabel)
    return (
      <View style={styles.empty}>
        <Ionicons name="terminal-outline" size={26} color={colors.mutedForeground} />
        <Text
          style={{
            color: colors.foreground,
            fontFamily: fonts.sansSemiBold,
            fontSize: 17,
            textAlign: "center",
          }}
        >
          What would you like to work on?
        </Text>
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: fonts.sansRegular,
            fontSize: 14,
            lineHeight: 20,
            textAlign: "center",
          }}
        >
          Messages run in this workspace on your connected machine.
        </Text>
      </View>
    );

  return (
    <View style={{ flex: 1 }}>
      <CellLayoutContext.Provider value={onCellLayout}>
        <FlatList
          ref={list}
          inverted
          CellRendererComponent={TranscriptCell}
          data={rows}
          extraData={renderItem}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.5}
          maintainVisibleContentPosition={POSITION}
          onScroll={onScroll}
          onScrollBeginDrag={beginUserScroll}
          onScrollEndDrag={() => {
            // Momentum may continue the gesture; decide once it has had a frame to start.
            dragEnd.current = requestAnimationFrame(() => {
              dragEnd.current = null;
              endUserScroll();
            });
          }}
          onMomentumScrollBegin={beginUserScroll}
          onMomentumScrollEnd={() => {
            if (userScrolling.current) endUserScroll();
          }}
          scrollEventThrottle={16}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={11}
          style={{ flex: 1 }}
        />
      </CellLayoutContext.Provider>
      {away && (
        <View pointerEvents="box-none" style={styles.jumpContainer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Jump to latest"
            hitSlop={8}
            onPress={() => jumpToLatest()}
            style={({ pressed }) => [
              styles.jump,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Ionicons name="arrow-down" size={20} color={colors.foreground} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const TranscriptItem = memo(function TranscriptItem({
  item,
  active,
  turnActive,
  actionText,
  actionMessageId,
  speech,
  disabled,
  capabilities,
  onToggleWork,
  onHold,
  onImplementPlan,
  onFork,
  onRewind,
}: {
  item: AgentTranscriptItem;
  /** Only the newest row is live; earlier work in the same turn has settled. */
  active: boolean;
  turnActive: boolean;
  actionText: string | undefined;
  actionMessageId: string | null;
  speech: Speech;
  disabled: boolean;
  capabilities: AgentRewindCapabilities;
  onToggleWork: (key: string) => void;
  /** Keeps this row's top edge in place while it expands. */
  onHold: (key: string) => void;
  onImplementPlan: (plan: string) => void;
  onFork?: (messageId: string, chooseWorkspace: boolean) => Promise<void>;
  onRewind?: (messageId: string, mode: AgentRewindMode) => Promise<void>;
}) {
  const actions =
    actionText === undefined ? null : (
      <ResponseActions
        id={item.key}
        text={actionText}
        messageId={actionMessageId}
        speech={speech}
        disabled={disabled}
        onFork={onFork}
      />
    );
  switch (item.type) {
    case "compaction":
      return <AgentCompactionDivider item={item} />;
    case "work_summary":
      return (
        <AgentWorkSummary
          label={agentWorkLabel(item.durationMs)}
          expanded={item.expanded}
          onPress={() => onToggleWork(item.key)}
        />
      );
    case "assistant_text":
      return (
        <View>
          <MarkdownBody text={item.text} fuzzyLinks={false} />
          {actions}
        </View>
      );
    case "assistant_error":
      return (
        <AgentErrorCard error={item.error} onToggle={() => onHold(item.key)} />
      );
    case "notification":
      return <AgentNotificationRow notification={item.notification} />;
    case "turn_footer":
      return (
        <ResponseFooter
          actions={actions}
          durationMs={item.durationMs}
        />
      );
    case "activity":
      return (
        <AgentActivityGroup
          entries={item.entries}
          active={active}
          onToggle={() => onHold(item.key)}
        />
      );
    case "plan":
      return (
        <AgentPlanCard
          item={item}
          footer={
            !turnActive || item.actionable ? (
              <View style={styles.planFooter}>
                {!turnActive && (
                  <AgentSpeakButton id={item.key} text={item.text} speech={speech} />
                )}
                <View style={{ flex: 1 }} />
                {item.actionable && (
                  <ImplementPlanButton
                    disabled={disabled || turnActive}
                    onPress={() => onImplementPlan(item.text)}
                  />
                )}
              </View>
            ) : undefined
          }
        />
      );
    case "task_list":
      return <AgentTaskListCard snapshot={item.snapshot} />;
    case "message": {
      const message = record(item.message);
      if (message.role === "user")
        return (
          <AgentUserMessage
            message={item.message}
            timestamp={item.timestamp}
            capabilities={capabilities}
            disabled={disabled}
            onRewind={onRewind}
          />
        );
      const body =
        typeof message.content === "string"
          ? message.content
          : Array.isArray(message.content)
            ? message.content
                .map(record)
                .filter((part) => part.type === "text")
                .map((part) => text(part.text))
                .join("\n")
            : "";
      return body ? <MarkdownBody text={body} fuzzyLinks={false} /> : null;
    }
  }
});

function ResponseActions({
  id,
  text: value,
  messageId,
  speech,
  disabled,
  onFork,
}: {
  id: string;
  text: string;
  messageId: string | null;
  speech: Speech;
  disabled: boolean;
  onFork?: (messageId: string, chooseWorkspace: boolean) => Promise<void>;
}) {
  return (
    <View style={styles.actions}>
      {!!value && <AgentCopyButton key={value} text={value} />}
      <AgentSpeakButton id={id} text={value} speech={speech} />
      {messageId && onFork && (
        <AgentForkMenu
          disabled={disabled}
          onFork={(chooseWorkspace) => onFork(messageId, chooseWorkspace)}
        />
      )}
    </View>
  );
}

function ResponseFooter({
  actions,
  durationMs,
}: {
  actions: React.ReactNode;
  durationMs: number | null;
}) {
  const { colors, fonts } = useTheme();
  if (!actions && durationMs === null) return null;
  return (
    <View style={styles.footer}>
      {actions}
      {durationMs !== null && (
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: fonts.sansRegular,
            fontSize: 13,
            fontVariant: ["tabular-nums"],
            paddingHorizontal: 4,
          }}
        >
          {agentWorkLabel(durationMs)}
        </Text>
      )}
    </View>
  );
}

function ImplementPlanButton({
  disabled,
  onPress,
}: {
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors, fonts, radii } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Implement plan"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        borderRadius: radii.pill,
        backgroundColor: colors.primary,
        opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name="play" size={14} color={colors.primaryForeground} />
      <Text
        style={{
          color: colors.primaryForeground,
          fontFamily: fonts.sansMedium,
          fontSize: 14,
        }}
      >
        Implement plan
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 },
  tail: { gap: 12, paddingTop: 12 },
  history: { alignItems: "center", gap: 6, paddingBottom: 16 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginLeft: -6,
    marginTop: 2,
  },
  footer: { flexDirection: "row", alignItems: "center", minHeight: 32 },
  planFooter: { flexDirection: "row", alignItems: "center", marginLeft: -6 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 32,
  },
  jumpContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 12,
    alignItems: "center",
  },
  jump: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
});
