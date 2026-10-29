import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { forwardRef, useCallback, useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { UIMessage } from "ai";
import {
  getContextMeterValues,
  type ContextMeterValues,
} from "@overtchat/shared/context-meter";
import { readMessageStats } from "@overtchat/shared/message-stats";
import type { UsageTotals } from "@overtchat/shared/usage";
import { ContextRing, useContextTone } from "@/components/ui/ContextRing";
import { useChatPreferences } from "@/lib/chatPreferences";
import { useChatUsageTotals } from "@/lib/queries/chatUsage";
import { useTheme } from "@/lib/theme";
import { formatNanoUsd, type ChatUsageSummary } from "./ChatUsageButton";

export type ChatUsageSheetRef = BottomSheetModal;

/**
 * Context usage from the newest assistant message that reported it, plus
 * recorded cost totals for a persisted chat. Honors the device's context-meter
 * and session-cost preferences; `undefined` means there is nothing to show.
 */
export function useChatUsageSummary({
  chatId,
  persisted,
  streaming,
  messages,
  contextWindow,
}: {
  chatId: string;
  persisted: boolean;
  streaming: boolean;
  messages: UIMessage[];
  contextWindow?: number;
}): ChatUsageSummary | undefined {
  const prefs = useChatPreferences();
  const costEnabled = persisted && prefs.sessionCost;
  const totals = useChatUsageTotals(chatId, costEnabled);
  const refetch = totals.refetch;
  useEffect(() => {
    if (!streaming && costEnabled) void refetch();
  }, [streaming, messages.length, costEnabled, refetch]);
  const stats = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.role !== "assistant") continue;
      const read = readMessageStats(message);
      if (read?.contextTokens !== undefined) return read;
    }
    return undefined;
  }, [messages]);
  const context =
    prefs.contextMeter && stats?.contextTokens !== undefined
      ? getContextMeterValues(
          stats.contextTokens,
          contextWindow ?? stats.contextWindow,
        )
      : undefined;
  const session =
    costEnabled && totals.data?.usage.pricedGenerations
      ? totals.data.usage
      : undefined;
  const images =
    costEnabled && totals.data?.images?.pricedGenerations
      ? totals.data.images
      : undefined;
  if (!context && !session && !images) return undefined;
  return { context, session, images };
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatTokens(value: number): string {
  return `${formatInteger(value)} tokens`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const { colors, fonts } = useTheme();
  return (
    <View style={styles.row}>
      <Text
        style={[
          styles.rowLabel,
          { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
        ]}
      >
        {label}
      </Text>
      <Text
        selectable
        style={[
          styles.rowValue,
          { color: colors.popoverForeground, fontFamily: fonts.mono },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function ContextSection({ values }: { values: ContextMeterValues }) {
  const { colors, fonts } = useTheme();
  const tone = useContextTone(values);
  const known = values.percentage !== undefined;
  return (
    <View accessibilityLabel="Context" style={styles.section}>
      <View style={styles.sectionHeader}>
        <ContextRing values={values} size={40} />
        <View style={styles.sectionCopy}>
          <Text
            style={[
              styles.sectionTitle,
              {
                color: known ? tone : colors.popoverForeground,
                fontFamily: fonts.sansSemiBold,
              },
            ]}
          >
            {known ? `${values.percentage}% used` : "Limit unknown"}
          </Text>
          <Text
            style={[
              styles.sectionSummary,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {known
              ? "Measured at the last response."
              : "This model hasn't reported a context window."}
          </Text>
        </View>
      </View>
      <DetailRow label="Used" value={formatTokens(values.usedTokens)} />
      {values.remainingTokens !== undefined && (
        <DetailRow
          label="Remaining"
          value={formatTokens(values.remainingTokens)}
        />
      )}
      {values.contextWindow !== undefined && (
        <DetailRow
          label="Context window"
          value={formatTokens(values.contextWindow)}
        />
      )}
    </View>
  );
}

function CostSection({
  title,
  summary,
  usage,
  divider,
}: {
  title: string;
  summary: string;
  usage: UsageTotals;
  divider: boolean;
}) {
  const { colors, fonts } = useTheme();
  const partial = usage.pricedGenerations < usage.generations;
  const cost = formatNanoUsd(usage.totalCostNanoUsd);
  return (
    <View
      accessibilityLabel={title}
      style={[
        styles.section,
        divider && [styles.divider, { borderColor: colors.border }],
      ]}
    >
      <View style={styles.sectionHeader}>
        <View style={styles.sectionCopy}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.popoverForeground, fontFamily: fonts.sansSemiBold },
            ]}
          >
            {title}
          </Text>
          <Text
            style={[
              styles.sectionSummary,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {summary}
          </Text>
        </View>
        <View style={styles.costColumn}>
          <Text
            selectable
            style={[
              styles.costValue,
              { color: colors.popoverForeground, fontFamily: fonts.mono },
            ]}
          >
            {partial ? `${cost}+` : cost}
          </Text>
          <Text
            style={[
              styles.sectionSummary,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {partial ? "Known cost" : "Cost"}
          </Text>
        </View>
      </View>
      <DetailRow label="Input" value={formatInteger(usage.inputTokens)} />
      <DetailRow label="Output" value={formatInteger(usage.outputTokens)} />
      {usage.cacheReadTokens > 0 && (
        <DetailRow
          label="Cache read"
          value={formatInteger(usage.cacheReadTokens)}
        />
      )}
      {usage.cacheWriteTokens > 0 && (
        <DetailRow
          label="Cache write"
          value={formatInteger(usage.cacheWriteTokens)}
        />
      )}
      {partial && (
        <Text
          style={[
            styles.sectionSummary,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          {`${formatInteger(usage.pricedGenerations)} of ${formatInteger(usage.generations)} generations have pricing. Missing prices are excluded.`}
        </Text>
      )}
    </View>
  );
}

/** Usage details for the open chat, in the same sheet style as the other chat sheets. */
export const ChatUsageSheet = forwardRef<
  ChatUsageSheetRef,
  { usage: ChatUsageSummary | undefined }
>(function ChatUsageSheet({ usage }, ref) {
  const { colors, radii, fonts } = useTheme();
  const insets = useSafeAreaInsets();

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    [],
  );

  const context = usage?.context;
  const session = usage?.session;
  const images = usage?.images;

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      backgroundStyle={{
        backgroundColor: colors.popover,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
      }}
      handleIndicatorStyle={{ backgroundColor: colors.mutedForeground }}
    >
      <BottomSheetView
        style={[styles.body, { paddingBottom: 16 + insets.bottom }]}
      >
        <Text
          style={[
            styles.title,
            { color: colors.popoverForeground, fontFamily: fonts.serifSemiBold },
          ]}
        >
          Usage
        </Text>
        {context && <ContextSection values={context} />}
        {session && (
          <CostSection
            title="Session"
            summary={formatTokens(session.totalTokens)}
            usage={session}
            divider={!!context}
          />
        )}
        {images && (
          <CostSection
            title="Images"
            summary={`${formatInteger(images.generations)} ${images.generations === 1 ? "image" : "images"}`}
            usage={images}
            divider={!!(context || session)}
          />
        )}
        {!context && !session && !images && (
          <Text
            style={[
              styles.sectionSummary,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            No usage has been recorded for this chat yet.
          </Text>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 4, gap: 16 },
  title: { fontSize: 18 },
  section: { gap: 10 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  sectionCopy: { flex: 1, gap: 2 },
  sectionTitle: { fontSize: 16 },
  sectionSummary: { fontSize: 13, lineHeight: 18 },
  costColumn: { alignItems: "flex-end", gap: 2 },
  costValue: { fontSize: 16 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
  },
  rowLabel: { fontSize: 14 },
  rowValue: { fontSize: 14 },
});
