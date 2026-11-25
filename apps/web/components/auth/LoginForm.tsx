"use client";

import {
  SSO_PROVIDER_ID,
  TWO_FACTOR_CLIENT_HEADER,
  signInCancelled,
  ssoErrorMessage,
  type SignInMethods,
} from "@overtchat/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/auth/client";
import { forgetSignedOut, signedOutHere } from "@/lib/auth/signedOut";
import { desktopBridge } from "@/lib/desktop";
import { useResetAuthState } from "@/lib/queries/auth";
import { TwoFactorCodeForm } from "./TwoFactorCodeForm";

export function LoginForm({
  methods,
  ssoError,
}: {
  methods: SignInMethods;
  /** The code a failed sign-in with the identity provider came back with. */
  ssoError?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const resetAuthState = useResetAuthState();
  const sso = methods.sso;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(
    ssoError && sso ? ssoErrorMessage(ssoError, sso.name) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  // The desktop app's sign-in happens in another program, which the person
  // may close without finishing; they can start again at any time.
  const inBrowser = Boolean(desktopBridge()?.signInWithProvider);
  // With the provider as the only way in, this page has one thing to offer,
  // so a browser goes straight there. Not after signing out or a failed
  // sign-in, which would loop, and not in the desktop app, where it would
  // open another program unasked.
  const [straightToProvider] = useState(
    () =>
      Boolean(sso) &&
      !methods.password &&
      !ssoError &&
      !signedOutHere() &&
      !desktopBridge(),
  );
  const [ssoPending, setSsoPending] = useState(straightToProvider);
  const wentStraight = useRef(false);
  const browserSignIn = useRef(0);
  const [showRecovery, setShowRecovery] = useState(false);
  // The second step's methods, once the password is accepted.
  const [twoFactorMethods, setTwoFactorMethods] = useState<string[] | null>(
    null,
  );

  async function finish() {
    resetAuthState();
    await navigate({ to: "/", replace: true });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    const { data, error } = await authClient.signIn.email(
      { email, password },
      { headers: { [TWO_FACTOR_CLIENT_HEADER]: "1" } },
    );
    if (error) {
      setError(error.message ?? t("auth.login.failed"));
      setSubmitting(false);
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setSubmitting(false);
      setTwoFactorMethods(
        "twoFactorMethods" in data && Array.isArray(data.twoFactorMethods)
          ? data.twoFactorMethods
          : [],
      );
      return;
    }
    await finish();
  }

  async function signInWithProvider() {
    if (!sso) return;
    forgetSignedOut();
    setSsoPending(true);
    setError("");
    const bridge = desktopBridge();
    if (bridge) {
      // The desktop app signs in through the system browser.
      const started = ++browserSignIn.current;
      const result = await bridge.signInWithProvider?.();
      if (result?.ok) return finish();
      // Starting again ends the sign-in before; only the latest one reports.
      if (started !== browserSignIn.current) return;
      setSsoPending(false);
      if (result && !signInCancelled(result.error)) {
        setError(ssoErrorMessage(result.error, sso.name));
      }
      return;
    }
    await redirectToProvider(sso.name);
  }

  async function redirectToProvider(name: string, unasked = false) {
    const { data, error } = await authClient.signIn.social({
      provider: SSO_PROVIDER_ID,
      callbackURL: "/",
      errorCallbackURL: "/login",
      disableRedirect: unasked,
    });
    if (error || (unasked && !data?.url)) {
      setError(ssoErrorMessage(error?.code ?? "", name));
      setSsoPending(false);
      return;
    }
    // Asked for, the browser is already on its way to the provider. Sent
    // unasked, it replaces this page, so Back leaves instead of returning
    // here to be sent on again.
    if (unasked && data?.url) window.location.replace(data.url);
  }

  useEffect(() => {
    if (!straightToProvider || !sso || wentStraight.current) return;
    wentStraight.current = true;
    void redirectToProvider(sso.name, true);
  }, [straightToProvider, sso]);

  useEffect(() => {
    // Back from the provider's page, the browser may restore this one as it
    // was left: waiting. Offer the button again.
    function restored(event: PageTransitionEvent) {
      if (event.persisted) setSsoPending(false);
    }
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  if (twoFactorMethods) {
    return (
      <TwoFactorCodeForm
        methods={twoFactorMethods}
        onVerified={finish}
        onRestart={(message) => {
          setTwoFactorMethods(null);
          setPassword("");
          setError(message);
        }}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          {t("auth.login.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("auth.login.subtitle")}
        </p>
      </header>

      {methods.password && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("auth.fields.email")}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{t("auth.fields.password")}</Label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {methods.password && (
        <Button
          type="submit"
          disabled={submitting || (ssoPending && !inBrowser)}
          className="w-full"
        >
          {submitting ? t("auth.login.submitting") : t("auth.login.submit")}
        </Button>
      )}

      {sso && (
        <>
          {methods.password && (
            <div
              role="separator"
              className="flex items-center gap-3 text-xs text-muted-foreground"
            >
              <span className="h-px flex-1 bg-border" />
              {t("auth.login.or")}
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
          <Button
            type="button"
            variant={methods.password ? "outline" : "default"}
            className="w-full"
            disabled={submitting || (ssoPending && !inBrowser)}
            onClick={signInWithProvider}
          >
            {ssoPending && !inBrowser
              ? t("auth.login.ssoWaiting", { provider: sso.name })
              : t("auth.login.ssoContinue", { provider: sso.name })}
          </Button>
          {ssoPending && inBrowser && (
            <p
              role="status"
              className="text-center text-sm text-muted-foreground"
            >
              {t("auth.login.ssoInBrowser", { provider: sso.name })}
            </p>
          )}
        </>
      )}

      {methods.password && (
        <>
          <Button
            type="button"
            variant="link"
            className="w-full"
            aria-expanded={showRecovery}
            aria-controls="password-recovery-help"
            onClick={() => setShowRecovery((shown) => !shown)}
          >
            {t("auth.login.forgotPassword")}
          </Button>
          {showRecovery && (
            <div
              id="password-recovery-help"
              className="space-y-2 text-sm text-muted-foreground"
            >
              <p>{t("auth.login.recoveryAdmin")}</p>
              <p>
                <Trans
                  i18nKey="auth.login.recoveryCli"
                  values={{
                    resetPassword: "overtchat reset-password",
                    resetTwoFactor: "overtchat reset-two-factor",
                  }}
                  components={{
                    resetPassword: <code />,
                    resetTwoFactor: <code />,
                  }}
                />
              </p>
            </div>
          )}
        </>
      )}
    </form>
  );
}
