import { useEffect, useEffectEvent, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  SIGN_IN_APPROVAL_ENDED,
  twoFactorErrorMessage,
  twoFactorSignInExpired,
  waitForSignInApproval,
  type SignInApprovalState,
} from "@overtchat/shared";
import { getAuthClient } from "@/lib/auth/client";
import { useTheme } from "@/lib/theme";

type ApprovalView =
  | { step: "sending" }
  | { step: "waiting"; number: number }
  | { step: "verifying"; number: number }
  | { step: "ended"; message: string };

/**
 * Asks the user's signed-in devices to approve this sign-in, shows the number
 * to pick there, and finishes signing in once one of them does.
 */
export function SignInApprovalStep({
  onApproved,
  onRestart,
  onUnavailable,
}: {
  onApproved: () => void | Promise<void>;
  /** The pending sign-in ended; the password has to be entered again. */
  onRestart: (message: string) => void;
  /** Approval can't be used for this sign-in; fall back to a code. */
  onUnavailable: (message: string) => void;
}) {
  const { colors, radii, fonts } = useTheme();
  const [view, setView] = useState<ApprovalView>({ step: "sending" });
  const [attempt, setAttempt] = useState(0);
  const approved = useEffectEvent(() => onApproved());
  const restart = useEffectEvent((message: string) => onRestart(message));
  const unavailable = useEffectEvent((message: string) => onUnavailable(message));

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const authClient = getAuthClient();

    async function run() {
      const sent = await authClient.twoFactor.sendOtp({}, { signal });
      if (signal.aborted) return;
      if (sent.error) {
        if (twoFactorSignInExpired(sent.error)) restart(twoFactorErrorMessage(sent.error));
        else unavailable(twoFactorErrorMessage(sent.error));
        return;
      }
      let number = 0;
      const answer = await waitForSignInApproval({
        signal,
        onPending: (state) => {
          number = state.number;
          setView({ step: "waiting", number });
        },
        read: async (wait) => {
          const { data, error } = await authClient.$fetch<SignInApprovalState>(
            "/two-factor/approval",
            { method: "GET", query: wait ? { wait: "1" } : {}, signal },
          );
          if (error) {
            // The pending sign-in itself ended; sending again restarts it.
            if (twoFactorSignInExpired(error as { code?: string })) {
              return { status: "expired" } as const;
            }
            throw new Error(error.message ?? `HTTP ${error.status}`);
          }
          return data;
        },
      });
      if (answer.status !== "approved") {
        setView({ step: "ended", message: SIGN_IN_APPROVAL_ENDED[answer.status] });
        return;
      }
      setView({ step: "verifying", number });
      const { error } = await authClient.twoFactor.verifyOtp({ code: answer.code });
      if (signal.aborted) return;
      if (error) {
        if (twoFactorSignInExpired(error)) restart(twoFactorErrorMessage(error));
        else setView({ step: "ended", message: twoFactorErrorMessage(error) });
        return;
      }
      await approved();
    }

    // Start on the next tick: a mount that is immediately undone must not
    // notify the user's devices.
    const start = setTimeout(() => {
      run().catch(() => {
        if (signal.aborted) return;
        setView({
          step: "ended",
          message: "Couldn't reach the server. Check your connection and try again.",
        });
      });
    });
    return () => {
      clearTimeout(start);
      controller.abort();
    };
  }, [attempt]);

  if (view.step === "ended") {
    return (
      <View style={styles.ended}>
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.destructive, fontFamily: fonts.sansRegular }]}
        >
          {view.message}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setView({ step: "sending" });
            setAttempt((n) => n + 1);
          }}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: colors.primary, borderRadius: radii.md, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.ctaText, { color: colors.primaryForeground, fontFamily: fonts.sansSemiBold }]}>
            Send a new request
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radii.lg },
      ]}
    >
      <Text
        accessibilityLabel={view.step === "sending" ? "Sending request" : `Number ${view.number}`}
        accessibilityLiveRegion="polite"
        style={[styles.number, { color: colors.foreground, fontFamily: fonts.mono }]}
      >
        {view.step === "sending" ? "··" : view.number}
      </Text>
      <View style={styles.status}>
        <ActivityIndicator size="small" color={colors.mutedForeground} />
        <Text style={[styles.statusText, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}>
          {view.step === "sending"
            ? "Sending request…"
            : view.step === "verifying"
              ? "Approved. Signing in…"
              : "Waiting for approval…"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 24,
    borderWidth: StyleSheet.hairlineWidth,
  },
  number: { fontSize: 48, letterSpacing: 2 },
  status: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusText: { fontSize: 14 },
  ended: { gap: 16 },
  error: { fontSize: 14 },
  cta: { paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 15 },
});
