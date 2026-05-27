import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";
import type { useSpeech } from "@/lib/useSpeech";

export function MiniSpeechPlayer({
  speech,
}: {
  speech: ReturnType<typeof useSpeech>;
}) {
  const { colors, fonts, radii } = useTheme();
  const {
    activeId,
    status,
    currentTime,
    duration,
    error,
    pause,
    resume,
    seek,
    stop,
    retry,
  } = speech;

  const active = activeId !== null;
  const visible = active || error !== null;
  if (!visible) return null;

  if (error) {
    return (
      <View style={styles.wrap}>
        <View
          style={[
            styles.row,
            {
              backgroundColor: colors.muted,
              borderColor: colors.destructive,
              borderRadius: radii.xxl,
            },
          ]}
        >
          <Feather name="alert-triangle" size={16} color={colors.destructive} />
          <Text
            numberOfLines={2}
            style={[
              styles.errorText,
              { color: colors.foreground, fontFamily: fonts.sansRegular },
            ]}
          >
            {error}
          </Text>
          <Pressable
            onPress={retry}
            hitSlop={8}
            style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.5 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Feather name="rotate-ccw" size={16} color={colors.foreground} />
          </Pressable>
          <Pressable
            onPress={() => stop()}
            hitSlop={8}
            style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.5 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </View>
    );
  }

  const loading = status === "loading";
  const playing = status === "playing";
  const canSeek = duration > 0;
  const playLabel = loading ? "Loading" : playing ? "Pause" : "Play";

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.row,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: radii.xxl,
          },
        ]}
      >
        <Pressable
          onPress={() => {
            if (loading) return;
            if (playing) pause();
            else resume();
          }}
          hitSlop={8}
          disabled={loading}
          style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.5 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={playLabel}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.foreground} />
          ) : (
            <Feather
              name={playing ? "pause" : "play"}
              size={18}
              color={colors.foreground}
            />
          )}
        </Pressable>

        {canSeek ? (
          <Slider
            style={styles.slider}
            value={currentTime}
            minimumValue={0}
            maximumValue={duration}
            onSlidingComplete={(v) => seek(v)}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.primary}
          />
        ) : (
          <Text
            style={[
              styles.streaming,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {loading ? "Loading…" : "Streaming…"}
          </Text>
        )}

        <Text
          style={[
            styles.time,
            { color: colors.mutedForeground, fontFamily: fonts.mono },
          ]}
        >
          {canSeek ? formatTime(currentTime) : "0:00"}
        </Text>

        <Pressable
          onPress={() => stop()}
          hitSlop={8}
          style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.5 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Close player"
        >
          <Feather name="x" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  slider: {
    flex: 1,
    height: 32,
  },
  streaming: {
    flex: 1,
    fontSize: 12,
    paddingHorizontal: 4,
  },
  time: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    minWidth: 36,
    textAlign: "right",
  },
  errorText: {
    flex: 1,
    fontSize: 13,
  },
});
