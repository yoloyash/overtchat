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
export const serviceNames = {
  search: "Web search",
  tts: "Text-to-speech",
  stt: "Speech-to-text",
};
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
  const query = useSettingsQuery<ServicesSnapshot>(
    "/server-capabilities",
    true,
  );
  useRefreshOnFocus(query.refetch);
  return (
    <SettingsPage title="Services">
      <QueryState query={query} />
      <Section
        title="Server services"
        description="These providers are used by everyone on this server."
      >
        {query.data?.capabilities.map((item) => (
          <Row
            key={item.id}
            title={serviceNames[item.id]}
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
                    ? "Disabled"
                    : item.configured
                      ? "Configured"
                      : "Needs setup"
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
        <Section title="Realtime voice">
          <Row
            title="Voice conversations"
            icon="headset-outline"
            status={
              <SettingsStatus
                label={
                  query.data.voice.available ? "Configured" : "Unavailable"
                }
                state={query.data.voice.available ? "ready" : "neutral"}
              />
            }
            detail={
              query.data.voice.available
                ? "Ready for live voice conversations."
                : "Requires installed realtime voice and configured speech providers. Run overtchat setup on the host to install or repair it."
            }
          />
        </Section>
      )}
    </SettingsPage>
  );
}
