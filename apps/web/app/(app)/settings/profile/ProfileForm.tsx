"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, ImageIcon } from "lucide-react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { activityKeys } from "@/lib/queries/keys";
import {
  SettingsActions,
  SettingsNotice,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../_components/SettingsRows";

type SaveStatus = "idle" | "submitting" | "ok";

export function ProfileForm({
  userId,
  name: initialName,
  image: initialImage,
}: {
  userId: string;
  name: string;
  image: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(initialName);
  const [image, setImage] = useState(initialImage ?? "");
  const [savedName, setSavedName] = useState(initialName);
  const [savedImage, setSavedImage] = useState(initialImage ?? "");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

  const previewName = name.trim() || initialName;
  const previewImage = validImageUrl(image);
  const changed = name.trim() !== savedName || image.trim() !== savedImage;

  function resetStatus() {
    setStatus("idle");
    setError("");
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Display name is required.");
      return;
    }

    const trimmedImage = image.trim();
    const normalizedImage = validImageUrl(trimmedImage);
    if (trimmedImage && !normalizedImage) {
      setError("Avatar URL must start with http:// or https://.");
      return;
    }

    setStatus("submitting");
    setError("");
    const { error: updateError } = await authClient.updateUser({
      name: trimmedName,
      image: normalizedImage,
    });
    if (updateError) {
      setStatus("idle");
      setError(updateError.message ?? "Failed to update profile.");
      return;
    }

    setName(trimmedName);
    setImage(normalizedImage ?? "");
    setSavedName(trimmedName);
    setSavedImage(normalizedImage ?? "");
    setStatus("ok");
    await queryClient.invalidateQueries({ queryKey: activityKeys.all() });
    router.refresh();
  }

  return (
    <div className="max-w-3xl space-y-8">
      <SettingsPageHeader
        title="Profile"
        description="Choose how you appear to other people on this server."
        action={
          <Button
            variant="outline"
            render={<Link href={`/activity/${userId}`} />}
          >
            <Activity />
            View activity profile
          </Button>
        }
      />

      <form onSubmit={saveProfile} className="space-y-4">
        <SettingsSection
          title="Identity"
          description="Your profile is visible on the leaderboard and activity pages."
        >
          <SettingsRow
            title="Preview"
            description="This updates as you edit."
            align="center"
            controlAlign="end"
          >
            <div className="flex w-full items-center gap-4 @2xl:max-w-sm">
              <ProfileAvatar
                id={userId}
                name={previewName}
                image={previewImage}
                size="lg"
              />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{previewName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Activity profile
                </p>
              </div>
            </div>
          </SettingsRow>

          <SettingsRow
            title="Display name"
            description="Use the name people should recognize."
            htmlFor="display-name"
            align="center"
            controlAlign="end"
          >
            <Input
              id="display-name"
              type="text"
              autoComplete="name"
              className="w-full @2xl:max-w-sm"
              maxLength={80}
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                resetStatus();
              }}
            />
          </SettingsRow>

          <SettingsRow
            title="Avatar URL"
            description="Optional. Use a direct link to an image."
            htmlFor="avatar-url"
            align="center"
            controlAlign="end"
          >
            <div className="relative w-full @2xl:max-w-sm">
              <ImageIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="avatar-url"
                type="url"
                inputMode="url"
                autoComplete="url"
                className="w-full pl-8"
                placeholder="https://example.com/avatar.jpg"
                value={image}
                onChange={(event) => {
                  setImage(event.target.value);
                  resetStatus();
                }}
              />
            </div>
          </SettingsRow>
        </SettingsSection>

        {error && <SettingsNotice tone="error">{error}</SettingsNotice>}

        <SettingsActions bordered={false}>
          {status === "ok" && (
            <SettingsNotice tone="success" className="mr-auto">
              Profile updated
            </SettingsNotice>
          )}
          <Button
            type="submit"
            disabled={status === "submitting" || !changed}
          >
            {status === "submitting" ? "Saving…" : "Save profile"}
          </Button>
        </SettingsActions>
      </form>
    </div>
  );
}

function validImageUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? trimmed
      : null;
  } catch {
    return null;
  }
}
