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
import type { PingResponse } from "@overtchat/shared";
import { resetAuthClient } from "@/lib/auth/client";
import { getServerUrl, setServerUrl } from "@/lib/server-url";
import { useTheme } from "@/lib/theme";

const DEFAULT_URL = "http://10.0.0.200:4717";

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`;
  return trimmed;
}

export default function ServerScreen() {
  const { colors, radii, fonts } = useTheme();
  const [url, setUrl] = useState(() => getServerUrl() ?? DEFAULT_URL);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function connect() {
    const target = normalizeUrl(url);
    if (!target) {
      setStatus({ kind: "error", message: "Enter a server URL." });
      return;
    }

    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`${target}/api/ping`);
      if (!res.ok) {
        setStatus({ kind: "error", message: `Server returned ${res.status}.` });
        return;
      }
      const body = (await res.json()) as PingResponse;
      if (!body?.ok || body.name !== "overtchat") {
        setStatus({ kind: "error", message: "That doesn't look like an overtchat server." });
        return;
      }
      setServerUrl(target);
      resetAuthClient();
      setStatus({ kind: "idle" });
      router.push("/login");
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not reach server.",
      });
    }
  }

  const isLoading = status.kind === "loading";

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
                Connect to a server
              </Text>
              <Text
                style={[
                  styles.subtitle,
                  { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                ]}
              >
                Enter the URL of your overtchat instance.
              </Text>
            </View>

            <View style={styles.field}>
              <Text
                style={[styles.label, { color: colors.foreground, fontFamily: fonts.sansMedium }]}
              >
                Server URL
              </Text>
              <TextInput
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="http://10.0.0.200:4717"
                placeholderTextColor={colors.mutedForeground}
                editable={!isLoading}
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

            {status.kind === "error" && (
              <Text
                style={[styles.error, { color: colors.destructive, fontFamily: fonts.sansRegular }]}
              >
                {status.message}
              </Text>
            )}

            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              onPress={connect}
              style={({ pressed }) => [
                styles.cta,
                {
                  backgroundColor: colors.primary,
                  borderRadius: radii.md,
                  opacity: pressed || isLoading ? 0.85 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.ctaText,
                  { color: colors.primaryForeground, fontFamily: fonts.sansSemiBold },
                ]}
              >
                {isLoading ? "Connecting…" : "Connect"}
              </Text>
            </Pressable>
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
  field: { gap: 6 },
  label: { fontSize: 14 },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  error: { fontSize: 14 },
  cta: { paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 15 },
});
