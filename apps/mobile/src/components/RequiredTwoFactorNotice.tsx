import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthClient } from "@/lib/auth/client";
import { useServerUrl } from "@/lib/server-url";
import { useTheme } from "@/lib/theme";

/**
 * Shown instead of the app to administrators who haven't set up two-factor on
 * a server that requires it. Setup happens on the web.
 */
export function RequiredTwoFactorNotice({ onCheckAgain }: { onCheckAgain: () => void }) {
  const { colors, radii, fonts } = useTheme();
  const serverUrl = useServerUrl();
  const session = getAuthClient().useSession();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await getAuthClient().signOut();
      await session.refetch();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radii.xl },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground, fontFamily: fonts.serifSemiBold }]}>
          Set up two-factor authentication
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}>
          This server requires administrators to sign in with a code from an authenticator app,
          as well as their password. Set it up on the web, then come back.
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={!serverUrl}
          onPress={() => {
            if (serverUrl) {
              Linking.openURL(`${serverUrl.replace(/\/$/, "")}/settings/account`).catch(() => {});
            }
          }}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: colors.primary, borderRadius: radii.md, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.ctaText, { color: colors.primaryForeground, fontFamily: fonts.sansSemiBold }]}>
            Set up on the web
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onCheckAgain}>
          <Text style={[styles.link, { color: colors.primary, fontFamily: fonts.sansMedium }]}>
            I&apos;ve set it up
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" hitSlop={8} disabled={signingOut} onPress={signOut}>
          <Text style={[styles.link, { color: colors.mutedForeground, fontFamily: fonts.sansMedium }]}>
            {signingOut ? "Signing out…" : "Sign out"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", paddingHorizontal: 16 },
  card: { padding: 24, borderWidth: StyleSheet.hairlineWidth, gap: 16 },
  title: { fontSize: 20, letterSpacing: -0.3 },
  body: { fontSize: 14, lineHeight: 20 },
  cta: { paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 15 },
  link: { fontSize: 14, textAlign: "center" },
});
