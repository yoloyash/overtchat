"use client";

import { getErrorMessage } from "@/lib/errors";
import { usePersonalization } from "@/lib/queries/personalization";
import {
  SettingsNotice,
  SettingsPage,
  SettingsPageHeader,
} from "../_components/SettingsRows";
import { MemoryManager } from "./MemoryManager";
import { ProfileEditor } from "./ProfileEditor";

export function PersonalizationForm() {
  const { data, isPending, error: loadError } = usePersonalization();

  return (
    <SettingsPage>
      <SettingsPageHeader
        title="Personalization"
        description="Tell OvertChat about you and manage what it remembers between chats."
      />

      {isPending ? (
        <SettingsNotice>Loading personalization…</SettingsNotice>
      ) : loadError || !data ? (
        <SettingsNotice tone="error">
          {getErrorMessage(loadError, "Unable to load personalization.")}
        </SettingsNotice>
      ) : (
        <>
          <ProfileEditor
            key={JSON.stringify(data.personalization)}
            personalization={data.personalization}
          />
          <MemoryManager memories={data.memories} usage={data.contextUsage} />
        </>
      )}
    </SettingsPage>
  );
}
