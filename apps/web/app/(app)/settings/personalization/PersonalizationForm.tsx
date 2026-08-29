"use client";

import { getErrorMessage } from "@/lib/errors";
import { usePersonalization } from "@/lib/queries/personalization";
import {
  SettingsNotice,
  SettingsPageHeader,
} from "../_components/SettingsRows";
import { MemoryManager } from "./MemoryManager";
import { ProfileEditor } from "./ProfileEditor";

export function PersonalizationForm() {
  const { data, isPending, error: loadError } = usePersonalization();

  if (isPending) {
    return (
      <p className="text-sm text-muted-foreground">
        Loading personalization…
      </p>
    );
  }
  if (loadError || !data) {
    return (
      <SettingsNotice tone="error">
        {getErrorMessage(loadError, "Unable to load personalization.")}
      </SettingsNotice>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      <SettingsPageHeader
        title="Personalization"
        description="Tell OvertChat about you and manage what it remembers between chats."
      />

      <ProfileEditor
        key={JSON.stringify(data.personalization)}
        personalization={data.personalization}
      />

      <MemoryManager memories={data.memories} usage={data.contextUsage} />
    </div>
  );
}
