import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import {
  agentProviderMetadata,
  type AgentConnectionListItem,
  type HostConnectorListItem,
} from "@overtchat/agent-bridge";
import { useFormatLocale } from "@/components/I18nProvider";
import { AgentProviderIcon } from "@/components/agents/AgentProviderIcon";
import { AdminGate } from "@/components/settings/AdminGate";
import { SettingsStatus } from "@/components/settings/SettingsStatus";
import {
  SettingsPage,
  Section,
  Row,
  Label,
  QueryState,
  WebRow,
  useAction,
  useRefreshOnFocus,
} from "@/components/settings/SettingsUI";
import { useSettingsQuery, settingsRequest } from "@/lib/queries/settings";
import { toastSuccess } from "@/lib/toast";

export default function ConnectionDetails() {
  return (
    <AdminGate>
      <Details />
    </AdminGate>
  );
}
function Details() {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useSettingsQuery<{ connections: AgentConnectionListItem[] }>(
    "/agent-connections",
    true,
  );
  const hosts = useSettingsQuery<{ connectors: HostConnectorListItem[] }>(
    "/host-connectors",
    true,
  );
  const action = useAction();
  useRefreshOnFocus(query.refetch);
  useRefreshOnFocus(hosts.refetch);
  const connection = query.data?.connections.find((item) => item.id === id);
  const connector = hosts.data?.connectors.find(
    (item) => item.id === connection?.host.connectorId,
  );
  const name = connection
    ? agentProviderMetadata(connection.provider).label
    : t("connections.mobile.detail.title");
  return (
    <SettingsPage title={name}>
      <QueryState query={query} />
      <QueryState query={hosts} />
      {query.data && !connection && (
        <Label>{t("connections.mobile.detail.notFound")}</Label>
      )}
      {connection && (
        <>
          <Section>
            <Row
              title={name}
              leading={
                <AgentProviderIcon provider={connection.provider} size={36} />
              }
              detail={
                connection.detectedVersion
                  ? t("connections.mobile.common.version", {
                      version: connection.detectedVersion,
                    })
                  : t("connections.mobile.detail.versionNotDetected")
              }
            />
            <Row
              title={connection.host.name}
              icon={
                connection.host.transport === "ssh"
                  ? "server-outline"
                  : "desktop-outline"
              }
              detail={
                connection.host.transport === "ssh"
                  ? t("connections.mobile.detail.sshHost", {
                      host: connection.host.sshAlias ?? connection.host.name,
                    })
                  : t("connections.mobile.detail.runsOnComputer")
              }
              status={
                <SettingsStatus
                  label={
                    connector
                      ? connector.online
                        ? t("connections.mobile.status.connectorOnline")
                        : t("connections.mobile.status.connectorOffline")
                      : t("connections.mobile.status.unavailable")
                  }
                  state={connector?.online ? "ready" : "neutral"}
                />
              }
            />
          </Section>
          <Section
            title={t("connections.mobile.detail.title")}
            description={
              connector?.online === false
                ? t("connections.mobile.detail.offlineHint")
                : undefined
            }
          >
            <Row
              title={t("connections.mobile.detail.lastVerified")}
              detail={
                connection.lastValidatedAt
                  ? new Date(connection.lastValidatedAt).toLocaleString(locale)
                  : t("connections.mobile.detail.notTestedYet")
              }
            />
            <Row
              title={
                action.busy
                  ? t("connections.mobile.detail.testing")
                  : t("connections.mobile.detail.testConnection")
              }
              icon="pulse-outline"
              disabled={action.busy || !connector?.online}
              onPress={() =>
                void action.run(async () => {
                  await settingsRequest(
                    `/agent-connections/${connection.id}`,
                    "POST",
                  );
                  await query.refetch();
                  toastSuccess(
                    t("connections.mobile.detail.testHealthy", { name }),
                  );
                })
              }
            />
          </Section>
          {action.error && <Label error>{action.error}</Label>}
          <Section
            title={t("connections.mobile.detail.workspacesTitle")}
            description={t("connections.mobile.detail.workspacesDescription")}
          >
            {connection.workspaces.map((workspace) => (
              <Row
                key={workspace.id}
                title={workspace.name}
                detail={workspace.path}
                icon="folder-outline"
              />
            ))}
            {!connection.workspaces.length && (
              <Row
                title={t("connections.mobile.detail.noWorkspacesTitle")}
                detail={t("connections.mobile.detail.noWorkspacesDetail")}
              />
            )}
          </Section>
          <Section>
            <WebRow
              title={t("connections.mobile.detail.manageOnWebTitle")}
              path="/settings/connections"
              detail={t("connections.mobile.detail.manageOnWebDetail")}
            />
          </Section>
        </>
      )}
    </SettingsPage>
  );
}
