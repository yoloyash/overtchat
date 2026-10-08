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
  const session = getAuthClient().useSession();
  const user = session.data?.user;
  const server = getServerUrl() ?? "";
  const theme = useThemePref();
  const action = useAction();
  return (
    <SettingsPage title="Settings">
      <Section>
        <Row
          title={user?.name || "Your profile"}
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
      <Section title="Preferences">
        <Row
          title="Appearance"
          icon="color-palette-outline"
          value={
            theme === "system" ? "System" : theme === "light" ? "Light" : "Dark"
          }
          navigation
          onPress={() => router.push("/settings/appearance")}
        />
        <Row
          title="Chat & tools"
          icon="chatbubble-outline"
          navigation
          onPress={() => router.push("/settings/chat")}
        />
        <Row
          title="Personalization"
          icon="sparkles-outline"
          navigation
          onPress={() => router.push("/personalization")}
        />
        <Row
          title="Notifications"
          icon="notifications-outline"
          navigation
          onPress={() => router.push("/settings/notifications")}
        />
      </Section>
      <Section title="Account">
        <Row
          title="Security"
          icon="lock-closed-outline"
          navigation
          onPress={() => router.push("/settings/security")}
        />
        <Row
          title="Data & backups"
          icon="folder-outline"
          navigation
          onPress={() => router.push("/settings/data")}
        />
      </Section>
      {user?.role === "admin" && (
        <Section
          title="Administration"
          description="Changes here affect everyone on this server."
        >
          <Row
            title="Users"
            icon="people-outline"
            navigation
            onPress={() => router.push("/settings/users")}
          />
          <Row
            title="Models"
            icon="cube-outline"
            navigation
            onPress={() => router.push("/settings/models")}
          />
          <Row
            title="Services"
            icon="server-outline"
            navigation
            onPress={() => router.push("/settings/services")}
          />
          <Row
            title="Agent connections"
            icon="terminal-outline"
            navigation
            onPress={() => router.push("/settings/connections")}
          />
        </Section>
      )}
      <Section title="App">
        <Row
          title="Server"
          detail={server}
          icon="globe-outline"
          navigation
          onPress={() => router.push("/settings/server")}
        />
        <Row
          title="About"
          icon="information-circle-outline"
          navigation
          onPress={() => router.push("/settings/about")}
        />
      </Section>
      {action.error ? <Label error>{action.error}</Label> : null}
      <Section>
        <Row
          title={action.busy ? "Signing out…" : "Sign out"}
          icon="log-out-outline"
          destructive
          disabled={action.busy}
          onPress={() =>
            void action.run(async () => {
              await revokeNotifications({
                server,
                userId: user?.id ?? "",
                cookie: getAuthCookie(),
              }).catch(() => {});
              const result = await getAuthClient().signOut();
              if (result.error)
                throw new Error(result.error.message ?? "Couldn’t sign out.");
              await session.refetch();
            })
          }
        />
      </Section>
    </SettingsPage>
  );
}
