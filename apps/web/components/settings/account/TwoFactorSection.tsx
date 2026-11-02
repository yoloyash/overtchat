"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/toast";
import { BackupCodes, TwoFactorSetup } from "@/components/auth/TwoFactorSetup";
import { authClient } from "@/lib/auth/client";
import { twoFactorQuery, useRefreshTwoFactor } from "@/lib/queries/auth";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  SettingsActions,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
} from "../SettingsRows";

type Action = "backup-codes" | "disable";

export function TwoFactorSection({
  email,
  startSetup = false,
}: {
  email: string;
  startSetup?: boolean;
}) {
  const { data: status, isPending, isError } = useQuery(twoFactorQuery);
  const [settingUp, setSettingUp] = useState(startSetup);
  const [action, setAction] = useState<Action | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const description = status?.required
    ? "Administrators on this server must use two-factor authentication."
    : "Recommended. After your password, sign-in also asks for a code from an authenticator app.";

  return (
    <SettingsSection title="Two-factor authentication" description={description}>
      {isPending ? (
        <SettingsRow title="Status">
          <span className="text-sm text-muted-foreground">Loading…</span>
        </SettingsRow>
      ) : isError ? (
        <div className="py-4">
          <SettingsNotice tone="error">Could not load two-factor status.</SettingsNotice>
        </div>
      ) : newCodes ? (
        <div className="py-4">
          <BackupCodes
            codes={newCodes}
            intro="Your old backup codes no longer work. Save these somewhere safe."
            onDone={() => setNewCodes(null)}
          />
        </div>
      ) : status.enabled ? (
        <SettingsRow
          title="Authenticator app"
          description="On. Keep your backup codes somewhere safe in case you lose your device."
          controlAlign="end"
        >
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setAction("backup-codes")}>
              New backup codes
            </Button>
            {!status.required && (
              <Button variant="destructive" size="sm" onClick={() => setAction("disable")}>
                Turn off
              </Button>
            )}
          </div>
        </SettingsRow>
      ) : settingUp ? (
        <div className="py-4">
          <TwoFactorSetup
            email={email}
            onCancel={() => setSettingUp(false)}
            onDone={() => {
              setSettingUp(false);
              toast.success("Two-factor authentication is on");
            }}
          />
        </div>
      ) : (
        <SettingsRow title="Authenticator app" description="Off" controlAlign="end">
          <Button size="sm" onClick={() => setSettingUp(true)}>
            Set up
          </Button>
        </SettingsRow>
      )}
      {action && (
        <ConfirmPasswordDialog
          action={action}
          email={email}
          onClose={() => setAction(null)}
          onBackupCodes={setNewCodes}
        />
      )}
    </SettingsSection>
  );
}

const ACTIONS = {
  "backup-codes": {
    title: "New backup codes",
    description: "Your current backup codes will stop working.",
    submit: "Create new codes",
    pending: "Creating…",
  },
  disable: {
    title: "Turn off two-factor",
    description:
      "Signing in will only need your password. Your authenticator entry and backup codes stop working.",
    submit: "Turn off",
    pending: "Turning off…",
  },
} satisfies Record<Action, Record<string, string>>;

function ConfirmPasswordDialog({
  action,
  email,
  onClose,
  onBackupCodes,
}: {
  action: Action;
  email: string;
  onClose: () => void;
  onBackupCodes: (codes: string[]) => void;
}) {
  const refresh = useRefreshTwoFactor();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const copy = ACTIONS[action];

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    if (action === "backup-codes") {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
      setSubmitting(false);
      if (error || !data) {
        setError(error?.message ?? "Could not create backup codes.");
        return;
      }
      onBackupCodes(data.backupCodes);
      onClose();
      return;
    }
    const { error } = await authClient.twoFactor.disable({ password });
    setSubmitting(false);
    if (error) {
      setError(error.message ?? "Could not turn off two-factor.");
      return;
    }
    await refresh();
    toast.success("Two-factor authentication is off");
    onClose();
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)} />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">{copy.title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {copy.description}
          </Dialog.Description>
          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <input type="email" autoComplete="username" defaultValue={email} readOnly hidden />
            <div className="space-y-1.5">
              <Label htmlFor="two-factor-confirm-password">Your password</Label>
              <PasswordInput
                id="two-factor-confirm-password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
            </div>
            {error && <SettingsNotice tone="error">{error}</SettingsNotice>}
            <SettingsActions bordered={false} className="pt-2">
              <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                variant={action === "disable" ? "destructive" : "default"}
                disabled={submitting}
              >
                {submitting ? copy.pending : copy.submit}
              </Button>
            </SettingsActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
