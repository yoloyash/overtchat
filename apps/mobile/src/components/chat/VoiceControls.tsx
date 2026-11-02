import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { ErrorNotice } from "@/components/ErrorNotice";
import { useTheme } from "@/lib/theme";
import type { VoiceState } from "@/lib/voice/session";
import type { MobileVoiceController } from "@/lib/voice/useMobileVoice";

const SPECTRUM_WEIGHTS = [0.48, 0.76, 1, 0.82, 0.58, 0.88, 0.52] as const;
const THINKING_HEIGHTS = [0.42, 0.78, 0.55, 0.92, 0.48, 0.84, 0.38] as const;

export function VoiceControls({
  voice,
  modelLabel,
}: {
  voice: Pick<
    MobileVoiceController,
    | "status"
    | "muted"
    | "error"
    | "warning"
    | "inputLevel"
    | "outputLevel"
    | "pendingText"
    | "toggleMute"
    | "interrupt"
    | "dismissWarning"
  >;
  modelLabel?: string;
}) {
  const { colors, radii, fonts } = useTheme();
  const connected =
    voice.status !== "connecting" &&
    voice.status !== "ending" &&
    voice.status !== "idle" &&
    voice.status !== "closed" &&
    !voice.error;
  const canInterrupt =
    connected &&
    (voice.status === "assistant-speaking" || voice.status === "thinking");
  const statusLabel =
    voice.status === "connecting"
      ? "Connecting"
      : voice.status === "user-speaking"
        ? "Listening to you"
        : voice.status === "thinking"
          ? "Thinking"
          : voice.status === "assistant-speaking"
            ? "Speaking"
            : voice.status === "ending"
              ? "Ending"
              : voice.status === "closed" || voice.status === "idle"
                ? "Ended"
                : "Listening";
  const subtitle = voice.error
    ? "End the session and try again"
    : `${modelLabel ? `${modelLabel} · ` : ""}${voice.muted ? "Microphone muted" : "Realtime voice"}`;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: radii.xxl,
        },
      ]}
    >
      {voice.pendingText ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.submissionRow, { borderBottomColor: colors.border }]}
        >
          <Text
            numberOfLines={2}
            ellipsizeMode="tail"
            style={[
              styles.submissionText,
              { color: colors.foreground, fontFamily: fonts.sansRegular },
            ]}
          >
            {voice.pendingText}
          </Text>
          <Text
            style={[
              styles.submissionStatus,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            Sending…
          </Text>
        </View>
      ) : null}

      <View style={styles.mainRow}>
        <VoiceOrb
          status={voice.status}
          inputLevel={voice.inputLevel}
          outputLevel={voice.outputLevel}
          muted={voice.muted}
          error={Boolean(voice.error)}
        />

        <View style={styles.copy}>
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.statusText,
              { color: colors.foreground, fontFamily: fonts.sansMedium },
            ]}
          >
            {voice.error ?? statusLabel}
          </Text>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[
              styles.subtitleText,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {subtitle}
          </Text>
          {voice.warning ? (
            <View style={styles.warningWrap}>
              <ErrorNotice
                message={voice.warning}
                onDismiss={voice.dismissWarning}
              />
            </View>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              voice.muted ? "Unmute microphone" : "Mute microphone"
            }
            accessibilityState={{ disabled: !connected }}
            disabled={!connected}
            onPress={voice.toggleMute}
            style={({ pressed }) => [
              styles.actionHitTarget,
              { opacity: !connected ? 0.4 : pressed ? 0.75 : 1 },
            ]}
          >
            <View
              style={[
                styles.actionSurface,
                {
                  backgroundColor: voice.muted
                    ? colors.secondary
                    : "transparent",
                  borderRadius: radii.pill,
                },
              ]}
            >
              <Ionicons
                name={voice.muted ? "mic-off-outline" : "mic-outline"}
                size={20}
                color={colors.foreground}
              />
            </View>
          </Pressable>

          {canInterrupt ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop assistant"
              onPress={voice.interrupt}
              style={({ pressed }) => [
                styles.actionHitTarget,
                { opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <View
                style={[
                  styles.actionSurface,
                  {
                    backgroundColor: colors.secondary,
                    borderRadius: radii.pill,
                  },
                ]}
              >
                <Ionicons
                  name="stop"
                  size={14}
                  color={colors.secondaryForeground}
                />
              </View>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function VoiceOrb({
  status,
  inputLevel,
  outputLevel,
  muted,
  error,
}: {
  status: VoiceState["status"];
  inputLevel: number;
  outputLevel: number;
  muted: boolean;
  error: boolean;
}) {
  const { colors, scheme } = useTheme();
  const [reduceMotion, setReduceMotion] = useState(false);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const breatheAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!AccessibilityInfo?.isReduceMotionEnabled) return;
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(Boolean(enabled));
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      (enabled) => setReduceMotion(Boolean(enabled)),
    );
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);

  const halted =
    reduceMotion ||
    error ||
    status === "ending" ||
    status === "closed" ||
    status === "idle";
  const pulseMode =
    !error && (status === "thinking" || status === "connecting");

  useEffect(() => {
    spinAnim.stopAnimation();
    spinAnim.setValue(0);
    if (halted) return;
    const loop = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: pulseMode ? 2400 : 10000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [halted, pulseMode, spinAnim]);

  useEffect(() => {
    breatheAnim.stopAnimation();
    breatheAnim.setValue(0);
    if (halted) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breatheAnim, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breatheAnim, halted]);

  const measuredLevel =
    status === "assistant-speaking"
      ? Math.min(1, Math.max(0, outputLevel))
      : muted
        ? 0
        // Both native engines already normalize microphone levels to 0–1.
        : Math.min(1, Math.max(0, inputLevel));
  const level = Math.max(
    measuredLevel,
    status === "user-speaking" || status === "assistant-speaking" ? 0.08 : 0,
  );
  const voiceColor = error
    ? colors.destructive
    : status === "thinking"
      ? scheme === "dark"
        ? "#fbbf24"
        : "#d97706"
      : colors.primary;
  const coreForeground =
    error || status === "thinking" ? "#ffffff" : colors.primaryForeground;

  const rotation = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const innerScale = breatheAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1 + level * 0.05, 1.045 + level * 0.07],
  });

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.orb, { opacity: muted ? 0.72 : 1 }]}
    >
      <View
        style={[
          styles.orbAmbient,
          {
            backgroundColor: voiceColor,
            opacity: (muted ? 0.08 : 0.14) + level * 0.22,
            transform: [{ scale: 1 + level * 0.12 }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.orbOrbit,
          { transform: [{ rotate: halted ? "0deg" : rotation }] },
        ]}
      >
        <Svg width={72} height={72} viewBox="0 0 72 72">
          <Circle
            cx={36}
            cy={36}
            r={33}
            stroke={voiceColor}
            strokeWidth={1.5}
            strokeOpacity={muted ? 0.28 : 0.62}
            strokeDasharray="46 34 26 98"
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
        <View
          style={[
            styles.orbSatellite,
            {
              backgroundColor: voiceColor,
              opacity: muted ? 0.45 : 0.9,
            },
          ]}
        />
      </Animated.View>
      <View
        style={[
          styles.orbRingOuter,
          {
            borderColor: voiceColor,
            opacity: (muted ? 0.16 : 0.24) + level * 0.46,
            transform: [{ scale: 1 + level * 0.12 }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.orbRingInner,
          {
            borderColor: voiceColor,
            opacity: (muted ? 0.26 : 0.4) + level * 0.4,
            transform: [{ scale: halted ? 1 : innerScale }],
          },
        ]}
      />
      <View
        style={[
          styles.orbCore,
          {
            backgroundColor: voiceColor,
            borderColor: colors.border,
            transform: [{ scale: 1 + level * 0.08 }],
          },
        ]}
      >
        <View style={styles.orbSurfaceHighlight} />
        <View style={styles.orbSpectrum}>
          {SPECTRUM_WEIGHTS.map((weight, index) => {
            const barLevel = pulseMode
              ? THINKING_HEIGHTS[index]
              : Math.max(0.08, level) * weight;
            return (
              <View
                key={index}
                style={[
                  styles.orbBar,
                  {
                    height: 3 + barLevel * 17,
                    backgroundColor: coreForeground,
                    opacity: pulseMode ? 0.78 : 0.9,
                  },
                ]}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  submissionRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 2,
  },
  submissionText: {
    fontSize: 14,
    lineHeight: 20,
  },
  submissionStatus: {
    fontSize: 12,
    lineHeight: 16,
  },
  mainRow: {
    minHeight: 96,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  statusText: {
    fontSize: 14,
    lineHeight: 20,
  },
  subtitleText: {
    fontSize: 12,
    lineHeight: 16,
  },
  warningWrap: {
    marginTop: 6,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  actionHitTarget: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  actionSurface: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  orb: {
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  orbAmbient: {
    position: "absolute",
    width: 68,
    height: 68,
    borderRadius: 999,
  },
  orbOrbit: {
    position: "absolute",
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  orbSatellite: {
    position: "absolute",
    top: 1,
    width: 4.5,
    height: 4.5,
    borderRadius: 999,
  },
  orbRingOuter: {
    position: "absolute",
    width: 62,
    height: 62,
    borderRadius: 999,
    borderWidth: 1,
  },
  orbRingInner: {
    position: "absolute",
    width: 52,
    height: 52,
    borderRadius: 999,
    borderWidth: 1,
  },
  orbCore: {
    width: 42,
    height: 42,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  orbSurfaceHighlight: {
    position: "absolute",
    top: -6,
    left: -6,
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  orbSpectrum: {
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  orbBar: {
    width: 2,
    minHeight: 4,
    maxHeight: 20,
    borderRadius: 999,
  },
});
