import { useTranslation } from "react-i18next";
import Constants from "expo-constants";
import {
  SettingsPage,
  Section,
  Row,
  QueryState,
} from "@/components/settings/SettingsUI";
import { useSettingsQuery } from "@/lib/queries/settings";
export default function About() {
  const { t } = useTranslation();
  const query = useSettingsQuery<{ version: string; apiLevel: number }>(
    "/ping",
  );
  return (
    <SettingsPage title={t("settings.mobile.index.about")}>
      {/* eslint-disable-next-line i18next/no-literal-string -- product name */}
      <Section title="OvertChat">
        <Row
          title={t("settings.mobile.about.appVersion")}
          value={Constants.expoConfig?.version ?? t("settings.mobile.about.unknown")}
        />
        <Row
          title={t("settings.mobile.about.build")}
          value={String(
            Constants.expoConfig?.android?.versionCode ??
              Constants.expoConfig?.ios?.buildNumber ??
              t("settings.mobile.about.development"),
          )}
        />
        <QueryState query={query} />
        {query.data && (
          <Row
            title={t("settings.mobile.about.serverVersion")}
            value={query.data.version}
          />
        )}
      </Section>
    </SettingsPage>
  );
}
