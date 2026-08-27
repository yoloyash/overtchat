"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Popover } from "@base-ui/react/popover";
import {
  Check,
  Clipboard,
  ExternalLink,
  Folder,
  Info,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  TerminalSquare,
  Trash2,
  Wifi,
} from "lucide-react";
import { BetaBadge } from "@/components/BetaBadge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type {
  AgentConnectionListItem,
  HostConnectorListItem,
  HostConnectorPairing,
} from "@overtchat/agent-bridge";
import {
  AGENT_PROVIDERS,
  agentProviderMetadata,
} from "@overtchat/agent-bridge";
import {
  agentConnectionTarget,
  groupAgentWorkspaces,
  projectAgentWorkspaceProviders,
  type AgentWorkspaceGroup,
} from "@/lib/agents/workspaces";
import { AGENT_PROVIDER_VISUALS } from "@/lib/agents/providerVisuals";
import {
  useAgentConnections,
  useAgentProviderSnapshot,
  useDeleteAgentConnection,
  useDeleteHostConnector,
  useDeleteAgentWorkspace,
  useCreateHostConnectorPairing,
  useHostConnectors,
  useTestAgentConnection,
} from "@/lib/queries/agentConnections";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  SettingsNotice,
  SettingsPageHeader,
  SettingsSection,
} from "../_components/SettingsRows";
import { AddAgentWorkspaceDialog } from "./AddAgentWorkspaceDialog";

type PendingDetach =
  | { type: "connector"; connector: HostConnectorListItem }
  | { type: "workspace-group"; group: AgentWorkspaceGroup };

export function ConnectionsPanel({
  initialAddOpen = false,
}: {
  initialAddOpen?: boolean;
}) {
  const router = useRouter();
  const { data: connections = [], error: listError } = useAgentConnections();
  const { data: connectors = [], error: connectorError } = useHostConnectors();
  const connector = connectors[0];
  const workspaceGroups = useMemo(
    () => groupAgentWorkspaces(connections),
    [connections],
  );
  const testMutation = useTestAgentConnection();
  const deleteConnectionMutation = useDeleteAgentConnection();
  const deleteWorkspaceMutation = useDeleteAgentWorkspace();
  const pairingMutation = useCreateHostConnectorPairing();
  const deleteConnectorMutation = useDeleteHostConnector();
  const [addOpen, setAddOpen] = useState(initialAddOpen);
  const [pairing, setPairing] = useState<HostConnectorPairing | null>(null);
  const [commandCopied, setCommandCopied] = useState(false);
  const [upgradeCopied, setUpgradeCopied] = useState(false);
  const [pendingDetach, setPendingDetach] = useState<PendingDetach | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [detachError, setDetachError] = useState("");

  async function testConnection(connection: AgentConnectionListItem) {
    const provider = agentProviderMetadata(connection.provider);
    setActionId(connection.id);
    try {
      const probe = await testMutation.mutateAsync(connection.id);
      toast.success({
        title: "Connection healthy",
        description: `${provider.label} ${probe.version} · ${probe.models.length} model${
          probe.models.length === 1 ? "" : "s"
        }`,
      });
    } catch (cause) {
      toast.error({
        title: "Connection test failed",
        description:
          cause instanceof Error ? cause.message : "The connection test failed.",
      });
    } finally {
      setActionId(null);
    }
  }

  async function confirmDetach() {
    if (!pendingDetach) return;
    setDetachError("");
    try {
      if (pendingDetach.type === "connector") {
        await deleteConnectorMutation.mutateAsync(
          pendingDetach.connector.id,
        );
        setPairing(null);
        toast.success({ title: "Host Connector removed" });
      } else {
        for (const { connection, workspace } of pendingDetach.group.targets) {
          if (connection.workspaces.length === 1) {
            await deleteConnectionMutation.mutateAsync(connection.id);
          } else {
            await deleteWorkspaceMutation.mutateAsync(workspace.id);
          }
        }
        toast.success({
          title: "Workspace removed",
          description: pendingDetach.group.name,
        });
      }
      setPendingDetach(null);
    } catch (cause) {
      setDetachError(
        cause instanceof Error ? cause.message : "The item could not be detached.",
      );
    }
  }

  const detaching =
    deleteConnectionMutation.isPending ||
    deleteWorkspaceMutation.isPending ||
    deleteConnectorMutation.isPending;

  async function createPairing() {
    try {
      setPairing(await pairingMutation.mutateAsync());
      setCommandCopied(false);
    } catch (cause) {
      toast.error({
        title: "Pairing failed",
        description:
          cause instanceof Error ? cause.message : "Could not create a pairing code.",
      });
    }
  }

  async function copyPairingCommand() {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.command);
    setCommandCopied(true);
  }

  async function copyUpgradeCommand() {
    if (!connector?.upgrade) return;
    await navigator.clipboard.writeText(connector.upgrade.command);
    setUpgradeCopied(true);
  }

  function setAddDialogOpen(open: boolean) {
    setAddOpen(open);
    if (!open && initialAddOpen) {
      router.replace("/settings/connections", { scroll: false });
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <SettingsPageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Agents
            <BetaBadge className="text-[10px]" />
          </span>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>Run coding agents in project folders on this server or over SSH.</span>
            <span
              className="inline-flex items-center gap-1"
              aria-label={`Supported agents: ${Object.values(AGENT_PROVIDERS)
                .map((provider) => provider.label)
                .join(", ")}.`}
            >
              {Object.values(AGENT_PROVIDERS).map((provider) => {
                const visual = AGENT_PROVIDER_VISUALS[provider.id];
                return (
                  <span
                    key={provider.id}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-md border bg-background",
                      visual.darkSurface && "bg-zinc-950",
                    )}
                    title={provider.label}
                  >
                    <Image
                      src={visual.icon}
                      alt=""
                      className="size-4 object-contain"
                    />
                  </span>
                );
              })}
            </span>
          </span>
        }
        action={
          connector?.online && workspaceGroups.length > 0 ? (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus /> Add workspace
            </Button>
          ) : undefined
        }
      />

      <SettingsSection
        title="Agent host"
        description={
          connector
            ? `${connector.name} · ${connector.online ? "Online" : "Offline"}`
            : "Not set up"
        }
      >
        {connectorError ? (
          <SettingsNotice tone="error" className="py-6">
            {connectorError instanceof Error
              ? connectorError.message
              : "Host Connector status could not be loaded."}
          </SettingsNotice>
        ) : connector ? (
          <div className="flex flex-wrap items-center gap-3 px-4 py-4">
            <span
              className={cn(
                "size-2 rounded-full",
                connector.online ? "bg-emerald-500" : "bg-muted-foreground",
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{connector.name}</p>
              <p className="text-xs text-muted-foreground">
                Local agents and SSH ·{" "}
                {connector.version
                  ? `Host Connector ${connector.version}`
                  : "Host Connector"}
              </p>
            </div>
            {!connector.online && !connector.managed && (
              <Button
                variant="outline"
                size="sm"
                disabled={pairingMutation.isPending}
                onClick={() => void createPairing()}
              >
                {pairingMutation.isPending ? (
                  <Loader2 className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <Link2 />
                )}
                Pair again
              </Button>
            )}
            {!connector.managed && (
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={deleteConnectorMutation.isPending}
                onClick={() => {
                  setDetachError("");
                  setPendingDetach({ type: "connector", connector });
                }}
                aria-label="Remove Host Connector"
                title="Remove Host Connector"
              >
                <Trash2 />
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 px-4 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/30">
                <Server className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  OvertChat host
                </span>
                <span className="block text-xs text-muted-foreground">
                  Not installed on this server. Run: overtchat setup
                </span>
              </span>
            </div>
          </div>
        )}
        {connector?.upgrade && (
          <div className="border-t px-4 py-4">
            <p className="text-sm font-medium">
              Host Connector {connector.upgrade.version} is available
            </p>
            <p className="mb-3 mt-1 text-xs text-muted-foreground">
              Run this on the connector host. It updates the binary and restarts
              the service without changing the existing pairing or settings.
            </p>
            <div className="flex items-center gap-2">
              <code
                aria-label="Host Connector upgrade command"
                className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-muted px-3 py-2 text-xs"
              >
                {connector.upgrade.command}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => void copyUpgradeCommand()}
                aria-label="Copy connector upgrade command"
                title="Copy connector upgrade command"
              >
                {upgradeCopied ? <Check /> : <Clipboard />}
              </Button>
            </div>
          </div>
        )}
        {pairing && !connector && (
          <div className="border-t px-4 py-4">
            <div className="mb-2 flex items-center gap-1">
              <p className="text-sm font-medium">Install Host Connector</p>
              <HostConnectorInfo />
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Run this command in a terminal on the computer running OvertChat.
            </p>
            <div className="flex items-center gap-2">
              <code
                aria-label="Host Connector install command"
                className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-muted px-3 py-2 text-xs"
              >
                {pairing.command}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => void copyPairingCommand()}
                aria-label="Copy connector command"
                title="Copy connector command"
              >
                {commandCopied ? <Check /> : <Clipboard />}
              </Button>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
              Waiting for connection…
            </div>
          </div>
        )}
      </SettingsSection>

      {connector && (
        <SettingsSection
          title="Agent workspaces"
          description={
            workspaceGroups.length > 0
              ? `${workspaceGroups.length} workspace${
                  workspaceGroups.length === 1 ? "" : "s"
                } available`
              : undefined
          }
        >
          {listError ? (
            <SettingsNotice tone="error" className="py-6">
              {listError instanceof Error
                ? listError.message
                : "Agents could not be loaded."}
            </SettingsNotice>
          ) : workspaceGroups.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Folder className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                No agent workspaces added
              </p>
              {connector.online && (
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus /> Add workspace
                </Button>
              )}
            </div>
          ) : (
            workspaceGroups.map((group) => (
              <WorkspaceGroupRow
                key={group.key}
                group={group}
                actionId={actionId}
                onTest={(connection) => void testConnection(connection)}
                onRemoveWorkspace={() => {
                  setDetachError("");
                  setPendingDetach({
                    type: "workspace-group",
                    group,
                  });
                }}
              />
            ))
          )}
        </SettingsSection>
      )}

      {connector && (
        <AddAgentWorkspaceDialog
          connector={connector}
          connections={connections}
          open={addOpen}
          onOpenChange={setAddDialogOpen}
        />
      )}

      <AlertDialog.Root
        open={pendingDetach !== null}
        onOpenChange={(next) => {
          if (!next && !detaching) {
            setPendingDetach(null);
            setDetachError("");
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop
            className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)}
          />
          <AlertDialog.Popup
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
              motionClasses.dialog,
            )}
          >
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              {pendingDetach?.type === "workspace-group"
                ? "Remove workspace?"
                : "Remove Host Connector?"}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              {pendingDetach?.type === "connector" ? (
                <>
                  <span className="font-medium text-foreground">
                    {pendingDetach.connector.name}
                  </span>{" "}
                  and every agent that uses it will be removed from OvertChat.
                  Files and native agent sessions remain on their machines.
                </>
              ) : pendingDetach?.type === "workspace-group" ? (
                <>
                  <span className="font-medium text-foreground">
                    {pendingDetach.group.name}
                  </span>{" "}
                  and its agent chats will be removed from OvertChat. Files and
                  native agent sessions remain on the host.
                </>
              ) : null}
            </AlertDialog.Description>
            {detachError && (
              <SettingsNotice tone="error" className="mt-3 text-xs">
                {detachError}
              </SettingsNotice>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={
                  <Button variant="ghost" size="sm" disabled={detaching} />
                }
              >
                Cancel
              </AlertDialog.Close>
              <Button
                variant="destructive"
                size="sm"
                disabled={detaching}
                onClick={() => void confirmDetach()}
              >
                {detaching && (
                  <Loader2 className="animate-spin motion-reduce:animate-none" />
                )}
                Remove
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

function HostConnectorInfo() {
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label="About Host Connector"
            title="About Host Connector"
          />
        }
      >
        <Info />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50"
        >
          <Popover.Popup
            className={cn(
              "w-72 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-3 text-xs leading-5 text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            <Popover.Title className="font-medium text-foreground">
              Host Connector
            </Popover.Title>
            <p className="mt-1 text-muted-foreground">
              Lets OvertChat use agent binaries and SSH hosts available on this
              server. For Docker installs, run it on the Docker host.
            </p>
            <a
              href="https://github.com/yoloyash/overtchat/blob/main/scripts/install-connector.sh"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
            >
              View installer source
              <ExternalLink className="size-3" />
            </a>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function WorkspaceGroupRow({
  group,
  actionId,
  onTest,
  onRemoveWorkspace,
}: {
  group: AgentWorkspaceGroup;
  actionId: string | null;
  onTest: (connection: AgentConnectionListItem) => void;
  onRemoveWorkspace: () => void;
}) {
  const HostIcon = group.host.transport === "local" ? Server : Wifi;
  const hostDetail =
    group.host.transport === "local"
      ? "This server"
      : `ssh ${group.host.sshAlias}`;
  const sessionCount = group.sessions.length;
  const providerSnapshot = useAgentProviderSnapshot(
    agentConnectionTarget(group.targets[0]!.connection),
  );
  const providers = projectAgentWorkspaceProviders(
    group,
    providerSnapshot.data,
  );

  return (
    <div className="px-4 py-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/30">
          <Folder className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{group.name}</span>
            <span className="text-xs text-muted-foreground">
              {providers.length} agent{providers.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={group.path}>
            {group.path}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <HostIcon className="size-3" /> {hostDetail}
            </span>
            <span>
              {sessionCount} session{sessionCount === 1 ? "" : "s"}
            </span>
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove workspace ${group.name}`}
          title="Remove workspace"
          onClick={onRemoveWorkspace}
        >
          <Trash2 />
        </Button>
      </div>

      <div className="mt-4 ml-4 border-l pl-4">
        {providers.map(({ provider: providerId }) => {
          const backing = group.targets.find(
            ({ connection }) => connection.provider === providerId,
          );
          const installation = providerSnapshot.data?.providers.find(
            (entry) =>
              entry.provider === providerId && entry.status === "ready",
          );
          const provider = agentProviderMetadata(providerId);
          const executable =
            installation?.status === "ready"
              ? installation.executable
              : backing?.connection.executable;
          const version =
            installation?.status === "ready"
              ? installation.version
              : backing?.connection.detectedVersion;
          const providerSessionCount = group.sessions.filter(
            (session) => session.provider === providerId,
          ).length;
          return (
            <div
              key={providerId}
              className="flex flex-col gap-2 border-b py-3 first:pt-0 last:border-0 last:pb-0 @xl:flex-row @xl:items-center"
            >
              <TerminalSquare className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="text-sm font-medium">{provider.label}</p>
                  <span className="text-xs text-muted-foreground">
                    {version ?? "Not tested"}
                  </span>
                </div>
                <p className="truncate font-mono text-xs text-muted-foreground" title={executable}>
                  {executable}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {providerSessionCount} session
                {providerSessionCount === 1 ? "" : "s"}
              </span>
              {backing && (
                <div className="flex items-center gap-1 @xl:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={actionId !== null}
                  aria-label={`Test ${provider.label} in ${group.name}`}
                  title="Test agent"
                  onClick={() => onTest(backing.connection)}
                >
                  <RefreshCw
                    className={cn(
                      actionId === backing.connection.id &&
                        "animate-spin motion-reduce:animate-none",
                    )}
                  />
                </Button>
              </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
