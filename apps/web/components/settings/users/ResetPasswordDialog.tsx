"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (newPassword !== confirmation) {
      setError("The replacement passwords do not match.");
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
        setError(error.message ?? "Failed to reset password.");
        return;
      }
      toast.success({
        title: "Password reset",
        description: `${target.email} has been signed out on all devices.`,
      });
      onClose();
    } catch {
      setError(
        "Could not reset the password. Check your connection and try again.",
      );
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
            Reset password
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Set a replacement password for {target.email}. They will be signed
            out on all devices. Share the password privately; they can change it
            in Security settings.
          </Dialog.Description>
          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reset-current-password">
                Your current password
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
              <Label htmlFor="reset-new-password">Replacement password</Label>
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
                Confirm replacement password
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
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? "Resetting…" : "Reset password"}
              </Button>
            </SettingsActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
