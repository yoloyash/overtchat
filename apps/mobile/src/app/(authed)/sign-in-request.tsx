import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { SignInDecision } from "@overtchat/shared";
import { getApiBase } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";
import {
  decideSignInRequest,
  markSignInRequestShown,
  useSignInRequests,
} from "@/lib/queries/signInRequests";
import { useTheme } from "@/lib/theme";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Asks whether a sign-in to this account is the user's. They approve it by
 * picking the number the signing-in device shows.
 */
export default function SignInRequestScreen() {
  const { colors, radii, fonts } = useTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const requests = useSignInRequests({ enabled: true });
  // A sign-in that asked again replaced its request; show the newest one.
  const request =
    requests.data?.find((item) => item.id === id) ?? requests.data?.[0];
  const [answering, setAnswering] = useState(false);
  useEffect(() => {
    if (request) markSignInRequestShown(request.id);
  }, [request]);

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace("/(authed)/(drawer)/chat");
  }

  async function answer(decision: SignInDecision) {
    if (!request || answering) return;
    setAnswering(true);
    try {
      const result = await decideSignInRequest(request.id, decision);
      if (result === "approved") {
        toastSuccess("Sign-in approved", request.device);
      } else if (result === "denied") {
        toastSuccess("Sign-in denied", "If this wasn't you, change your password.");
      } else if (result === "mismatch") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        toastError(
          "Sign-in blocked",
          "That number didn't match. If you were signing in, try again; if not, change your password.",
        );
      } else {
        toastError("This request expired");
      }
      close();
    } catch (error) {
      toastError("Couldn't answer the sign-in request", error);
    } finally {
      setAnswering(false);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.signInRequests(getApiBase()),
      });
    }
  }

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <Stack.Screen options={{ title: "Sign-in request" }} />
      {!request ? (
        <View style={styles.center}>
          {requests.isPending ? (
            <ActivityIndicator color={colors.mutedForeground} />
          ) : (
            <>
              <Text
                style={[styles.body, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}
              >
                This sign-in request is no longer waiting. It was answered or expired.
              </Text>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={close}>
                <Text style={[styles.link, { color: colors.primary, fontFamily: fonts.sansMedium }]}>
                  Close
                </Text>
              </Pressable>
            </>
          )}
        </View>
      ) : (
        <View style={styles.content}>
          <View style={styles.header}>
            <Ionicons name="shield-half-outline" size={28} color={colors.primary} />
            <Text
              style={[styles.title, { color: colors.foreground, fontFamily: fonts.serifSemiBold }]}
            >
              Is this you signing in?
            </Text>
            <Text
              style={[styles.body, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}
            >
              {request.device}
              {request.ipAddress ? ` · ${request.ipAddress}` : ""}
            </Text>
          </View>

          <Text style={[styles.prompt, { color: colors.foreground, fontFamily: fonts.sansMedium }]}>
            Pick the number shown on the sign-in screen.
          </Text>
          <View style={styles.choices}>
            {request.choices.map((number) => (
              <Pressable
                key={number}
                accessibilityRole="button"
                accessibilityLabel={`${number}`}
                disabled={answering}
                onPress={() => void answer({ approve: true, number })}
                style={({ pressed }) => [
                  styles.choice,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.muted : colors.card,
                    borderRadius: radii.lg,
                    opacity: answering ? 0.6 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.choiceText, { color: colors.foreground, fontFamily: fonts.mono }]}
                >
                  {number}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={answering}
            onPress={() => void answer({ approve: false })}
            style={({ pressed }) => [
              styles.deny,
              { borderRadius: radii.md, opacity: pressed || answering ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.denyText, { color: colors.destructive, fontFamily: fonts.sansSemiBold }]}>
              No, it&apos;s not me
            </Text>
          </Pressable>
          <Text
            style={[styles.footnote, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}
          >
            If you didn&apos;t just try to sign in, someone may know your password.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  content: { flex: 1, padding: 24, gap: 24 },
  header: { gap: 8 },
  title: { fontSize: 22, letterSpacing: -0.3 },
  body: { fontSize: 15, lineHeight: 21 },
  prompt: { fontSize: 15 },
  choices: { flexDirection: "row", gap: 12 },
  choice: {
    flex: 1,
    aspectRatio: 1.1,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceText: { fontSize: 32 },
  deny: { paddingVertical: 14, alignItems: "center" },
  denyText: { fontSize: 15 },
  footnote: { fontSize: 13, lineHeight: 18, textAlign: "center" },
  link: { fontSize: 15 },
});
