import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthClient } from "@/lib/auth/client";
import { useTheme } from "@/lib/theme";

export default function HomeScreen() {
  const { colors, radii, fonts } = useTheme();
  const authClient = getAuthClient();
  const { data: session, isPending } = authClient.useSession();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await authClient.signOut();
      router.replace("/");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={styles.brand}>
          <Text
            style={[styles.wordmark, { color: colors.foreground, fontFamily: fonts.serifSemiBold }]}
          >
            overtchat
          </Text>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: radii.xl,
            },
          ]}
        >
          <View style={styles.header}>
            <Text
              style={[styles.title, { color: colors.foreground, fontFamily: fonts.serifSemiBold }]}
            >
              You're in
            </Text>
            {isPending ? (
              <ActivityIndicator color={colors.mutedForeground} />
            ) : (
              <Text
                style={[
                  styles.subtitle,
                  { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                ]}
              >
                Signed in as {session?.user.email ?? "—"}
              </Text>
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={signingOut}
            onPress={onSignOut}
            style={({ pressed }) => [
              styles.cta,
              {
                backgroundColor: colors.primary,
                borderRadius: radii.md,
                opacity: pressed || signingOut ? 0.85 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.ctaText,
                { color: colors.primaryForeground, fontFamily: fonts.sansSemiBold },
              ]}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.flex} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 16, paddingVertical: 40, gap: 32 },
  brand: { alignItems: "center" },
  wordmark: { fontSize: 18, letterSpacing: -0.3 },
  card: { padding: 24, borderWidth: StyleSheet.hairlineWidth, gap: 20 },
  header: { gap: 4 },
  title: { fontSize: 20, letterSpacing: -0.3 },
  subtitle: { fontSize: 14 },
  cta: { paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 15 },
});
