import { useTranslation } from "react-i18next";
import { useChatPreferences, setChatPreferences } from "@/lib/chatPreferences";
import {
  SettingsPage,
  Section,
  Choice,
  Toggle,
  Row,
  QueryState,
  Label,
  WebRow,
  useRefreshOnFocus,
} from "@/components/settings/SettingsUI";
import { getAuthClient } from "@/lib/auth/client";
import {
  setOpenUIEnabled,
  setWebSearchEnabled,
  useOpenUIEnabled,
  useWebSearchEnabled,
} from "@/lib/toolPreferences";
import { useSettingsQuery, useSettingsMutation } from "@/lib/queries/settings";
import type { AvailableMcpServer } from "@overtchat/shared/admin-settings";

export default function ChatSettings() {
  const { t } = useTranslation();
  const prefs = useChatPreferences();
  const web = useWebSearchEnabled();
  const openui = useOpenUIEnabled();
  const session = getAuthClient().useSession();
  const query = useSettingsQuery<{ mcpServers: AvailableMcpServer[] }>(
    "/mcp-server-preferences",
  );
  const mutation = useSettingsMutation();
  useRefreshOnFocus(query.refetch);
  const toolAccessOptions = [
    { value: "always", label: t("tools.accessChoice.alwaysAvailable") },
    { value: "on-demand", label: t("tools.accessChoice.onDemand") },
  ] as const;
  return (
    <SettingsPage title={t("settings.mobile.index.chatAndTools")}>
      <Section
        title={t("settings.general.messages.title")}
        description={t("settings.mobile.chat.messagesDescription")}
      >
        <Toggle
          title={t("settings.general.messages.expandActivity.title")}
          detail={t("settings.mobile.chat.expandActivityDetail")}
          value={prefs.expandActivity}
          onChange={(expandActivity) => setChatPreferences({ expandActivity })}
        />
        <Toggle
          title={t("settings.general.messages.messageStats.title")}
          detail={t("settings.mobile.chat.messageStatsDetail")}
          value={prefs.messageStats}
          onChange={(messageStats) => setChatPreferences({ messageStats })}
        />
        <Toggle
          title={t("settings.general.messages.contextMeter.title")}
          detail={t("settings.mobile.chat.contextMeterDetail")}
          value={prefs.contextMeter}
          onChange={(contextMeter) => setChatPreferences({ contextMeter })}
        />
        <Toggle
          title={t("settings.general.messages.sessionCost.title")}
          detail={t("settings.mobile.chat.sessionCostDetail")}
          value={prefs.sessionCost}
          onChange={(sessionCost) => setChatPreferences({ sessionCost })}
        />
      </Section>
      <Section
        title={t("tools.builtIn.title")}
        description={t("settings.appearance.display.description")}
      >
        <Toggle
          title={t("tools.builtIn.webSearch.title")}
          detail={t("tools.mobile.webSearchDetail")}
          value={web}
          onChange={setWebSearchEnabled}
        />
      </Section>
      <Section
        title={t("tools.interactiveUi.title")}
        description={t("tools.mobile.interactiveUiDescription")}
      >
        <Choice
          title={t("tools.interactiveUi.toolAccessTitle")}
          detail={t("tools.mobile.interactiveUiToolAccessDetail")}
          value={openui ? "always" : "on-demand"}
          options={toolAccessOptions}
          onChange={(value) => setOpenUIEnabled(value === "always")}
        />
      </Section>
      <Section
        title={t("tools.mobile.connectedToolsTitle")}
        description={t("tools.mobile.connectedToolsDescription")}
      >
        <QueryState query={query} />
        {query.data?.mcpServers.map((server) => (
          <Toggle
            key={server.id}
            title={server.name}
            value={server.enabled}
            disabled={mutation.isPending}
            onChange={(enabled) =>
              mutation.mutate({
                path: `/mcp-server-preferences/${server.id}`,
                body: { enabled },
              })
            }
          />
        ))}
        {query.data?.mcpServers.length === 0 && <RowEmpty />}
      </Section>
      {mutation.error && <Label error>{mutation.error.message}</Label>}
      {session.data?.user.role === "admin" && (
        <Section title={t("settings.nav.groups.administration")}>
          <WebRow
            title={t("tools.mcp.manage.title")}
            path="/settings/tools"
            detail={t("tools.mobile.manageMcpDetail")}
          />
        </Section>
      )}
    </SettingsPage>
  );
}
function RowEmpty() {
  const { t } = useTranslation();
  return (
    <Row
      title={t("tools.mobile.emptyTitle")}
      detail={t("tools.mobile.emptyDetail")}
    />
  );
}
