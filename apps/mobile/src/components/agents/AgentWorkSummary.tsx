import { useEffect } from "react";
import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { agentWorkLabel } from "@overtchat/shared/agent-presentation";
import { useTheme } from "@/lib/theme";
import { AgentText } from "./AgentPrimitives";

export function AgentWorkSummary({ expanded, durationMs, onPress }: {
  expanded: boolean;
  durationMs: number | null;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const rotation = useSharedValue(expanded ? 90 : 0);
  useEffect(() => {
    rotation.value = withTiming(expanded ? 90 : 0, { duration: 180, reduceMotion: ReduceMotion.System });
  }, [expanded, rotation]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  const label = agentWorkLabel(durationMs);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6,
        paddingHorizontal: 4, paddingBottom: 4, borderBottomWidth: 1,
        borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1,
      })}
    >
      <AgentText muted>{label}</AgentText>
      <Animated.View style={style} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
      </Animated.View>
    </Pressable>
  );
}
