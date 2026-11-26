import { useTranslation } from "react-i18next";
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
import { useTwoFactorStatus } from "@/lib/queries/twoFactor";
import {
  changeNotificationPreferences,
  useNotificationSettings,
  type NotificationPreferences,
} from "@/lib/notifications/client";
export default function Notifications() {
  const { t } = useTranslation();
  const session = getAuthClient().useSession();
  const cookie = useAuthCookie();
  const scope = {
    server: getServerUrl() ?? "",
    userId: session.data?.user.id ?? "",
    cookie: cookie ?? "",
  };
  const { settings, error } = useNotificationSettings(scope);
  const twoFactor = useTwoFactorStatus();
  const action = useAction();
  const change = (patch: Partial<NotificationPreferences>) => {
    if (cookie) void action.run(() => changeNotificationPreferences(scope, patch));
  };
  return (
    <SettingsPage title={t("settings.mobile.index.notifications")}>
      <Section
        title={t("settings.mobile.notifications.responsesTitle")}
        description={t("settings.mobile.notifications.responsesDescription")}
      >
        <Toggle
          title={t("settings.mobile.notifications.chatResponsesTitle")}
          detail={t("settings.mobile.notifications.chatResponsesDetail")}
          value={settings.chats}
          onChange={(chats) => change({ chats })}
          disabled={action.busy || !cookie}
        />
        <Toggle
          title={t("settings.mobile.notifications.agentActivityTitle")}
          detail={t("settings.mobile.notifications.agentActivityDetail")}
          value={settings.agents}
          onChange={(agents) => change({ agents })}
          disabled={action.busy || !cookie}
        />
      </Section>
      {twoFactor.data?.enabled ? (
        <Section title={t("settings.mobile.notifications.securityTitle")}>
          <Toggle
            title={t("settings.mobile.notifications.signInRequestsTitle")}
            detail={t("settings.mobile.notifications.signInRequestsDetail")}
            value={settings.signIns}
            onChange={(signIns) => change({ signIns })}
            disabled={action.busy || !cookie}
          />
        </Section>
      ) : null}
      <Section title={t("settings.mobile.notifications.privacyTitle")}>
        <Toggle
          title={t("settings.mobile.notifications.showPreviewsTitle")}
          detail={t("settings.mobile.notifications.showPreviewsDetail")}
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
          title={t("settings.mobile.notifications.phoneSettingsTitle")}
          detail={t("settings.mobile.notifications.phoneSettingsDetail")}
          external
          onPress={() => void action.run(() => Linking.openSettings())}
        />
      </Section>
    </SettingsPage>
  );
}
