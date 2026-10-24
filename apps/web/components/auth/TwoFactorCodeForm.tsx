"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  SIGN_IN_APPROVAL_ENDED,
  SIGN_IN_APPROVAL_METHOD,
  TOTP_CODE_LENGTH,
  twoFactorErrorMessage,
  twoFactorSignInExpired,
  waitForSignInApproval,
  type SignInApprovalState,
} from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";

type Method = "approval" | "totp" | "backup";

/** The method this browser last signed in with, so returning users start there. */
const METHOD_STORAGE_KEY = "overtchat_two_factor_method";

function lastMethod(): Method | null {
  try {
    const value = localStorage.getItem(METHOD_STORAGE_KEY);
    return value === "approval" || value === "totp" ? value : null;
  } catch {
    return null;
  }
}

function rememberMethod(method: Method) {
  try {
    localStorage.setItem(METHOD_STORAGE_KEY, method === "approval" ? "approval" : "totp");
  } catch {
    // Storage is unavailable; the next sign-in starts with the default.
  }
}

/** The second sign-in step for accounts with two-factor turned on. */
export function TwoFactorCodeForm({
  methods,
  onVerified,
  onRestart,
}: {
  /** `twoFactorMethods` from the password step; servers before approval omit "otp". */
  methods: readonly string[];
  onVerified: () => void | Promise<void>;
  /** The pending sign-in ended; the user has to enter their password again. */
  onRestart: (message: string) => void;
}) {
  const canApprove = methods.includes(SIGN_IN_APPROVAL_METHOD);
  const [method, setMethod] = useState<Method>(() =>
    canApprove && lastMethod() !== "totp" ? "approval" : "totp",
  );
  // Shown on the code form when approval couldn't be used.
  const [notice, setNotice] = useState("");

  async function verified(used: Method) {
    rememberMethod(used);
    await onVerified();
  }

  if (method === "approval") {
    return (
      <SignInApproval
        onApproved={() => verified("approval")}
        onRestart={onRestart}
        onUnavailable={(message) => {
          setNotice(message);
          setMethod("totp");
        }}
        onUseCode={(code) => {
          setNotice("");
          setMethod(code);
        }}
      />
    );
  }
  return (
    <CodeForm
      key={method}
      backup={method === "backup"}
      notice={notice}
      canApprove={canApprove}
      onVerified={() => verified(method)}
      onRestart={onRestart}
      onSwitch={(next) => {
        setNotice("");
        setMethod(next);
      }}
    />
  );
}

function CodeForm({
  backup,
  notice,
  canApprove,
  onVerified,
  onRestart,
  onSwitch,
}: {
  backup: boolean;
  notice: string;
  canApprove: boolean;
  onVerified: () => void | Promise<void>;
  onRestart: (message: string) => void;
  onSwitch: (method: Method) => void;
}) {
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

      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      <div className="space-y-1.5">
        <Label htmlFor="two-factor-code">
          {backup ? "Backup code" : "Authentication code"}
        </Label>
        <Input
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
      <div className="flex flex-col items-center">
        <Button
          type="button"
          variant="link"
          onClick={() => onSwitch(backup ? "totp" : "backup")}
        >
          {backup ? "Use your authenticator app" : "Use a backup code"}
        </Button>
        {canApprove && (
          <Button type="button" variant="link" onClick={() => onSwitch("approval")}>
            Approve on another device
          </Button>
        )}
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Lost your authenticator and backup codes? Ask a server administrator to
        reset two-factor for you.
      </p>
    </form>
  );
}

type ApprovalView =
  | { step: "sending" }
  | { step: "waiting"; number: number }
  | { step: "verifying"; number: number }
  | { step: "ended"; message: string };

/** Asks the user's signed-in devices to approve, and waits for the answer. */
function SignInApproval({
  onApproved,
  onRestart,
  onUnavailable,
  onUseCode,
}: {
  onApproved: () => void | Promise<void>;
  onRestart: (message: string) => void;
  /** Approval can't be used for this sign-in; fall back to a code. */
  onUnavailable: (message: string) => void;
  onUseCode: (method: "totp" | "backup") => void;
}) {
  const [view, setView] = useState<ApprovalView>({ step: "sending" });
  const [attempt, setAttempt] = useState(0);
  const approved = useEffectEvent(() => onApproved());
  const restart = useEffectEvent((message: string) => onRestart(message));
  const unavailable = useEffectEvent((message: string) => onUnavailable(message));

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function run() {
      const sent = await authClient.twoFactor.sendOtp({}, { signal });
      if (signal.aborted) return;
      if (sent.error) {
        if (twoFactorSignInExpired(sent.error)) {
          restart(twoFactorErrorMessage(sent.error));
        } else {
          unavailable(twoFactorErrorMessage(sent.error));
        }
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
        if (twoFactorSignInExpired(error)) {
          restart(twoFactorErrorMessage(error));
        } else {
          setView({ step: "ended", message: twoFactorErrorMessage(error) });
        }
        return;
      }
      await approved();
    }

    // Start on the next tick: a mount that is immediately undone, like
    // StrictMode's, must not notify the user's devices.
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

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Approve this sign-in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Open OvertChat on a phone or computer where you&apos;re signed in, and
          pick this number.
        </p>
      </header>

      {view.step === "ended" ? (
        <div className="space-y-4">
          <p role="alert" className="text-sm text-destructive">
            {view.message}
          </p>
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              setView({ step: "sending" });
              setAttempt((n) => n + 1);
            }}
          >
            Send a new request
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/40 px-4 py-6">
          <p
            aria-live="polite"
            aria-label={
              view.step === "sending" ? "Sending request" : `Number ${view.number}`
            }
            className="font-mono text-5xl font-semibold tabular-nums tracking-tight"
          >
            {view.step === "sending" ? "··" : view.number}
          </p>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
            {view.step === "sending"
              ? "Sending request…"
              : view.step === "verifying"
                ? "Approved. Signing in…"
                : "Waiting for approval…"}
          </p>
        </div>
      )}

      <div className="flex flex-col items-center">
        <Button type="button" variant="link" onClick={() => onUseCode("totp")}>
          Use your authenticator app
        </Button>
        <Button type="button" variant="link" onClick={() => onUseCode("backup")}>
          Use a backup code
        </Button>
      </div>
    </div>
  );
}
