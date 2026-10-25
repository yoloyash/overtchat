import { Linking } from "react-native";
import {
  SettingsPage,
  Section,
  Toggle,
  Row,
  Label,
  useAction,
} from "@/components/settings/SettingsUI";
import { getAuthClient } from "@/lib/auth/client";
import { getServerUrl } from "@/lib/server-url";
import { useAuthCookie } from "@/lib/auth/useAuthCookie";
import {
  changeNotificationPreferences,
  useNotificationSettings,
  type NotificationPreferences,
} from "@/lib/notifications/client";
export default function Notifications() {
  const session = getAuthClient().useSession();
  const cookie = useAuthCookie();
  const scope = {
    server: getServerUrl() ?? "",
    userId: session.data?.user.id ?? "",
    cookie: cookie ?? "",
  };
  const { settings, error } = useNotificationSettings(scope);
  const action = useAction();
  const change = (patch: Partial<NotificationPreferences>) => {
    if (cookie) void action.run(() => changeNotificationPreferences(scope, patch));
  };
  return (
    <SettingsPage title="Notifications">
      <Section
        title="Responses"
        description="For this device and account on this server."
      >
        <Toggle
          title="Chat responses"
          detail="When a saved chat response is ready."
          value={settings.chats}
          onChange={(chats) => change({ chats })}
          disabled={action.busy || !cookie}
        />
        <Toggle
          title="Agent activity"
          detail="When a coding agent becomes idle."
          value={settings.agents}
          onChange={(agents) => change({ agents })}
          disabled={action.busy || !cookie}
        />
      </Section>
      <Section title="Privacy">
        <Toggle
          title="Show previews"
          detail="Include chat text and agent names. Previews pass through Expo and Apple or Google and may appear on your lock screen."
          value={settings.previews}
          onChange={(previews) => change({ previews })}
          disabled={action.busy || !cookie}
        />
      </Section>
      {error || action.error ? (
        <Label error>{action.error || error}</Label>
      ) : null}
      <Section>
        <Row
          title="Phone notification settings"
          detail="Permission, sounds, and lock-screen visibility"
          external
          onPress={() => void action.run(() => Linking.openSettings())}
        />
      </Section>
    </SettingsPage>
  );
}
