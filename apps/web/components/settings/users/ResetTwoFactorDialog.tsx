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

export function ResetTwoFactorDialog({
  target,
  onClose,
  onReset,
}: {
  target: UserRow;
  onClose: () => void;
  onReset: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const { error } = await authClient.$fetch("/admin/reset-user-two-factor", {
        method: "POST",
        body: { userId: target.id, currentPassword },
      });
      if (error) {
        setError(error.message ?? "Failed to reset two-factor.");
        return;
      }
      toast.success({
        title: "Two-factor reset",
        description: `${target.email} can sign in with their password and set it up again.`,
      });
      onReset();
      onClose();
    } catch {
      setError(
        "Could not reset two-factor. Check your connection and try again.",
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
            Reset two-factor
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Remove {target.email}&apos;s authenticator and backup codes, for
            example after they lose their phone. They will be signed out on all
            devices and can set two-factor up again in Security settings.
          </Dialog.Description>
          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reset-two-factor-password">
                Your current password
              </Label>
              <PasswordInput
                id="reset-two-factor-password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
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
                {submitting ? "Resetting…" : "Reset two-factor"}
              </Button>
            </SettingsActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
