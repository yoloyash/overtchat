"use client";

import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  Folder,
  FolderPlus,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  TerminalSquare,
  Trash2,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type {
  AgentConnectionListItem,
  AgentWorkspaceListItem,
} from "@/lib/agents/types";
import { agentProviderMetadata } from "@/lib/agents/catalog";
import {
  useAgentConnections,
  useDeleteAgentConnection,
  useDeleteAgentWorkspace,
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
  | {
      type: "workspace";
      connection: AgentConnectionListItem;
      workspace: AgentWorkspaceListItem;
    };

export function ConnectionsPanel() {
  const { data: connections = [], error: listError } = useAgentConnections();
  const testMutation = useTestAgentConnection();
  const refreshMutation = useRefreshAgentWorkspace();
  const deleteConnectionMutation = useDeleteAgentConnection();
  const deleteWorkspaceMutation = useDeleteAgentWorkspace();
  const [addOpen, setAddOpen] = useState(false);
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
          title: "Connection detached",
          description: pendingDetach.connection.host.name,
        });
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
    deleteConnectionMutation.isPending || deleteWorkspaceMutation.isPending;

  return (
    <div className="max-w-4xl space-y-6">
      <SettingsPageHeader
        title="Connections"
        description="Coding agents available to your account."
        action={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus /> Add connection
          </Button>
        }
      />

      <SettingsSection
        title="Coding agents"
        description={`${connections.length} connection${
          connections.length === 1 ? "" : "s"
        } configured.`}
      >
        {listError ? (
          <SettingsNotice tone="error" className="py-6">
            {listError instanceof Error
              ? listError.message
              : "Connections could not be loaded."}
          </SettingsNotice>
        ) : connections.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <TerminalSquare className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No coding agents connected.
            </p>
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

      <AddConnectionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
      />
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
              Detach{" "}
              {pendingDetach?.type === "workspace"
                ? "workspace"
                : "connection"}
              ?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
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
                Detach
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
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
      : `${connection.host.username}@${connection.host.hostname}:${
          connection.host.port ?? 22
        }`;

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
            aria-label={`Detach ${connection.host.name}`}
            title={`Detach ${connection.host.name}`}
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
