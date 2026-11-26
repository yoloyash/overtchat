"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import {
  ABOUT_MAX_LENGTH,
  OCCUPATION_MAX_LENGTH,
  PREFERRED_NAME_MAX_LENGTH,
  type Personalization,
} from "@/lib/personalization/schema";
import { useUpdatePersonalization } from "@/lib/queries/personalization";
import {
  SettingsActions,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
} from "../SettingsRows";

export function ProfileEditor({
  personalization,
}: {
  personalization: Personalization;
}) {
  const { t } = useTranslation();
  const updatePersonalization = useUpdatePersonalization();
  const [enabled, setEnabled] = useState(personalization.enabled);
  const [preferredName, setPreferredName] = useState(
    personalization.preferredName ?? "",
  );
  const [occupation, setOccupation] = useState(personalization.occupation ?? "");
  const [about, setAbout] = useState(personalization.about ?? "");
  const [error, setError] = useState("");
  const changed =
    enabled !== personalization.enabled ||
    preferredName.trim() !== (personalization.preferredName ?? "") ||
    occupation.trim() !== (personalization.occupation ?? "") ||
    about.trim() !== (personalization.about ?? "");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await updatePersonalization.mutateAsync({
        enabled,
        preferredName,
        occupation,
        about,
      });
      toast.success({ title: t("personalization.profile.savedToast") });
    } catch (cause) {
      setError(getErrorMessage(cause, t("personalization.profile.saveError")));
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <SettingsSection
        title={t("personalization.profile.title")}
        description={t("personalization.profile.description")}
      >
        <SettingsRow
          title={t("personalization.profile.enabled.title")}
          description={t("personalization.profile.enabled.description")}
          htmlFor="personalization-enabled"
          align="center"
          controlAlign="end"
          layout="toggle"
        >
          <Switch
            id="personalization-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </SettingsRow>
        <SettingsRow
          title={t("personalization.profile.preferredName.title")}
          description={t("personalization.profile.preferredName.description")}
          htmlFor="preferred-name"
        >
          <Input
            id="preferred-name"
            maxLength={PREFERRED_NAME_MAX_LENGTH}
            value={preferredName}
            onChange={(event) => setPreferredName(event.target.value)}
            placeholder={t("personalization.profile.optionalPlaceholder")}
          />
        </SettingsRow>
        <SettingsRow title={t("personalization.profile.occupation.title")} htmlFor="occupation">
          <Input
            id="occupation"
            maxLength={OCCUPATION_MAX_LENGTH}
            value={occupation}
            onChange={(event) => setOccupation(event.target.value)}
            placeholder={t("personalization.profile.optionalPlaceholder")}
          />
        </SettingsRow>
        <SettingsRow
          title={t("personalization.profile.about.title")}
          align="start"
          description={t("personalization.profile.about.description")}
          htmlFor="about-user"
        >
          <Textarea
            id="about-user"
            maxLength={ABOUT_MAX_LENGTH}
            value={about}
            onChange={(event) => setAbout(event.target.value)}
            placeholder={t("personalization.profile.optionalPlaceholder")}
            className="min-h-28"
          />
        </SettingsRow>
      </SettingsSection>
      {error && <SettingsNotice tone="error">{error}</SettingsNotice>}
      <SettingsActions bordered={false}>
        <Button
          type="submit"
          disabled={!changed || updatePersonalization.isPending}
        >
          {updatePersonalization.isPending
            ? t("common.states.saving")
            : t("common.actions.save")}
        </Button>
      </SettingsActions>
    </form>
  );
}
