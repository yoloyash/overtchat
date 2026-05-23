"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/auth/client";

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
      setProfileError("Name is required");
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
    <div className="max-w-xl space-y-10">
      <header>
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          Account
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in as <span className="text-foreground">{email}</span>.
        </p>
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">Profile</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Shown in the sidebar and on chats.
          </p>
        </div>

        <form onSubmit={saveProfile} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {profileError && (
            <p className="text-sm text-destructive">{profileError}</p>
          )}

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={
                profileStatus === "submitting" || name.trim() === initialName
              }
            >
              {profileStatus === "submitting" ? "Saving…" : "Save"}
            </Button>
            {profileStatus === "ok" && (
              <span className="text-sm text-ring">Saved</span>
            )}
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">Change password</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Signs you out of all other sessions.
          </p>
        </div>

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
          <div className="space-y-1.5">
            <Label htmlFor="current">Current password</Label>
            <PasswordInput
              id="current"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new">New password</Label>
            <PasswordInput
              id="new"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          {pwError && <p className="text-sm text-destructive">{pwError}</p>}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pwStatus === "submitting"}>
              {pwStatus === "submitting" ? "Saving…" : "Change password"}
            </Button>
            {pwStatus === "ok" && (
              <span className="text-sm text-ring">Password updated</span>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
