import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { formatAgentElapsed } from "@/lib/agents/transcript";
import { useTheme } from "@/lib/theme";

export function AgentWorkingIndicator({
  label = "Agent working",
}: {
  label?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 18,
        height: 18,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <ActivityIndicator
        accessibilityLabel={label}
        accessibilityRole="progressbar"
        size="small"
        color={colors.foreground}
        style={{ transform: [{ scale: 0.75 }] }}
      />
    </View>
  );
}

function useElapsed(startedAt: number | null | undefined) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (startedAt == null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt == null ? null : formatAgentElapsed(now - startedAt);
}

/** The transcript's live status line while a turn is in progress. */
export function AgentRunStatus({
  label,
  startedAt,
}: {
  label: string;
  startedAt?: number | null;
}) {
  const { colors, fonts } = useTheme();
  const elapsed = useElapsed(startedAt);
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.45, { duration: 900, reduceMotion: ReduceMotion.System }),
        withTiming(1, { duration: 900, reduceMotion: ReduceMotion.System }),
      ),
      -1,
    );
  }, [opacity]);
  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <View
      accessible
      // Announce the state once; a ticking clock would be re-read every second.
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 }}
    >
      <AgentWorkingIndicator label={label} />
      <Animated.View style={pulse}>
        <Text
          style={{
            color: colors.foreground,
            fontFamily: fonts.sansMedium,
            fontSize: 14,
          }}
        >
          {label}
        </Text>
      </Animated.View>
      {elapsed && (
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: fonts.sansRegular,
            fontSize: 13,
            fontVariant: ["tabular-nums"],
          }}
        >
          {elapsed}
        </Text>
      )}
    </View>
  );
}
