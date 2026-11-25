import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import { getServerUrl, clearServerUrl } from "@/lib/server-url";
import { getAuthClient, resetAuthClient } from "@/lib/auth/client";
import { getAuthCookie } from "@/lib/api";
import { revokeNotifications } from "@/lib/notifications/client";
import {
  SettingsPage,
  Section,
  Row,
  WebRow,
  Label,
  useAction,
} from "@/components/settings/SettingsUI";
export default function Server() {
  const { t } = useTranslation();
  const session = getAuthClient().useSession();
  const server = getServerUrl() ?? "";
  const action = useAction();
  return (
    <SettingsPage title={t("settings.mobile.index.server")}>
      <Section title={t("settings.mobile.server.connectedServer")}>
        <Row title={t("settings.mobile.server.address")} detail={server} />
        <WebRow title={t("settings.mobile.server.openInBrowser")} path="/" />
      </Section>
      <Section description={t("settings.mobile.server.changeDescription")}>
        <Row
          title={t("app.error.changeServer")}
          icon="swap-horizontal-outline"
          disabled={action.busy}
          onPress={() =>
            Alert.alert(
              t("settings.mobile.server.confirmTitle"),
              t("settings.mobile.server.confirmMessage"),
              [
                { text: t("auth.actions.cancel"), style: "cancel" },
                {
                  text: t("auth.twoFactor.setup.continue"),
                  onPress: () =>
                    void action.run(async () => {
                      await getAuthCookie()
                        .then((cookie) =>
                          revokeNotifications({ server, userId: session.data?.user.id ?? "", cookie }),
                        )
                        .catch(() => {});
                      const result = await getAuthClient().signOut();
                      if (result.error)
                        throw new Error(
                          result.error.message ??
                            t("settings.mobile.index.signOutFailed"),
                        );
                      await clearServerUrl();
                      resetAuthClient();
                    }),
                },
              ],
            )
          }
        />
      </Section>
      {action.error && <Label error>{action.error}</Label>}
    </SettingsPage>
  );
}
