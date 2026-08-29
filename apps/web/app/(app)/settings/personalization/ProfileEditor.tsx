"use client";

import { useState } from "react";
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
} from "../_components/SettingsRows";

export function ProfileEditor({
  personalization,
}: {
  personalization: Personalization;
}) {
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
      toast.success({ title: "Personalization saved" });
    } catch (cause) {
      setError(getErrorMessage(cause, "Failed to save personalization."));
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <SettingsSection
        title="About you"
        description="These fields can only be changed here. Empty fields are not added to model context."
      >
        <SettingsRow
          title="Use personalization"
          description="Include your profile and saved memories in chats, and allow models to manage memory when asked. Temporary chats never use personalization."
          htmlFor="personalization-enabled"
          align="center"
          controlAlign="end"
        >
          <Switch
            id="personalization-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </SettingsRow>
        <SettingsRow
          title="Preferred name"
          description="What should OvertChat call you?"
          htmlFor="preferred-name"
        >
          <Input
            id="preferred-name"
            maxLength={PREFERRED_NAME_MAX_LENGTH}
            value={preferredName}
            onChange={(event) => setPreferredName(event.target.value)}
            placeholder="Optional"
          />
        </SettingsRow>
        <SettingsRow title="Occupation" htmlFor="occupation">
          <Input
            id="occupation"
            maxLength={OCCUPATION_MAX_LENGTH}
            value={occupation}
            onChange={(event) => setOccupation(event.target.value)}
            placeholder="Optional"
          />
        </SettingsRow>
        <SettingsRow
          title="More about you"
          description="Interests, values, or preferences to keep in mind."
          htmlFor="about-user"
        >
          <Textarea
            id="about-user"
            maxLength={ABOUT_MAX_LENGTH}
            value={about}
            onChange={(event) => setAbout(event.target.value)}
            placeholder="Optional"
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
          {updatePersonalization.isPending ? "Saving…" : "Save"}
        </Button>
      </SettingsActions>
    </form>
  );
}
