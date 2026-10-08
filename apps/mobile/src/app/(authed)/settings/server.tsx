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
  const session = getAuthClient().useSession();
  const server = getServerUrl() ?? "";
  const action = useAction();
  return (
    <SettingsPage title="Server">
      <Section title="Connected server">
        <Row title="Address" detail={server} />
        <WebRow title="Open server in browser" path="/" />
      </Section>
      <Section description="Changing servers signs you out on this device.">
        <Row
          title="Change server"
          icon="swap-horizontal-outline"
          disabled={action.busy}
          onPress={() =>
            Alert.alert(
              "Change server?",
              "You’ll be signed out on this device before choosing another server.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Continue",
                  onPress: () =>
                    void action.run(async () => {
                      await revokeNotifications({
                        server,
                        userId: session.data?.user.id ?? "",
                        cookie: getAuthCookie(),
                      }).catch(() => {});
                      const result = await getAuthClient().signOut();
                      if (result.error)
                        throw new Error(
                          result.error.message ?? "Couldn’t sign out.",
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
