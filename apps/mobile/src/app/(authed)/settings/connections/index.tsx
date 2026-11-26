import { useTranslation } from "react-i18next";
import { useState } from "react";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import {
  agentProviderMetadata,
  type HostConnectorListItem,
  type HostConnectorPairing,
  type AgentConnectionListItem,
} from "@overtchat/agent-bridge";
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

export default function Connections() {
  return (
    <AdminGate>
      <ConnectionList />
    </AdminGate>
  );
}
function ConnectionList() {
  const { t } = useTranslation();
  const hosts = useSettingsQuery<{ connectors: HostConnectorListItem[] }>(
    "/host-connectors",
    true,
  );
  const connections = useSettingsQuery<{
    connections: AgentConnectionListItem[];
  }>("/agent-connections", true);
  const action = useAction();
  const [pairing, setPairing] = useState<HostConnectorPairing | null>(null);
  useRefreshOnFocus(hosts.refetch);
  useRefreshOnFocus(connections.refetch);
  const groups = new Map<
    string,
    {
      host: AgentConnectionListItem["host"];
      connections: AgentConnectionListItem[];
    }
  >();
  for (const connection of connections.data?.connections ?? []) {
    const group = groups.get(connection.host.id) ?? {
      host: connection.host,
      connections: [],
    };
    group.connections.push(connection);
    groups.set(connection.host.id, group);
  }
  return (
    <SettingsPage
      title={t("settings.mobile.index.agentConnections")}
      action={{
        label: t("connections.mobile.list.refreshLabel"),
        icon: "refresh-outline",
        disabled: hosts.isFetching || connections.isFetching,
        onPress: () => {
          void hosts.refetch();
          void connections.refetch();
        },
      }}
    >
      <QueryState query={hosts} />
      <QueryState query={connections} />
      {Array.from(groups.values()).map(({ host, connections: items }) => {
        const connector = hosts.data?.connectors.find(
          (item) => item.id === host.connectorId,
        );
        return (
          <Section key={host.id} title={host.name}>
            <Row
              title={
                host.transport === "ssh"
                  ? t("connections.hosts.sshHost")
                  : t("connections.host.infoTitle")
              }
              icon={
                host.transport === "ssh" ? "server-outline" : "desktop-outline"
              }
              detail={
                host.transport === "ssh"
                  ? (host.sshAlias ?? undefined)
                  : connector?.version
                    ? t("connections.mobile.list.connectorVersion", {
                        version: connector.version,
                      })
                    : undefined
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
            {items.map((connection) => (
              <Row
                key={connection.id}
                title={agentProviderMetadata(connection.provider).label}
                leading={
                  <AgentProviderIcon provider={connection.provider} size={28} />
                }
                detail={
                  connection.detectedVersion
                    ? t("connections.mobile.list.workspaceCountWithVersion", {
                        count: connection.workspaces.length,
                        version: connection.detectedVersion,
                      })
                    : t("connections.mobile.list.workspaceCount", {
                        count: connection.workspaces.length,
                      })
                }
                navigation
                onPress={() =>
                  router.push({
                    pathname: "/settings/connections/[id]",
                    params: { id: connection.id },
                  })
                }
              />
            ))}
          </Section>
        );
      })}
      {hosts.data?.connectors
        .filter(
          (connector) =>
            !Array.from(groups.values()).some(
              (group) => group.host.connectorId === connector.id,
            ),
        )
        .map((connector) => (
          <Section key={connector.id} title={connector.name}>
            <Row
              title={t("connections.host.infoTitle")}
              icon="desktop-outline"
              detail={
                connector.version
                  ? t("connections.mobile.common.version", {
                      version: connector.version,
                    })
                  : undefined
              }
              status={
                <SettingsStatus
                  label={
                    connector.online
                      ? t("connections.mobile.status.online")
                      : t("connections.mobile.status.offline")
                  }
                  state={connector.online ? "ready" : "neutral"}
                />
              }
            />
            {connections.data && (
              <Row
                title={t("connections.mobile.list.noAgentsTitle")}
                detail={t("connections.mobile.list.noAgentsDetail")}
              />
            )}
          </Section>
        ))}
      {hosts.data?.connectors.length === 0 &&
        connections.data?.connections.length === 0 && (
          <Section>
            <Row
              title={t("connections.mobile.list.emptyTitle")}
              icon="desktop-outline"
              detail={t("connections.mobile.list.emptyDetail")}
            />
          </Section>
        )}
      <Section title={t("connections.mobile.setup.title")}>
        <Row
          title={
            action.busy
              ? t("connections.mobile.setup.creatingCommand")
              : t("connections.mobile.setup.pairComputer")
          }
          icon="add-circle-outline"
          detail={t("connections.mobile.setup.pairComputerDetail")}
          disabled={action.busy}
          onPress={() =>
            void action.run(async () => {
              setPairing(
                await settingsRequest<HostConnectorPairing>(
                  "/host-connectors",
                  "POST",
                ),
              );
            })
          }
        />
        <WebRow
          title={t("connections.mobile.setup.manageOnWebTitle")}
          path="/settings/connections"
          detail={t("connections.mobile.setup.manageOnWebDetail")}
        />
      </Section>
      {pairing && (
        <Section
          title={t("connections.mobile.pairing.title")}
          description={t("connections.mobile.pairing.description", {
            time: new Date(pairing.expiresAt).toLocaleTimeString(),
          })}
        >
          <Row
            title={t("connections.mobile.pairing.copy")}
            icon="copy-outline"
            onPress={() =>
              void action.run(async () => {
                await Clipboard.setStringAsync(pairing.command);
                toastSuccess(t("connections.mobile.pairing.copied"));
              })
            }
          />
        </Section>
      )}
      {action.error && <Label error>{action.error}</Label>}
    </SettingsPage>
  );
}
