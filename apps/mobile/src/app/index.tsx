import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

export default function WelcomeScreen() {
  const { colors, radii, fonts } = useTheme();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={styles.brand}>
          <Text
            style={[styles.wordmark, { color: colors.foreground, fontFamily: fonts.serifSemiBold }]}
          >
            overtchat
          </Text>
          <Text
            style={[styles.tagline, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}
          >
            Your chat. Your endpoint. Your data.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/server")}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: colors.primary,
              borderRadius: radii.md,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.ctaText,
              { color: colors.primaryForeground, fontFamily: fonts.sansSemiBold },
            ]}
          >
            Get started
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24, paddingVertical: 40, justifyContent: "space-between" },
  brand: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8 },
  wordmark: { fontSize: 32, letterSpacing: -0.5 },
  tagline: { fontSize: 15, textAlign: "center" },
  cta: { paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 16 },
});
