"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/auth/client";
import {
  SettingsActions,
  SettingsNotice,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../_components/SettingsRows";

export function AccountForm({
  email,
  name: initialName,
}: {
  email: string;
  name: string;
}) {
  const [name, setName] = useState(initialName);
  const [profileStatus, setProfileStatus] = useState<
    "idle" | "submitting" | "ok"
  >("idle");
  const [profileError, setProfileError] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwStatus, setPwStatus] = useState<"idle" | "submitting" | "ok">(
    "idle",
  );

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setProfileError("Name is required.");
      return;
    }
    setProfileStatus("submitting");
    setProfileError("");
    const { error } = await authClient.updateUser({ name: trimmed });
    if (error) {
      setProfileStatus("idle");
      setProfileError(error.message ?? "Failed to update profile");
      return;
    }
    setProfileStatus("ok");
  }

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
        title="Account"
        description={
          <>
            Signed in as <span className="text-foreground">{email}</span>.
          </>
        }
      />

      <div className="space-y-10">
        <form onSubmit={saveProfile} className="space-y-4">
          <SettingsSection
            title="Profile"
            description="Shown in the sidebar and around chats."
          >
            <SettingsRow
              title="Name"
              description="Use the name people should recognize on this server."
              htmlFor="name"
              align="center"
            >
              <Input
                id="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setProfileStatus("idle");
                  setProfileError("");
                }}
              />
            </SettingsRow>
          </SettingsSection>

          {profileError && (
            <SettingsNotice tone="error">{profileError}</SettingsNotice>
          )}

          <SettingsActions>
            {profileStatus === "ok" && (
              <SettingsNotice tone="success" className="mr-auto">
                Profile updated
              </SettingsNotice>
            )}
            <Button
              type="submit"
              disabled={
                profileStatus === "submitting" || name.trim() === initialName
              }
            >
              {profileStatus === "submitting" ? "Saving…" : "Save"}
            </Button>
          </SettingsActions>
        </form>

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
            >
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
            </SettingsRow>

            <SettingsRow
              title="New password"
              description="Use at least 8 characters."
              htmlFor="new"
              align="center"
            >
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
            </SettingsRow>
          </SettingsSection>

          {pwError && <SettingsNotice tone="error">{pwError}</SettingsNotice>}

          <SettingsActions>
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
    </div>
  );
}
