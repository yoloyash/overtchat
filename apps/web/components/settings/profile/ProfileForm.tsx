"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { Activity, ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { activityKeys, authKeys } from "@/lib/queries/keys";
import {
  SettingsActions,
  SettingsNotice,
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../SettingsRows";

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
  const { t } = useTranslation();
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
      setError(t("profile.errors.nameRequired"));
      return;
    }

    const trimmedImage = image.trim();
    const normalizedImage = validImageUrl(trimmedImage);
    if (trimmedImage && !normalizedImage) {
      setError(t("profile.errors.invalidAvatarUrl"));
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
      setError(updateError.message ?? t("profile.errors.updateFailed"));
      return;
    }

    setName(trimmedName);
    setImage(normalizedImage ?? "");
    setSavedName(trimmedName);
    setSavedImage(normalizedImage ?? "");
    setStatus("ok");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: activityKeys.all() }),
      queryClient.invalidateQueries({ queryKey: authKeys.session() }),
    ]);
    await router.invalidate();
  }

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t("profile.title")}
        description={t("profile.description")}
        action={
          <Button
            variant="outline"
            render={<Link to="/activity/$userId" params={{ userId }} />}
          >
            <Activity />
            {t("profile.viewActivity")}
          </Button>
        }
      />

      <form onSubmit={saveProfile} className="space-y-4">
        <SettingsSection
          title={t("profile.identity.title")}
          description={t("profile.identity.description")}
        >
          <SettingsRow
            title={t("profile.preview.title")}
            description={t("profile.preview.description")}
            align="center"
            controlAlign="end"
          >
            <div className="flex w-full items-center gap-4">
              <ProfileAvatar
                id={userId}
                name={previewName}
                image={previewImage}
                size="lg"
              />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{previewName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("profile.preview.subtitle")}
                </p>
              </div>
            </div>
          </SettingsRow>

          <SettingsRow
            title={t("profile.displayName.title")}
            description={t("profile.displayName.description")}
            htmlFor="display-name"
            align="center"
            controlAlign="end"
          >
            <Input
              id="display-name"
              type="text"
              autoComplete="name"
              className="w-full"
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
            title={t("profile.avatarUrl.title")}
            description={t("profile.avatarUrl.description")}
            htmlFor="avatar-url"
            align="center"
            controlAlign="end"
          >
            <div className="relative w-full">
              <ImageIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="avatar-url"
                type="url"
                inputMode="url"
                autoComplete="url"
                className="w-full pl-8"
                // eslint-disable-next-line i18next/no-literal-string -- example URL
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
              {t("profile.updated")}
            </SettingsNotice>
          )}
          <Button
            type="submit"
            disabled={status === "submitting" || !changed}
          >
            {status === "submitting" ? t("common.states.saving") : t("profile.save")}
          </Button>
        </SettingsActions>
      </form>
    </SettingsPage>
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
