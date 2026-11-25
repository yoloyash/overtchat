import { useTranslation } from "react-i18next";
import { SettingsStatus } from "@/components/settings/SettingsStatus";
import { router } from "expo-router";
import type { VoiceCapability } from "@overtchat/shared";
import type { AdminServerCapability } from "@overtchat/shared/admin-settings";
import { AdminGate } from "@/components/settings/AdminGate";
import {
  SettingsPage,
  Section,
  Row,
  QueryState,
  useRefreshOnFocus,
} from "@/components/settings/SettingsUI";
import { useSettingsQuery } from "@/lib/queries/settings";
export const serviceNameKeys = {
  search: "services.capabilities.search.title",
  tts: "services.capabilities.tts.title",
  stt: "services.capabilities.stt.title",
} as const;
export type ServicesSnapshot = {
  capabilities: AdminServerCapability[];
  voice: VoiceCapability;
};
export default function Services() {
  return (
    <AdminGate>
      <ServiceList />
    </AdminGate>
  );
}
function ServiceList() {
  const { t } = useTranslation();
  const query = useSettingsQuery<ServicesSnapshot>(
    "/server-capabilities",
    true,
  );
  useRefreshOnFocus(query.refetch);
  return (
    <SettingsPage title={t("services.page.title")}>
      <QueryState query={query} />
      <Section
        title={t("services.mobile.list.sectionTitle")}
        description={t("services.mobile.list.sectionDescription")}
      >
        {query.data?.capabilities.map((item) => (
          <Row
            key={item.id}
            title={t(serviceNameKeys[item.id])}
            icon={
              item.id === "search"
                ? "search-outline"
                : item.id === "tts"
                  ? "volume-high-outline"
                  : "mic-outline"
            }
            status={
              <SettingsStatus
                label={
                  item.provider === "disabled"
                    ? t("services.capabilities.search.providers.disabled")
                    : item.configured
                      ? t("services.voice.configuredLabel")
                      : t("services.mobile.status.needsSetup")
                }
                state={
                  item.provider === "disabled"
                    ? "neutral"
                    : item.configured
                      ? "ready"
                      : "attention"
                }
              />
            }
            navigation
            onPress={() =>
              router.push({
                pathname: "/settings/services/[id]",
                params: { id: item.id },
              })
            }
          />
        ))}
      </Section>
      {query.data && (
        <Section title={t("services.voice.title")}>
          <Row
            title={t("services.mobile.voice.rowTitle")}
            icon="headset-outline"
            status={
              <SettingsStatus
                label={
                  query.data.voice.available
                    ? t("services.voice.configuredLabel")
                    : t("services.mobile.status.unavailable")
                }
                state={query.data.voice.available ? "ready" : "neutral"}
              />
            }
            detail={
              query.data.voice.available
                ? t("services.mobile.voice.readyDetail")
                : t("services.mobile.voice.unavailableDetail")
            }
          />
        </Section>
      )}
    </SettingsPage>
  );
}
