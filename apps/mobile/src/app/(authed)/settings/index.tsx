import { useTranslation } from "react-i18next";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { router } from "expo-router";
import { getAuthClient } from "@/lib/auth/client";
import { getServerUrl } from "@/lib/server-url";
import { getAuthCookie } from "@/lib/api";
import { revokeNotifications } from "@/lib/notifications/client";
import {
  SettingsPage,
  Section,
  Row,
  Label,
  useAction,
} from "@/components/settings/SettingsUI";
import { useThemePref } from "@/lib/appearance";

export default function SettingsIndex() {
  const { t } = useTranslation();
  const session = getAuthClient().useSession();
  const user = session.data?.user;
  const server = getServerUrl() ?? "";
  const theme = useThemePref();
  const action = useAction();
  return (
    <SettingsPage title={t("app.pages.settings.title")}>
      <Section>
        <Row
          title={user?.name || t("settings.mobile.index.yourProfile")}
          detail={user?.email}
          leading={
            <UserAvatar
              name={user?.name}
              email={user?.email}
              image={user?.image}
              size={44}
            />
          }
          navigation
          onPress={() => router.push("/settings/profile")}
        />
      </Section>
      <Section title={t("settings.nav.groups.preferences")}>
        <Row
          title={t("settings.appearance.title")}
          icon="color-palette-outline"
          value={
            theme === "system"
              ? t("settings.appearance.theme.system")
              : theme === "light"
                ? t("settings.appearance.theme.light")
                : t("settings.appearance.theme.dark")
          }
          navigation
          onPress={() => router.push("/settings/appearance")}
        />
        <Row
          title={t("settings.mobile.index.chatAndTools")}
          icon="chatbubble-outline"
          navigation
          onPress={() => router.push("/settings/chat")}
        />
        <Row
          title={t("settings.nav.items.personalization")}
          icon="sparkles-outline"
          navigation
          onPress={() => router.push("/personalization")}
        />
        <Row
          title={t("settings.mobile.index.notifications")}
          icon="notifications-outline"
          navigation
          onPress={() => router.push("/settings/notifications")}
        />
      </Section>
      <Section title={t("settings.nav.groups.account")}>
        <Row
          title={t("settings.nav.items.security")}
          icon="lock-closed-outline"
          navigation
          onPress={() => router.push("/settings/security")}
        />
        <Row
          title={t("settings.mobile.index.dataAndBackups")}
          icon="folder-outline"
          navigation
          onPress={() => router.push("/settings/data")}
        />
      </Section>
      {user?.role === "admin" && (
        <Section
          title={t("settings.nav.groups.administration")}
          description={t("settings.mobile.index.adminDescription")}
        >
          <Row
            title={t("settings.nav.items.users")}
            icon="people-outline"
            navigation
            onPress={() => router.push("/settings/users")}
          />
          <Row
            title={t("settings.nav.items.models")}
            icon="cube-outline"
            navigation
            onPress={() => router.push("/settings/models")}
          />
          <Row
            title={t("settings.nav.items.services")}
            icon="server-outline"
            navigation
            onPress={() => router.push("/settings/services")}
          />
          <Row
            title={t("settings.mobile.index.agentConnections")}
            icon="terminal-outline"
            navigation
            onPress={() => router.push("/settings/connections")}
          />
        </Section>
      )}
      <Section title={t("settings.mobile.index.appGroup")}>
        <Row
          title={t("settings.mobile.index.server")}
          detail={server}
          icon="globe-outline"
          navigation
          onPress={() => router.push("/settings/server")}
        />
        <Row
          title={t("settings.mobile.index.about")}
          icon="information-circle-outline"
          navigation
          onPress={() => router.push("/settings/about")}
        />
      </Section>
      {action.error ? <Label error>{action.error}</Label> : null}
      <Section>
        <Row
          title={
            action.busy
              ? t("settings.mobile.index.signingOut")
              : t("auth.actions.signOut")
          }
          icon="log-out-outline"
          destructive
          disabled={action.busy}
          onPress={() =>
            void action.run(async () => {
              await getAuthCookie()
                .then((cookie) =>
                  revokeNotifications({ server, userId: user?.id ?? "", cookie }),
                )
                .catch(() => {});
              const result = await getAuthClient().signOut();
              if (result.error)
                throw new Error(
                  result.error.message ?? t("settings.mobile.index.signOutFailed"),
                );
              await session.refetch();
            })
          }
        />
      </Section>
    </SettingsPage>
  );
}
