"use client";

import Image from "next/image";
import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Popover } from "@base-ui/react/popover";
import {
  Check,
  Clipboard,
  ExternalLink,
  Folder,
  FolderPlus,
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
import claudeCodeIcon from "@/assets/agent-providers/claude-code.png";
import codexIcon from "@/assets/agent-providers/codex.png";
import ompIcon from "@/assets/agent-providers/omp.svg";
import piIcon from "@/assets/agent-providers/pi.svg";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type {
  AgentConnectionListItem,
  AgentWorkspaceListItem,
  HostConnectorListItem,
  HostConnectorPairing,
} from "@/lib/agents/types";
import { agentProviderMetadata } from "@/lib/agents/catalog";
import {
  useAgentConnections,
  useDeleteAgentConnection,
  useDeleteHostConnector,
  useDeleteAgentWorkspace,
  useCreateHostConnectorPairing,
  useHostConnectors,
  useRefreshAgentWorkspace,
  useTestAgentConnection,
} from "@/lib/queries/agentConnections";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  SettingsNotice,
  SettingsPageHeader,
  SettingsSection,
} from "../_components/SettingsRows";
import { AddConnectionDialog } from "./AddConnectionDialog";
import { AddWorkspaceDialog } from "./AddWorkspaceDialog";

type PendingDetach =
  | { type: "connection"; connection: AgentConnectionListItem }
  | { type: "connector"; connector: HostConnectorListItem }
  | {
      type: "workspace";
      connection: AgentConnectionListItem;
      workspace: AgentWorkspaceListItem;
    };

export function ConnectionsPanel() {
  const { data: connections = [], error: listError } = useAgentConnections();
  const { data: connectors = [], error: connectorError } = useHostConnectors();
  const connector = connectors[0];
  const testMutation = useTestAgentConnection();
  const refreshMutation = useRefreshAgentWorkspace();
  const deleteConnectionMutation = useDeleteAgentConnection();
  const deleteWorkspaceMutation = useDeleteAgentWorkspace();
  const pairingMutation = useCreateHostConnectorPairing();
  const deleteConnectorMutation = useDeleteHostConnector();
  const [addOpen, setAddOpen] = useState(false);
  const [pairing, setPairing] = useState<HostConnectorPairing | null>(null);
  const [commandCopied, setCommandCopied] = useState(false);
  const [workspaceConnection, setWorkspaceConnection] =
    useState<AgentConnectionListItem | null>(null);
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

  async function refreshWorkspace(workspace: AgentWorkspaceListItem) {
    setActionId(workspace.id);
    try {
      await refreshMutation.mutateAsync(workspace.id);
      toast.success({
        title: "Sessions refreshed",
        description: workspace.name,
      });
    } catch (cause) {
      toast.error({
        title: "Refresh failed",
        description:
          cause instanceof Error ? cause.message : "The workspace could not be refreshed.",
      });
    } finally {
      setActionId(null);
    }
  }

  async function confirmDetach() {
    if (!pendingDetach) return;
    setDetachError("");
    try {
      if (pendingDetach.type === "connection") {
        await deleteConnectionMutation.mutateAsync(
          pendingDetach.connection.id,
        );
        toast.success({
          title: "Agent removed",
          description: pendingDetach.connection.host.name,
        });
      } else if (pendingDetach.type === "connector") {
        await deleteConnectorMutation.mutateAsync(
          pendingDetach.connector.id,
        );
        setPairing(null);
        toast.success({ title: "Host Connector removed" });
      } else {
        await deleteWorkspaceMutation.mutateAsync(
          pendingDetach.workspace.id,
        );
        toast.success({
          title: "Workspace detached",
          description: pendingDetach.workspace.name,
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

  return (
    <div className="max-w-4xl space-y-6">
      <SettingsPageHeader
        title="Connections"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>Use OvertChat as a web interface for coding agents.</span>
            <span
              className="inline-flex items-center gap-1"
              aria-label="Supported agents: Pi and Oh My Pi. Claude Code and Codex coming soon."
            >
              <span
                className="flex size-6 items-center justify-center rounded-md border bg-background"
                title="Pi"
              >
                <Image src={piIcon} alt="" className="size-4 object-contain" />
              </span>
              <span
                className="flex size-6 items-center justify-center rounded-md border bg-zinc-950"
                title="Oh My Pi"
              >
                <Image src={ompIcon} alt="" className="size-4 object-contain" />
              </span>
              <span
                className="flex size-6 items-center justify-center rounded-md border bg-background opacity-40 grayscale"
                title="Claude Code · Coming soon"
              >
                <Image
                  src={claudeCodeIcon}
                  alt=""
                  className="size-4 object-contain"
                />
              </span>
              <span
                className="flex size-6 items-center justify-center rounded-md border bg-background opacity-40 grayscale"
                title="Codex · Coming soon"
              >
                <Image
                  src={codexIcon}
                  alt=""
                  className="size-4 object-contain"
                />
              </span>
            </span>
          </span>
        }
        action={
          connector?.online && connections.length > 0 ? (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus /> Add agent
            </Button>
          ) : undefined
        }
      />

      <SettingsSection
        title="Agent access"
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
            {!connector.online && (
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
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 px-4 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/30">
                <Server className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  OvertChat host
                </span>
                <span className="block text-xs text-muted-foreground">
                  Local agents and SSH
                </span>
              </span>
            </div>
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
              Set up
            </Button>
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
          title="Agents"
          description={
            connections.length > 0
              ? `${connections.length} agent${
                  connections.length === 1 ? "" : "s"
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
          ) : connections.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <TerminalSquare className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                No agents added
              </p>
              {connector.online && (
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus /> Add agent
                </Button>
              )}
            </div>
          ) : (
            connections.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                actionId={actionId}
                onTest={() => void testConnection(connection)}
                onAddWorkspace={() => setWorkspaceConnection(connection)}
                onRefreshWorkspace={(workspace) =>
                  void refreshWorkspace(workspace)
                }
                onDetachWorkspace={(workspace) => {
                  setDetachError("");
                  setPendingDetach({
                    type: "workspace",
                    connection,
                    workspace,
                  });
                }}
                onDetach={() => {
                  setDetachError("");
                  setPendingDetach({ type: "connection", connection });
                }}
              />
            ))
          )}
        </SettingsSection>
      )}

      {connector && (
        <AddConnectionDialog
          connector={connector}
          connections={connections}
          open={addOpen}
          onOpenChange={setAddOpen}
        />
      )}
      <AddWorkspaceDialog
        connection={workspaceConnection}
        onClose={() => setWorkspaceConnection(null)}
      />

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
              {pendingDetach?.type === "workspace"
                ? "Detach workspace?"
                : pendingDetach?.type === "connector"
                  ? "Remove Host Connector?"
                  : "Remove agent?"}
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
              ) : (
                <>
                  <span className="font-medium text-foreground">
                    {pendingDetach?.type === "workspace"
                      ? pendingDetach.workspace.name
                      : pendingDetach?.connection.host.name}
                  </span>{" "}
                  will be removed from OvertChat. Files and native{" "}
                  {pendingDetach
                    ? agentProviderMetadata(
                        pendingDetach.connection.provider,
                      ).label
                    : "agent"}{" "}
                  sessions remain on the host.
                </>
              )}
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
                {pendingDetach?.type === "workspace" ? "Detach" : "Remove"}
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

function ConnectionRow({
  connection,
  actionId,
  onTest,
  onAddWorkspace,
  onRefreshWorkspace,
  onDetachWorkspace,
  onDetach,
}: {
  connection: AgentConnectionListItem;
  actionId: string | null;
  onTest: () => void;
  onAddWorkspace: () => void;
  onRefreshWorkspace: (workspace: AgentWorkspaceListItem) => void;
  onDetachWorkspace: (workspace: AgentWorkspaceListItem) => void;
  onDetach: () => void;
}) {
  const HostIcon = connection.host.transport === "local" ? Server : Wifi;
  const provider = agentProviderMetadata(connection.provider);
  const hostDetail =
    connection.host.transport === "local"
      ? "This server"
      : `ssh ${connection.host.sshAlias}`;

  return (
    <div className="py-4">
      <div className="flex flex-col gap-3 @xl:flex-row @xl:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/30">
            <HostIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium">{connection.host.name}</span>
              <span className="text-xs text-muted-foreground">
                {provider.label}
              </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              {hostDetail}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {connection.detectedVersion
                ? `${provider.label} ${connection.detectedVersion}`
                : "Not tested"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 @xl:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={actionId !== null}
            onClick={onTest}
          >
            <RefreshCw
              className={cn(
                actionId === connection.id &&
                  "animate-spin motion-reduce:animate-none",
              )}
            />
            Test
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddWorkspace}
          >
            <FolderPlus /> Add workspace
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${provider.label} from ${connection.host.name}`}
            title={`Remove ${provider.label}`}
            onClick={onDetach}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {connection.workspaces.length > 0 && (
        <div className="mt-4 ml-4 border-l pl-4">
          {connection.workspaces.map((workspace) => (
            <div
              key={workspace.id}
              className="flex flex-col gap-2 border-b py-3 first:pt-0 last:border-0 last:pb-0 sm:flex-row sm:items-center"
            >
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{workspace.name}</p>
                <p
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={workspace.path}
                >
                  {workspace.path}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {workspace.sessions.length} session
                {workspace.sessions.length === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={actionId !== null}
                  aria-label={`Refresh ${workspace.name}`}
                  title={`Refresh ${workspace.name}`}
                  onClick={() => onRefreshWorkspace(workspace)}
                >
                  <RefreshCw
                    className={cn(
                      actionId === workspace.id &&
                        "animate-spin motion-reduce:animate-none",
                    )}
                  />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Detach ${workspace.name}`}
                  title={`Detach ${workspace.name}`}
                  onClick={() => onDetachWorkspace(workspace)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
