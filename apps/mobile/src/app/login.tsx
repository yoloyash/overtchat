import { router } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthClient } from "@/lib/auth/client";
import { useServerUrl } from "@/lib/server-url";
import { useTheme } from "@/lib/theme";

export default function LoginScreen() {
  const { colors, radii, fonts } = useTheme();
  const serverUrl = useServerUrl();
  const authClient = getAuthClient();
  const session = authClient.useSession();
  const serverHost = serverUrl ? safeHost(serverUrl) : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) {
        setError(error.message ?? "Login failed");
        return;
      }
      await session.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
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
                Welcome back
              </Text>
              <Text
                style={[
                  styles.subtitle,
                  { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                ]}
              >
                Sign in to continue.
              </Text>
            </View>

            <View style={styles.fields}>
              <View style={styles.field}>
                <Text
                  style={[styles.label, { color: colors.foreground, fontFamily: fonts.sansMedium }]}
                >
                  Email
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  editable={!submitting}
                  style={[
                    styles.input,
                    {
                      color: colors.foreground,
                      borderColor: colors.input,
                      borderRadius: radii.md,
                      fontFamily: fonts.sansRegular,
                    },
                  ]}
                />
              </View>

              <View style={styles.field}>
                <Text
                  style={[styles.label, { color: colors.foreground, fontFamily: fonts.sansMedium }]}
                >
                  Password
                </Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  textContentType="password"
                  editable={!submitting}
                  style={[
                    styles.input,
                    {
                      color: colors.foreground,
                      borderColor: colors.input,
                      borderRadius: radii.md,
                      fontFamily: fonts.sansRegular,
                    },
                  ]}
                />
              </View>
            </View>

            {error !== "" && (
              <Text
                style={[styles.error, { color: colors.destructive, fontFamily: fonts.sansRegular }]}
              >
                {error}
              </Text>
            )}

            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={onSubmit}
              style={({ pressed }) => [
                styles.cta,
                {
                  backgroundColor: colors.primary,
                  borderRadius: radii.md,
                  opacity: pressed || submitting ? 0.85 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.ctaText,
                  { color: colors.primaryForeground, fontFamily: fonts.sansSemiBold },
                ]}
              >
                {submitting ? "Signing in…" : "Sign in"}
              </Text>
            </Pressable>

            {serverHost ? (
              <View style={styles.serverRow}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.serverText,
                    { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                  ]}
                >
                  Server: {serverHost}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/server")}
                  hitSlop={8}
                >
                  <Text
                    style={[
                      styles.serverLinkText,
                      { color: colors.primary, fontFamily: fonts.sansSemiBold },
                    ]}
                  >
                    Change
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={styles.flex} />
        </View>
      </KeyboardAvoidingView>
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
  fields: { gap: 16 },
  field: { gap: 6 },
  label: { fontSize: 14 },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  error: { fontSize: 14 },
  cta: { paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 15 },
  serverRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  serverText: { flex: 1, fontSize: 13 },
  serverLinkText: { fontSize: 13 },
});

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
