import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import {
  PASSWORD_ONLY_SIGN_IN,
  SIGN_IN_APPROVAL_METHOD,
  TOTP_CODE_LENGTH,
  TWO_FACTOR_CLIENT_HEADER,
  signInCancelled,
  ssoErrorMessage,
  twoFactorErrorMessage,
  twoFactorSignInExpired,
} from "@overtchat/shared";
import { SignInApprovalStep } from "@/components/SignInApprovalStep";
import { getAuthClient } from "@/lib/auth/client";
import { signInWithProvider } from "@/lib/auth/providerSignIn";
import { providerSignInDevice } from "@/lib/auth/providerSignInDevice";
import { useSignInMethods } from "@/lib/queries/signInMethods";
import { unexpectedSessionMessage } from "@/lib/auth/sessionResponseGuard";
import { useServerUrl } from "@/lib/server-url";
import { useTheme } from "@/lib/theme";

type CodeStep = "approval" | "totp" | "backup";

/** How this app last finished two-factor, so returning users start there. */
const METHOD_KEY = "overtchat.twoFactorMethod";

function lastMethod(): CodeStep | null {
  try {
    const value = SecureStore.getItem(METHOD_KEY);
    return value === "approval" || value === "totp" ? value : null;
  } catch {
    return null;
  }
}

function rememberMethod(step: CodeStep) {
  try {
    SecureStore.setItem(METHOD_KEY, step === "approval" ? "approval" : "totp");
  } catch {
    // The next sign-in starts with the default.
  }
}

export default function LoginScreen() {
  const { colors, radii, fonts } = useTheme();
  const { t } = useTranslation();
  const serverUrl = useServerUrl();
  const authClient = getAuthClient();
  const session = authClient.useSession();
  const serverHost = serverUrl ? safeHost(serverUrl) : null;
  const serverNotice = unexpectedSessionMessage(session.error)
    ? t("auth.mobile.unexpectedSessionResponse")
    : null;
  const signInMethods = useSignInMethods();
  // A server that can't be asked gets the password form, as before.
  const methods = signInMethods.isPending
    ? null
    : (signInMethods.data ?? PASSWORD_ONLY_SIGN_IN);
  const sso = methods?.sso ?? null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // The provider's sign-in is open in the browser; the password isn't in use.
  const [inBrowser, setInBrowser] = useState(false);
  // Set after the password when the account uses two-factor.
  const [codeStep, setCodeStep] = useState<CodeStep | null>(null);
  // The server can ask the user's signed-in devices to approve this sign-in.
  const [canApprove, setCanApprove] = useState(false);
  const [code, setCode] = useState("");
  // Why approval couldn't be used, shown on the code step.
  const [notice, setNotice] = useState("");

  async function onSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const { data, error } = await authClient.signIn.email(
        { email, password },
        { headers: { [TWO_FACTOR_CLIENT_HEADER]: "1" } },
      );
      if (error) {
        setError(error.message ?? t("auth.login.failed"));
        return;
      }
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        const approve =
          "twoFactorMethods" in data &&
          Array.isArray(data.twoFactorMethods) &&
          data.twoFactorMethods.includes(SIGN_IN_APPROVAL_METHOD);
        setCanApprove(approve);
        setCode("");
        setNotice("");
        setCodeStep(approve && lastMethod() !== "totp" ? "approval" : "totp");
        return;
      }
      await session.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.login.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onProviderSignIn() {
    if (submitting || !serverUrl || !sso) return;
    setSubmitting(true);
    setInBrowser(true);
    setError("");
    try {
      const result = await signInWithProvider(serverUrl, providerSignInDevice);
      if (result.ok) await session.refetch();
      else if (!signInCancelled(result.error)) {
        setError(ssoErrorMessage(result.error, sso.name));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.login.failed"));
    } finally {
      setSubmitting(false);
      setInBrowser(false);
    }
  }

  function restart(message: string) {
    setCodeStep(null);
    setPassword("");
    setError(message);
  }

  async function onApproved() {
    rememberMethod("approval");
    await session.refetch();
  }

  async function onVerify() {
    if (submitting || !codeStep || codeStep === "approval") return;
    setSubmitting(true);
    setError("");
    try {
      const { error } =
        codeStep === "backup"
          ? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
          : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
      if (error) {
        if (twoFactorSignInExpired(error)) {
          setCodeStep(null);
          setPassword("");
        }
        setError(twoFactorErrorMessage(error));
        return;
      }
      rememberMethod(codeStep);
      await session.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.mobile.login.verifyFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  const alternateSteps: readonly CodeStep[] =
    codeStep === "approval"
      ? ["totp", "backup"]
      : codeStep === "totp"
        ? ["backup", ...(canApprove ? (["approval"] as const) : [])]
        : ["totp", ...(canApprove ? (["approval"] as const) : [])];

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.content}>
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
                {codeStep === "approval"
                  ? t("auth.twoFactor.approval.title")
                  : codeStep
                    ? t("auth.twoFactor.code.title")
                    : t("auth.login.title")}
              </Text>
              <Text
                style={[
                  styles.subtitle,
                  { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                ]}
              >
                {codeStep === "approval"
                  ? t("auth.mobile.login.approvalDescription")
                  : codeStep === "backup"
                    ? t("auth.twoFactor.code.backupDescription")
                    : codeStep
                      ? t("auth.twoFactor.code.totpDescription")
                      : t("auth.login.subtitle")}
              </Text>
            </View>

            {codeStep === "approval" ? (
              <SignInApprovalStep
                onApproved={onApproved}
                onRestart={restart}
                onUnavailable={(message) => {
                  setNotice(message);
                  setCodeStep("totp");
                }}
              />
            ) : codeStep ? (
              <View style={styles.field}>
                {notice !== "" && (
                  <Text
                    style={[
                      styles.notice,
                      { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                    ]}
                  >
                    {notice}
                  </Text>
                )}
                <Text
                  style={[styles.label, { color: colors.foreground, fontFamily: fonts.sansMedium }]}
                >
                  {codeStep === "backup"
                    ? t("auth.twoFactor.code.backupLabel")
                    : t("auth.twoFactor.code.totpLabel")}
                </Text>
                <TextInput
                  key={codeStep}
                  value={code}
                  onChangeText={setCode}
                  onSubmitEditing={onVerify}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={codeStep === "backup" ? "default" : "number-pad"}
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={codeStep === "backup" ? 11 : TOTP_CODE_LENGTH + 1}
                  // eslint-disable-next-line i18next/no-literal-string -- code format placeholder
                  placeholder={codeStep === "backup" ? "xxxxx-xxxxx" : "123456"}
                  placeholderTextColor={colors.mutedForeground}
                  editable={!submitting}
                  style={[
                    styles.input,
                    styles.codeInput,
                    {
                      color: colors.foreground,
                      borderColor: colors.input,
                      borderRadius: radii.md,
                      fontFamily: fonts.mono,
                    },
                  ]}
                />
              </View>
            ) : !methods ? (
              <ActivityIndicator color={colors.mutedForeground} />
            ) : !methods.password ? null : (
              <View style={styles.fields}>
                <View style={styles.field}>
                  <Text
                    style={[styles.label, { color: colors.foreground, fontFamily: fonts.sansMedium }]}
                  >
                    {t("auth.fields.email")}
                  </Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    autoComplete="username"
                    importantForAutofill="yes"
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
                    {t("auth.fields.password")}
                  </Text>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    autoComplete="current-password"
                    importantForAutofill="yes"
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

            )}

            {(error || serverNotice) && (
              <Text
                style={[styles.error, { color: colors.destructive, fontFamily: fonts.sansRegular }]}
              >
                {error || serverNotice}
              </Text>
            )}

            {codeStep !== "approval" && (codeStep || methods?.password) && (
              <Pressable
                accessibilityRole="button"
                disabled={submitting}
                onPress={codeStep ? onVerify : onSubmit}
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
                  {codeStep
                    ? submitting
                      ? t("auth.twoFactor.code.verifying")
                      : t("auth.twoFactor.code.verify")
                    : submitting && !inBrowser
                      ? t("auth.login.submitting")
                      : t("auth.login.submit")}
                </Text>
              </Pressable>
            )}

            {!codeStep && sso && (
              <>
                {methods?.password && (
                  <View style={styles.divider}>
                    <View style={[styles.rule, { backgroundColor: colors.border }]} />
                    <Text
                      style={[
                        styles.dividerText,
                        { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                      ]}
                    >
                      {t("auth.login.or")}
                    </Text>
                    <View style={[styles.rule, { backgroundColor: colors.border }]} />
                  </View>
                )}
                <Pressable
                  accessibilityRole="button"
                  disabled={submitting}
                  onPress={onProviderSignIn}
                  style={({ pressed }) => [
                    styles.cta,
                    methods?.password
                      ? { borderWidth: 1, borderColor: colors.input }
                      : { backgroundColor: colors.primary },
                    { borderRadius: radii.md, opacity: pressed || submitting ? 0.85 : 1 },
                  ]}
                >
                  <Text
                    style={[
                      styles.ctaText,
                      {
                        color: methods?.password ? colors.foreground : colors.primaryForeground,
                        fontFamily: fonts.sansSemiBold,
                      },
                    ]}
                  >
                    {t("auth.login.ssoContinue", { provider: sso.name })}
                  </Text>
                </Pressable>
              </>
            )}

            {codeStep ? (
              <View style={styles.links}>
                {alternateSteps.map((next) => (
                  <Pressable
                    key={next}
                    accessibilityRole="button"
                    hitSlop={8}
                    disabled={submitting}
                    onPress={() => {
                      setCodeStep(next);
                      setCode("");
                      setError("");
                      setNotice("");
                    }}
                  >
                    <Text style={[
                      styles.recoveryLink,
                      { color: colors.primary, fontFamily: fonts.sansMedium },
                    ]}>
                      {next === "totp"
                        ? t("auth.twoFactor.methods.useAuthenticator")
                        : next === "backup"
                          ? t("auth.twoFactor.methods.useBackupCode")
                          : t("auth.twoFactor.methods.approveOnAnotherDevice")}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : !methods?.password ? null : (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() =>
                  Alert.alert(
                    t("auth.login.forgotPassword"),
                    t("auth.mobile.login.recoveryAlertMessage"),
                  )
                }
              >
                <Text style={[
                  styles.recoveryLink,
                  { color: colors.primary, fontFamily: fonts.sansMedium },
                ]}>
                  {t("auth.login.forgotPassword")}
                </Text>
              </Pressable>

            )}

            {serverHost ? (
              <View style={styles.serverRow}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.serverText,
                    { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                  ]}
                >
                  {t("auth.mobile.login.serverLabel", { origin: serverHost })}
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
                    {t("auth.mobile.login.changeServerShort")}
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
  codeInput: { letterSpacing: 4 },
  error: { fontSize: 14 },
  cta: { paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 15 },
  recoveryLink: { fontSize: 14, textAlign: "center" },
  links: { gap: 14 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 12 },
  notice: { fontSize: 14, marginBottom: 6 },
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
