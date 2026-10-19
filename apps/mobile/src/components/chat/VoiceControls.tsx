import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";
import type { useMobileVoice } from "@/lib/voice/useMobileVoice";

export function VoiceControls({ voice }: { voice: ReturnType<typeof useMobileVoice> }) {
  const { colors, radii, fonts } = useTheme();
  const status = voice.status === "connecting" ? "Connecting…"
    : voice.status === "ending" ? "Ending voice…"
    : voice.muted ? "Microphone off"
    : voice.status === "user-speaking" ? "Listening to you"
    : voice.status === "thinking" ? "Thinking…"
    : voice.status === "assistant-speaking" ? "Speaking"
    : "Listening";
  return (
    <View style={[styles.row, { backgroundColor: colors.muted, borderRadius: radii.xl }]}>
      <View style={styles.label}>
        <Text accessibilityLiveRegion="polite" style={{ color: colors.foreground, fontFamily: fonts.sansMedium }}>{status}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Keep this app open to talk</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={voice.muted ? "Unmute voice microphone" : "Mute voice microphone"}
        disabled={voice.status === "connecting" || voice.status === "ending"} onPress={voice.toggleMute} style={styles.button}>
        <Ionicons name={voice.muted ? "mic-off" : "mic"} size={22} color={colors.foreground} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="End voice" onPress={voice.end} style={styles.button}>
        <Ionicons name="call" size={23} color={colors.destructive} />
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({ row: { flexDirection: "row", alignItems: "center", paddingLeft: 14, paddingRight: 4, paddingVertical: 6 }, label: { flex: 1, gap: 3 }, button: { width: 48, height: 48, alignItems: "center", justifyContent: "center" } });
