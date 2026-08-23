"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/auth/client";
import {
  SettingsActions,
  SettingsNotice,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../_components/SettingsRows";

export function AccountForm({ email }: { email: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwStatus, setPwStatus] = useState<"idle" | "submitting" | "ok">(
    "idle",
  );

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwStatus("submitting");
    setPwError("");
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (error) {
      setPwStatus("idle");
      setPwError(error.message ?? "Failed to change password");
      return;
    }
    setPwStatus("ok");
    setCurrentPassword("");
    setNewPassword("");
  }

  return (
    <div className="max-w-3xl space-y-8">
      <SettingsPageHeader
        title="Security"
        description={
          <>
            Signed in as <span className="text-foreground">{email}</span>.
          </>
        }
      />

      <form onSubmit={changePassword} className="space-y-4">
        {/* Hidden username anchor so password managers associate this
            credential with the signed-in account. */}
        <input
          type="email"
          name="email"
          autoComplete="username"
          defaultValue={email}
          readOnly
          hidden
        />
        <SettingsSection
          title="Password"
          description="Changing your password signs you out of all other sessions."
        >
          <SettingsRow
            title="Current password"
            htmlFor="current"
            align="center"
            controlAlign="end"
          >
            <div className="w-full @2xl:max-w-sm">
              <PasswordInput
                id="current"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setPwStatus("idle");
                  setPwError("");
                }}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title="New password"
            description="Use at least 8 characters."
            htmlFor="new"
            align="center"
            controlAlign="end"
          >
            <div className="w-full @2xl:max-w-sm">
              <PasswordInput
                id="new"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setPwStatus("idle");
                  setPwError("");
                }}
              />
            </div>
          </SettingsRow>
        </SettingsSection>

        {pwError && <SettingsNotice tone="error">{pwError}</SettingsNotice>}

        <SettingsActions bordered={false}>
          {pwStatus === "ok" && (
            <SettingsNotice tone="success" className="mr-auto">
              Password updated
            </SettingsNotice>
          )}
          <Button type="submit" disabled={pwStatus === "submitting"}>
            {pwStatus === "submitting" ? "Saving…" : "Change password"}
          </Button>
        </SettingsActions>
      </form>
    </div>
  );
}
