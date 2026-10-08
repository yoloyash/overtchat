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
      title="Agent connections"
      action={{
        label: "Refresh connections",
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
              title={host.transport === "ssh" ? "SSH host" : "Host Connector"}
              icon={
                host.transport === "ssh" ? "server-outline" : "desktop-outline"
              }
              detail={
                host.transport === "ssh"
                  ? (host.sshAlias ?? undefined)
                  : connector?.version
                    ? `Connector ${connector.version}`
                    : undefined
              }
              status={
                <SettingsStatus
                  label={
                    connector
                      ? connector.online
                        ? "Connector online"
                        : "Connector offline"
                      : "Status unavailable"
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
                detail={`${connection.workspaces.length} ${connection.workspaces.length === 1 ? "workspace" : "workspaces"}${connection.detectedVersion ? ` · ${connection.detectedVersion}` : ""}`}
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
              title="Host Connector"
              icon="desktop-outline"
              detail={
                connector.version ? `Version ${connector.version}` : undefined
              }
              status={
                <SettingsStatus
                  label={connector.online ? "Online" : "Offline"}
                  state={connector.online ? "ready" : "neutral"}
                />
              }
            />
            {connections.data && (
              <Row
                title="No agents connected"
                detail="Add an agent and workspace from the web setup."
              />
            )}
          </Section>
        ))}
      {hosts.data?.connectors.length === 0 &&
        connections.data?.connections.length === 0 && (
          <Section>
            <Row
              title="Connect your computer"
              icon="desktop-outline"
              detail="Pair a Host Connector to use the coding agents installed on your computer."
            />
          </Section>
        )}
      <Section title="Setup">
        <Row
          title={action.busy ? "Creating command…" : "Pair a computer"}
          icon="add-circle-outline"
          detail="Create a command to run on the computer you want to connect."
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
          title="Manage agents & workspaces"
          path="/settings/connections"
          detail="Add or remove connections and configure SSH in your browser."
        />
      </Section>
      {pairing && (
        <Section
          title="Pairing command"
          description={`Run this on your computer. Expires ${new Date(pairing.expiresAt).toLocaleTimeString()}.`}
        >
          <Row
            title="Copy pairing command"
            icon="copy-outline"
            onPress={() =>
              void action.run(async () => {
                await Clipboard.setStringAsync(pairing.command);
                toastSuccess("Command copied");
              })
            }
          />
        </Section>
      )}
      {action.error && <Label error>{action.error}</Label>}
    </SettingsPage>
  );
}
