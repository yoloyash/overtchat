"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth/client";
import type { UserRow } from "@/lib/queries/users";
import { cn } from "@/lib/utils";
import { motionClasses } from "@/lib/motion";
import { SettingsActions, SettingsNotice } from "../SettingsRows";

export function ResetPasswordDialog({
  target,
  onClose,
}: {
  target: UserRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (newPassword !== confirmation) {
      setError(t("users.resetPasswordDialog.mismatchError"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const { error } = await authClient.$fetch("/admin/reset-user-password", {
        method: "POST",
        body: { userId: target.id, currentPassword, newPassword },
      });
      if (error) {
        setError(error.message ?? t("users.resetPasswordDialog.errorFallback"));
        return;
      }
      toast.success({
        title: t("users.toast.passwordResetTitle"),
        description: t("users.toast.passwordResetDescription", {
          email: target.email,
        }),
      });
      onClose();
    } catch {
      setError(t("users.resetPasswordDialog.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            "fixed inset-0 z-40 bg-black/40",
            motionClasses.overlay,
          )}
        />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            {t("users.resetPasswordDialog.title")}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {t("users.resetPasswordDialog.description", {
              email: target.email,
            })}
          </Dialog.Description>
          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reset-current-password">
                {t("users.resetPasswordDialog.currentPasswordLabel")}
              </Label>
              <PasswordInput
                id="reset-current-password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-new-password">
                {t("users.resetPasswordDialog.replacementPasswordLabel")}
              </Label>
              <PasswordInput
                id="reset-new-password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-confirm-password">
                {t("users.resetPasswordDialog.confirmPasswordLabel")}
              </Label>
              <PasswordInput
                id="reset-confirm-password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                disabled={submitting}
              />
            </div>
            {error && <SettingsNotice tone="error">{error}</SettingsNotice>}
            <SettingsActions bordered={false} className="pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={submitting}
                onClick={onClose}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting
                  ? t("users.resetPasswordDialog.resetting")
                  : t("users.resetPasswordDialog.submit")}
              </Button>
            </SettingsActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
