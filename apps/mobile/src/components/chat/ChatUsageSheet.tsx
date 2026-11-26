import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { forwardRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ContextMeterValues } from "@overtchat/shared/context-meter";
import { formatNanoUsd, type UsageTotals } from "@overtchat/shared/usage";
import { ContextRing, useContextTone } from "@/components/ui/ContextRing";
import type { ChatUsageSummary } from "@/lib/chat/useChatUsageSummary";
import { useTheme } from "@/lib/theme";

export type ChatUsageSheetRef = BottomSheetModal;

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString();
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
  const { t } = useTranslation();
  const tone = useContextTone(values);
  const known = values.percentage !== undefined;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <ContextRing values={values} size={40} />
        <View style={styles.sectionCopy}>
          <Text
            accessibilityRole="header"
            style={[
              styles.sectionTitle,
              {
                color: known ? tone : colors.popoverForeground,
                fontFamily: fonts.sansSemiBold,
              },
            ]}
          >
            {known ? t("chat.usage.percentUsed", { percentage: values.percentage }) : t("chat.usage.limitUnknown")}
          </Text>
          <Text
            style={[
              styles.sectionSummary,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {known
              ? t("chat.mobile.usage.measuredAtLastResponse")
              : t("chat.mobile.usage.noContextWindowReported")}
          </Text>
        </View>
      </View>
      <DetailRow
        label={t("chat.mobile.usage.used")}
        value={t("chat.usage.tokensCount", { count: formatInteger(values.usedTokens) })}
      />
      {values.remainingTokens !== undefined && (
        <DetailRow
          label={t("chat.mobile.usage.remaining")}
          value={t("chat.usage.tokensCount", { count: formatInteger(values.remainingTokens) })}
        />
      )}
      {values.contextWindow !== undefined && (
        <DetailRow
          label={t("chat.mobile.usage.contextWindow")}
          value={t("chat.usage.tokensCount", { count: formatInteger(values.contextWindow) })}
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
  const { t } = useTranslation();
  const partial = usage.pricedGenerations < usage.generations;
  const cost = formatNanoUsd(usage.totalCostNanoUsd);
  return (
    <View
      style={[
        styles.section,
        divider && [styles.divider, { borderColor: colors.border }],
      ]}
    >
      <View style={styles.sectionHeader}>
        <View style={styles.sectionCopy}>
          <Text
            accessibilityRole="header"
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
            {partial ? t("chat.usage.knownCost") : t("chat.usage.cost")}
          </Text>
        </View>
      </View>
      <DetailRow label={t("chat.usage.input")} value={formatInteger(usage.inputTokens)} />
      <DetailRow label={t("chat.usage.output")} value={formatInteger(usage.outputTokens)} />
      {usage.cacheReadTokens > 0 && (
        <DetailRow
          label={t("chat.usage.cacheRead")}
          value={formatInteger(usage.cacheReadTokens)}
        />
      )}
      {usage.cacheWriteTokens > 0 && (
        <DetailRow
          label={t("chat.usage.cacheWrite")}
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
          {t("chat.mobile.usage.partialPricingNote", {
            priced: formatInteger(usage.pricedGenerations),
            total: formatInteger(usage.generations),
          })}
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
  const { t } = useTranslation();
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
          accessibilityRole="header"
          style={[
            styles.title,
            { color: colors.popoverForeground, fontFamily: fonts.serifSemiBold },
          ]}
        >
          {t("chat.usage.title")}
        </Text>
        {context && <ContextSection values={context} />}
        {session && (
          <CostSection
            title={t("chat.usage.session")}
            summary={t("chat.usage.tokensCount", { count: formatInteger(session.totalTokens) })}
            usage={session}
            divider={!!context}
          />
        )}
        {images && (
          <CostSection
            title={t("chat.usage.images")}
            summary={t("chat.usage.imageCount", {
              count: images.generations,
              formattedCount: formatInteger(images.generations),
            })}
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
            {t("chat.mobile.usage.empty")}
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
