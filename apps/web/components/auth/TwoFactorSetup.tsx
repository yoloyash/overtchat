"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Download } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { TOTP_CODE_LENGTH, twoFactorErrorMessage } from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/auth/client";
import { useRefreshTwoFactor } from "@/lib/queries/auth";

type Enrollment = { totpURI: string; backupCodes: string[] };

/** Groups the base32 key from the setup URI for typing into an authenticator. */
function manualKey(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get("secret") ?? "";
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

/**
 * Sets up an authenticator app: confirm the password, scan the code, verify a
 * code from the app, then save the backup codes.
 */
export function TwoFactorSetup({
  email,
  onDone,
  onCancel,
}: {
  email: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const refresh = useRefreshTwoFactor();
  const [step, setStep] = useState<"password" | "scan" | "codes">("password");
  const [password, setPassword] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const { data, error } = await authClient.twoFactor.enable({ password });
    setSubmitting(false);
    if (error || !data || !("totpURI" in data) || !data.totpURI) {
      setError(error?.message ?? t("auth.twoFactor.setup.startFailed"));
      return;
    }
    setEnrollment({ totpURI: data.totpURI, backupCodes: data.backupCodes ?? [] });
    setPassword("");
    setStep("scan");
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const { error } = await authClient.twoFactor.verifyTotp({
      code: code.replace(/\s/g, ""),
    });
    setSubmitting(false);
    if (error) {
      setError(twoFactorErrorMessage(error));
      return;
    }
    setStep("codes");
  }

  async function finish() {
    await refresh();
    onDone();
  }

  if (step === "password") {
    return (
      <form onSubmit={start} className="space-y-4">
        {/* Lets password managers match the account. */}
        <input type="email" autoComplete="username" defaultValue={email} readOnly hidden />
        <div className="space-y-1.5">
          <Label htmlFor="two-factor-password">
            {t("auth.twoFactor.setup.confirmPassword")}
          </Label>
          <PasswordInput
            id="two-factor-password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
            disabled={submitting}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
              {t("common.actions.cancel")}
            </Button>
          )}
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting
              ? t("auth.twoFactor.setup.checking")
              : t("common.actions.continue")}
          </Button>
        </div>
      </form>
    );
  }

  if (step === "scan" && enrollment) {
    return (
      <form onSubmit={verify} className="space-y-5">
        <ol className="space-y-5 text-sm">
          <li className="space-y-3">
            <p>
              <Trans
                i18nKey="auth.twoFactor.setup.scanStep"
                components={{ lead: <span className="font-medium" /> }}
              />
            </p>
            <div className="w-fit rounded-lg bg-white p-3">
              <QRCodeSVG
                value={enrollment.totpURI}
                size={168}
                aria-label={t("auth.twoFactor.setup.qrLabel")}
              />
            </div>
            <p className="text-muted-foreground">
              <Trans
                i18nKey="auth.twoFactor.setup.manualKey"
                values={{ key: manualKey(enrollment.totpURI) }}
                components={{
                  key: (
                    <code className="select-all break-words font-mono text-foreground" />
                  ),
                }}
              />
            </p>
          </li>
          <li className="space-y-1.5">
            <Label htmlFor="two-factor-verify" className="font-medium">
              {t("auth.twoFactor.setup.verifyStep")}
            </Label>
            <Input
              id="two-factor-verify"
              required
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern={`[0-9 ]{${TOTP_CODE_LENGTH},7}`}
              maxLength={7}
              placeholder="123456"
              className="max-w-40 font-mono tracking-widest"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError("");
              }}
              disabled={submitting}
            />
          </li>
        </ol>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
              {t("common.actions.cancel")}
            </Button>
          )}
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting
              ? t("auth.twoFactor.code.verifying")
              : t("auth.twoFactor.setup.turnOn")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <BackupCodes
      codes={enrollment?.backupCodes ?? []}
      intro={t("auth.twoFactor.setup.backupCodesIntro")}
      onDone={finish}
    />
  );
}

/** Shows backup codes once, with copy and download. */
export function BackupCodes({
  codes,
  intro,
  onDone,
}: {
  codes: string[];
  intro: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  function download() {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "overtchat-backup-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{intro}</p>
      <ul
        aria-label={t("auth.twoFactor.backupCodes.listLabel")}
        className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border bg-muted/40 p-4 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied
            ? t("common.states.copied")
            : t("common.actions.copy")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download aria-hidden />
          {t("common.actions.download")}
        </Button>
        <Button type="button" size="sm" onClick={onDone}>
          {t("auth.twoFactor.backupCodes.saved")}
        </Button>
      </div>
    </div>
  );
}
