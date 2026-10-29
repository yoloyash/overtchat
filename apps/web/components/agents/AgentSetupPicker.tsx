"use client";

import { useNavigate } from "@tanstack/react-router";
import { Folder, Server, Wifi } from "lucide-react";
import { agentProviderMetadata, type AgentProviderId } from "@overtchat/agent-bridge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  agentSetupForWorkspace,
  agentSetupHosts,
  agentSetupWorkspaces,
  agentSetupsForWorkspace,
  type AgentSetup,
} from "@/lib/agents/setups";
import { AgentProviderLogo } from "./AgentSessionStatus";

/** A borderless pill, so the pickers read as settings rather than form fields. */
const PILL =
  "min-w-0 shrink gap-1 border-0 px-2 py-0 text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground data-[size=sm]:rounded-full dark:bg-transparent dark:hover:bg-muted/50 [&>svg]:size-3.5 [&>svg]:text-muted-foreground/60";

const POPUP = "w-auto max-w-[min(28rem,calc(100vw-2rem))]";

/**
 * Switches a new session to another machine, a folder on it, then an agent
 * that has that folder. The machine is only offered when there is more than
 * one. Every list is ordered by last use.
 */
export function AgentSetupPicker({
  setups: allSetups,
  workspaceId,
  lockedProvider = null,
  fork = null,
  focusWorkspace = false,
}: {
  setups: AgentSetup[];
  workspaceId: string;
  /** Keep this agent and offer only its machines and folders. */
  lockedProvider?: AgentProviderId | null;
  /** The forked conversation to carry along when the setup changes. */
  fork?: string | null;
  /** Land on the folder pill, for moving a fork elsewhere. */
  focusWorkspace?: boolean;
}) {
  const navigate = useNavigate();
  const setups = lockedProvider
    ? allSetups.filter((setup) => setup.provider === lockedProvider)
    : allSetups;
  const current = setups.find((setup) => setup.workspaceId === workspaceId);
  if (!current) return null;
  const hosts = agentSetupHosts(setups);
  const workspaces = agentSetupWorkspaces(setups, current.hostId);
  const agents = agentSetupsForWorkspace(
    setups,
    current.hostId,
    current.workspacePath,
  );
  // The marks the connection settings use: this server, or a machine over SSH.
  const HostIcon = current.transport === "ssh" ? Wifi : Server;

  function open(setup: AgentSetup | undefined) {
    if (!setup || setup.workspaceId === workspaceId) return;
    void navigate({
      to: "/agents/new",
      search: {
        workspaceId: setup.workspaceId,
        provider: setup.provider,
        fork: fork ?? undefined,
      },
      replace: true,
    });
  }

  return (
    <>
      {hosts.length > 1 && (
        <Select
          value={current.hostId}
          // A machine opens with the folder and agent last used on it.
          onValueChange={(hostId) =>
            open(hostId ? agentSetupWorkspaces(setups, hostId)[0] : undefined)
          }
        >
          <SelectTrigger size="sm" aria-label="Machine" title="Machine" className={PILL}>
            <SelectValue className="min-w-0 gap-1.5">
              {() => (
                <>
                  <HostIcon aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="truncate">{current.hostLabel}</span>
                </>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false} className={POPUP}>
            {hosts.map((host) => (
              <SelectItem key={host.hostId} value={host.hostId}>
                {host.hostLabel}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select
        value={current.workspacePath}
        // The agent stays if the folder has it; otherwise its last-used agent.
        onValueChange={(path) =>
          open(
            path
              ? agentSetupForWorkspace(setups, current.hostId, path, current.provider)
              : undefined,
          )
        }
      >
        <SelectTrigger
          size="sm"
          aria-label="Workspace"
          title="Workspace"
          className={PILL}
          autoFocus={focusWorkspace}
        >
          <SelectValue className="min-w-0 gap-1.5">
            {() => (
              <>
                <Folder aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{current.workspaceName}</span>
              </>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false} className={POPUP}>
          {workspaces.map((workspace) => (
            <SelectItem key={workspace.workspacePath} value={workspace.workspacePath}>
              <span className="truncate">{workspace.workspaceName}</span>
              {/* Two folders with one name tell apart by path. */}
              {workspaces.some(
                (other) =>
                  other !== workspace && other.workspaceName === workspace.workspaceName,
              ) && (
                <span className="truncate text-muted-foreground">
                  {workspace.workspacePath}
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!lockedProvider && (
        <Select
          value={workspaceId}
          onValueChange={(id) => open(setups.find((setup) => setup.workspaceId === id))}
        >
          <SelectTrigger size="sm" aria-label="Agent" title="Agent" className={PILL}>
            <SelectValue className="min-w-0 gap-1.5">
              {() => (
                <>
                  <AgentProviderLogo provider={current.provider} className="opacity-100" />
                  <span className="truncate">
                    {agentProviderMetadata(current.provider).label}
                  </span>
                </>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false} className={POPUP}>
            {agents.map((setup) => (
              <SelectItem key={setup.workspaceId} value={setup.workspaceId}>
                <AgentProviderLogo provider={setup.provider} className="opacity-100" />
                <span className="truncate">
                  {agentProviderMetadata(setup.provider).label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </>
  );
}
