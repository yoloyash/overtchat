"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const { data: status, isPending, isError } = useQuery(twoFactorQuery);
  const [settingUp, setSettingUp] = useState(startSetup);
  const [action, setAction] = useState<Action | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const description = status?.required
    ? t("account.twoFactor.descriptionRequired")
    : t("account.twoFactor.descriptionRecommended");

  return (
    <SettingsSection title={t("account.twoFactor.title")} description={description}>
      {isPending ? (
        <SettingsRow title={t("account.twoFactor.statusTitle")}>
          <span className="text-sm text-muted-foreground">
            {t("account.twoFactor.loading")}
          </span>
        </SettingsRow>
      ) : isError ? (
        <div className="py-4">
          <SettingsNotice tone="error">
            {t("account.twoFactor.loadError")}
          </SettingsNotice>
        </div>
      ) : newCodes ? (
        <div className="py-4">
          <BackupCodes
            codes={newCodes}
            intro={t("account.twoFactor.backupCodesIntro")}
            onDone={() => setNewCodes(null)}
          />
        </div>
      ) : status.enabled ? (
        <SettingsRow
          title={t("account.twoFactor.authenticatorTitle")}
          description={t("account.twoFactor.enabledDescription")}
          controlAlign="end"
        >
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setAction("backup-codes")}>
              {t("account.twoFactor.newBackupCodes")}
            </Button>
            {!status.required && (
              <Button variant="destructive" size="sm" onClick={() => setAction("disable")}>
                {t("account.twoFactor.turnOff")}
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
              toast.success(t("account.twoFactor.enabledToast"));
            }}
          />
        </div>
      ) : (
        <SettingsRow
          title={t("account.twoFactor.authenticatorTitle")}
          description={t("account.twoFactor.off")}
          controlAlign="end"
        >
          <Button size="sm" onClick={() => setSettingUp(true)}>
            {t("account.twoFactor.setUp")}
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

const ACTION_KEYS = {
  "backup-codes": "backupCodes",
  disable: "disable",
} as const satisfies Record<Action, "backupCodes" | "disable">;

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
  const { t } = useTranslation();
  const refresh = useRefreshTwoFactor();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const actionKey = ACTION_KEYS[action];

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    if (action === "backup-codes") {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
      setSubmitting(false);
      if (error || !data) {
        setError(error?.message ?? t("account.twoFactor.confirm.backupCodes.error"));
        return;
      }
      onBackupCodes(data.backupCodes);
      onClose();
      return;
    }
    const { error } = await authClient.twoFactor.disable({ password });
    setSubmitting(false);
    if (error) {
      setError(error.message ?? t("account.twoFactor.confirm.disable.error"));
      return;
    }
    await refresh();
    toast.success(t("account.twoFactor.disabledToast"));
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
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            {t(`account.twoFactor.confirm.${actionKey}.title`)}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {t(`account.twoFactor.confirm.${actionKey}.description`)}
          </Dialog.Description>
          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <input type="email" autoComplete="username" defaultValue={email} readOnly hidden />
            <div className="space-y-1.5">
              <Label htmlFor="two-factor-confirm-password">
                {t("account.twoFactor.confirm.passwordLabel")}
              </Label>
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
                {t("account.twoFactor.confirm.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                variant={action === "disable" ? "destructive" : "default"}
                disabled={submitting}
              >
                {submitting
                  ? t(`account.twoFactor.confirm.${actionKey}.pending`)
                  : t(`account.twoFactor.confirm.${actionKey}.submit`)}
              </Button>
            </SettingsActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
