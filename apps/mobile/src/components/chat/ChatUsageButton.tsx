import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";
import type { ContextMeterValues } from "@overtchat/shared/context-meter";
import { combinePricedUsage, type UsageTotals } from "@overtchat/shared/usage";
import { ContextRing } from "@/components/ui/ContextRing";
import { useTheme } from "@/lib/theme";

export interface ChatUsageSummary {
  /** Context-window usage measured at the last response. */
  context?: ContextMeterValues;
  /** Chat generations, present when any of them has a recorded price. */
  session?: UsageTotals;
  /** Image operations, present when any of them has a recorded price. */
  images?: UsageTotals;
}

export function formatNanoUsd(nanoUsd: number): string {
  return `$${(Math.max(0, nanoUsd) / 1e9).toFixed(3)}`;
}

/** Opens the usage sheet: the context ring, or a cost glyph without a meter. */
export function ChatUsageButton({
  usage,
  onPress,
}: {
  usage: ChatUsageSummary;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const cost = combinePricedUsage([usage.session, usage.images]);
  const details = [
    usage.context
      ? usage.context.percentage === undefined
        ? "context limit unknown"
        : `${usage.context.percentage}% context used`
      : undefined,
    cost
      ? `${cost.partial ? "known session cost" : "session cost"} ${formatNanoUsd(cost.totalCostNanoUsd)}`
      : undefined,
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Usage: ${details.join("; ")}. Show details`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.hitTarget,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {usage.context ? (
        <ContextRing values={usage.context} />
      ) : (
        <Ionicons name="cash-outline" size={20} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hitTarget: {
    width: 44,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
