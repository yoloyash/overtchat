import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import {
  AGENT_SESSION_STATE_LABELS,
  type AgentSessionState,
} from "@overtchat/shared/agent-attention";
import { useTheme, type Theme } from "@/lib/theme";

export function agentSessionStateLabel(state: AgentSessionState): string {
  return AGENT_SESSION_STATE_LABELS[state];
}

/** The web sidebar's status colours (amber, red, blue, green), per scheme. */
export function agentSessionStateColor(
  state: AgentSessionState,
  theme: Pick<Theme, "colors" | "scheme">,
): string {
  const dark = theme.scheme === "dark";
  switch (state) {
    case "approval":
    case "question":
      return "#f59e0b";
    case "failed":
      return dark ? "#f87171" : "#ef4444";
    case "working":
      return dark ? "#60a5fa" : "#3b82f6";
    case "unread":
      return dark ? "#22c55e" : "#16a34a";
    case "idle":
      return theme.colors.mutedForeground;
  }
}

/**
 * A session's state in the slot before its title. Every state fills the slot,
 * idle with a faint dot, so titles line up whatever their sessions are doing.
 * The row's accessibility label announces the state; the mark is decorative.
 */
export function AgentSessionStatusIcon({
  state,
  size = 12,
}: {
  state: AgentSessionState;
  size?: number;
}) {
  const theme = useTheme();
  const color = agentSessionStateColor(state, theme);
  const box = { width: size, height: size };
  const dot = {
    width: size / 2,
    height: size / 2,
    borderRadius: size,
    backgroundColor: color,
  };
  switch (state) {
    case "approval":
    case "question":
      return (
        <View accessible={false} testID={`agent-state-${state}`} style={[styles.box, box]}>
          <Ionicons name="alert-circle" size={size + 2} color={color} />
        </View>
      );
    case "failed":
      return (
        <View accessible={false} testID="agent-state-failed" style={[styles.box, box]}>
          <Ionicons name="close-circle" size={size + 2} color={color} />
        </View>
      );
    case "working":
      return <AgentWorkingRing size={size} color={color} />;
    case "unread":
      return (
        <View accessible={false} testID="agent-state-unread" style={[styles.box, box]}>
          <View style={dot} />
        </View>
      );
    case "idle":
      return (
        <View accessible={false} testID="agent-state-idle" style={[styles.box, box]}>
          <View style={[dot, { opacity: 0.3 }]} />
        </View>
      );
  }
}

/** A dot with a quarter arc turning around it: the one state that moves. */
function AgentWorkingRing({ size, color }: { size: number; color: string }) {
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.value = withRepeat(
      withTiming(360, {
        duration: 900,
        easing: Easing.linear,
        reduceMotion: ReduceMotion.System,
      }),
      -1,
    );
  }, [turn]);
  const spin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value}deg` }],
  }));
  const ring = { borderRadius: size, borderWidth: 1.5 };
  return (
    <View
      accessible={false}
      testID="agent-state-working"
      style={[styles.box, { width: size, height: size }]}
    >
      <View style={[styles.layer, ring, { borderColor: color, opacity: 0.3 }]} />
      <Animated.View
        style={[
          styles.layer,
          ring,
          { borderColor: "transparent", borderTopColor: color },
          spin,
        ]}
      />
      <View
        style={{
          width: size / 2,
          height: size / 2,
          borderRadius: size,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
});
