import { useLocalSearchParams } from "expo-router";
import {
  agentProviderMetadata,
  type AgentConnectionListItem,
  type HostConnectorListItem,
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

export default function ConnectionDetails() {
  return (
    <AdminGate>
      <Details />
    </AdminGate>
  );
}
function Details() {
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
    : "Connection";
  return (
    <SettingsPage title={name}>
      <QueryState query={query} />
      <QueryState query={hosts} />
      {query.data && !connection && (
        <Label>This connection no longer exists.</Label>
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
                  ? `Version ${connection.detectedVersion}`
                  : "Version not detected"
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
                  ? `SSH · ${connection.host.sshAlias ?? connection.host.name}`
                  : "Runs on the connected computer"
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
          </Section>
          <Section
            title="Connection"
            description={
              connector?.online === false
                ? "Bring the Host Connector online before testing this agent."
                : undefined
            }
          >
            <Row
              title="Last verified"
              detail={
                connection.lastValidatedAt
                  ? new Date(connection.lastValidatedAt).toLocaleString()
                  : "Not tested yet"
              }
            />
            <Row
              title={action.busy ? "Testing connection…" : "Test connection"}
              icon="pulse-outline"
              disabled={action.busy || !connector?.online}
              onPress={() =>
                void action.run(async () => {
                  await settingsRequest(
                    `/agent-connections/${connection.id}`,
                    "POST",
                  );
                  await query.refetch();
                  toastSuccess(`${name} connection healthy`);
                })
              }
            />
          </Section>
          {action.error && <Label error>{action.error}</Label>}
          <Section
            title="Workspaces"
            description="Folders this agent can work in."
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
                title="No workspaces yet"
                detail="Add a workspace from web settings to start using this agent."
              />
            )}
          </Section>
          <Section>
            <WebRow
              title="Manage on web"
              path="/settings/connections"
              detail="Edit workspaces, SSH setup, or remove this connection."
            />
          </Section>
        </>
      )}
    </SettingsPage>
  );
}
