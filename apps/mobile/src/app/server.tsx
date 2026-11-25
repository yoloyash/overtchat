import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { PingResponse } from "@overtchat/shared";
import { parseMobileServerUrl } from "@overtchat/shared/mobile-connection";
import { ServerQrScanner } from "@/components/ServerQrScanner";
import { resetAuthClient } from "@/lib/auth/client";
import { setServerUrl, useServerUrl } from "@/lib/server-url";
import { useTheme } from "@/lib/theme";

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`;
  return trimmed;
}

export default function ServerScreen() {
  const { colors, radii, fonts } = useTheme();
  const { t } = useTranslation();
  const serverUrl = useServerUrl();
  const [url, setUrl] = useState(() => serverUrl ?? "");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [redirectToLogin, setRedirectToLogin] = useState(false);
  const pendingRequest = useRef<AbortController | null>(null);

  useEffect(() => () => {
    const controller = pendingRequest.current;
    pendingRequest.current = null;
    controller?.abort();
  }, []);

  useEffect(() => {
    if (redirectToLogin && serverUrl) router.replace("/login");
  }, [redirectToLogin, serverUrl]);

  async function connect(input = url) {
    if (pendingRequest.current) return;
    if (!input.trim()) {
      setStatus({ kind: "error", message: t("app.mobile.server.errors.emptyUrl") });
      return;
    }

    const target = parseMobileServerUrl(normalizeUrl(input));
    if (!target) {
      setStatus({ kind: "error", message: t("app.mobile.server.errors.invalidUrl") });
      return;
    }
    setStatus({ kind: "loading" });
    const controller = new AbortController();
    pendingRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${target}/api/ping`, {
        credentials: "omit",
        signal: controller.signal,
      });
      if (pendingRequest.current !== controller) return;
      if (controller.signal.aborted) throw new Error("Connection timed out");
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: t("app.mobile.server.errors.httpStatus", { status: res.status }),
        });
        return;
      }
      const body = (await res.json()) as PingResponse;
      if (pendingRequest.current !== controller) return;
      if (controller.signal.aborted) throw new Error("Connection timed out");
      if (!body?.ok || body.name !== "overtchat") {
        setStatus({ kind: "error", message: t("app.mobile.server.errors.notOvertChat") });
        return;
      }
      resetAuthClient();
      setServerUrl(target);
      setStatus({ kind: "idle" });
      setRedirectToLogin(true);
    } catch {
      if (pendingRequest.current !== controller) return;
      setStatus({
        kind: "error",
        message: t("app.mobile.server.errors.unreachable"),
      });
    } finally {
      clearTimeout(timeout);
      if (pendingRequest.current === controller) pendingRequest.current = null;
    }
  }

  const isLoading = status.kind === "loading";

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            {/* eslint-disable-next-line i18next/no-literal-string -- product name */}
            <Text style={[styles.wordmark, { color: colors.foreground, fontFamily: fonts.serifSemiBold }]}>overtchat</Text>
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
                {t("app.mobile.server.title")}
              </Text>
              <Text
                style={[
                  styles.subtitle,
                  { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                ]}
              >
                {t("app.mobile.server.subtitle")}
              </Text>
            </View>

            <View style={styles.field}>
              <Text
                style={[styles.label, { color: colors.foreground, fontFamily: fonts.sansMedium }]}
              >
                {t("app.mobile.server.urlLabel")}
              </Text>
              <TextInput
                value={url}
                onChangeText={(value) => { setUrl(value); setStatus({ kind: "idle" }); }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                // eslint-disable-next-line i18next/no-literal-string -- example server URL
                placeholder="https://chat.example.com"
                accessibilityLabel={t("app.mobile.server.urlLabel")}
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
              onPress={() => void connect()}
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
                {isLoading
                  ? t("app.mobile.server.connecting")
                  : status.kind === "error"
                    ? t("common.mobile.actions.retry")
                    : t("app.mobile.server.connect")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              onPress={() => { Keyboard.dismiss(); setScannerOpen(true); }}
              style={({ pressed }) => [styles.cta, {
                borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
                opacity: pressed || isLoading ? 0.65 : 1,
              }]}
            >
              <Text style={[styles.ctaText, { color: colors.foreground, fontFamily: fonts.sansSemiBold }]}>
                {t("app.mobile.server.scanQrCode")}
              </Text>
            </Pressable>
          </View>

          <View style={styles.flex} />
        </ScrollView>
      </KeyboardAvoidingView>
      {scannerOpen && (
        <ServerQrScanner
          onClose={() => setScannerOpen(false)}
          onScan={(address) => {
            setUrl(address);
            setScannerOpen(false);
            void connect(address);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 40, gap: 32 },
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
