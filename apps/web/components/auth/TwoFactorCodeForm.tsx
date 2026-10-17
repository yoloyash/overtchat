"use client";

import { useState } from "react";
import {
  TOTP_CODE_LENGTH,
  twoFactorErrorMessage,
  twoFactorSignInExpired,
} from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";

/** The second sign-in step for accounts with two-factor turned on. */
export function TwoFactorCodeForm({
  onVerified,
  onRestart,
}: {
  onVerified: () => void | Promise<void>;
  /** The pending sign-in ended; the user has to enter their password again. */
  onRestart: (message: string) => void;
}) {
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const { error } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
      : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
    if (error) {
      setSubmitting(false);
      if (twoFactorSignInExpired(error)) {
        onRestart(twoFactorErrorMessage(error));
        return;
      }
      setError(twoFactorErrorMessage(error));
      return;
    }
    await onVerified();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          Two-factor authentication
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {backup
            ? "Enter one of the backup codes you saved when you set up two-factor."
            : "Enter the 6-digit code from your authenticator app."}
        </p>
      </header>

      <div className="space-y-1.5">
        <Label htmlFor="two-factor-code">
          {backup ? "Backup code" : "Authentication code"}
        </Label>
        <Input
          key={backup ? "backup" : "totp"}
          id="two-factor-code"
          autoFocus
          required
          autoComplete="one-time-code"
          inputMode={backup ? "text" : "numeric"}
          pattern={backup ? undefined : `[0-9 ]{${TOTP_CODE_LENGTH},7}`}
          maxLength={backup ? 11 : 7}
          spellCheck={false}
          autoCapitalize="none"
          placeholder={backup ? "xxxxx-xxxxx" : "123456"}
          className="font-mono tracking-widest"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError("");
          }}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Verifying…" : "Verify"}
      </Button>
      <Button
        type="button"
        variant="link"
        className="w-full"
        onClick={() => {
          setBackup((value) => !value);
          setCode("");
          setError("");
        }}
      >
        {backup ? "Use your authenticator app" : "Use a backup code"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Lost your authenticator and backup codes? Ask a server administrator to
        reset two-factor for you.
      </p>
    </form>
  );
}
