import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import { router, type ErrorBoundaryProps } from "expo-router";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

/**
 * Exported as `ErrorBoundary` from layouts so a rendering error replaces one
 * navigator with a recoverable screen instead of terminating the app.
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { colors, radii, fonts } = useTheme();
  const { t } = useTranslation();

  // The boundary stops the error before Sentry's global handler sees it.
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radii.xl },
        ]}
      >
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.foreground, fontFamily: fonts.serifSemiBold }]}
        >
          {t("app.mobile.errorBoundary.title")}
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}>
          {t("app.mobile.errorBoundary.body")}
        </Text>
        {error.message ? (
          <Text
            selectable
            style={[styles.detail, { color: colors.mutedForeground, fontFamily: fonts.mono }]}
          >
            {error.message}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => void retry()}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: colors.primary, borderRadius: radii.md, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.ctaText, { color: colors.primaryForeground, fontFamily: fonts.sansSemiBold }]}>
            {t("common.actions.tryAgain")}
          </Text>
        </Pressable>
        {router.canGoBack() && (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              router.back();
              void retry();
            }}
          >
            <Text style={[styles.link, { color: colors.primary, fontFamily: fonts.sansMedium }]}>
              {t("app.mobile.errorBoundary.goBack")}
            </Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", paddingHorizontal: 16 },
  card: { padding: 24, borderWidth: StyleSheet.hairlineWidth, gap: 16 },
  title: { fontSize: 20, letterSpacing: -0.3 },
  body: { fontSize: 14, lineHeight: 20 },
  detail: { fontSize: 12, lineHeight: 17 },
  cta: { paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 15 },
  link: { fontSize: 14, textAlign: "center" },
});
