"use client";

import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@/lib/errors";
import { usePersonalization } from "@/lib/queries/personalization";
import {
  SettingsNotice,
  SettingsPage,
  SettingsPageHeader,
} from "../SettingsRows";
import { MemoryManager } from "./MemoryManager";
import { ProfileEditor } from "./ProfileEditor";

export function PersonalizationForm() {
  const { t } = useTranslation();
  const { data, isPending, error: loadError } = usePersonalization();

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t("personalization.title")}
        description={t("personalization.description")}
      />

      {isPending ? (
        <SettingsNotice>{t("personalization.loading")}</SettingsNotice>
      ) : loadError || !data ? (
        <SettingsNotice tone="error">
          {getErrorMessage(loadError, t("personalization.loadError"))}
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
