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
  agentSetupAgentsForWorkspace,
  agentSetupForWorkspace,
  agentSetupHosts,
  agentSetupWorkspaces,
  type AgentSetup,
  type AgentSetupAgent,
} from "@/lib/agents/setups";
import { useAgentProviderSnapshot } from "@/lib/queries/agentConnections";
import { AgentProviderLogo } from "./AgentSessionStatus";

/** A borderless pill, so the pickers read as settings rather than form fields. */
const PILL =
  "min-w-0 shrink gap-1 border-0 px-2 py-0 text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground data-[size=sm]:rounded-full dark:bg-transparent dark:hover:bg-muted/50 [&>svg]:size-3.5 [&>svg]:text-muted-foreground/60";

const POPUP = "w-auto max-w-[min(28rem,calc(100vw-2rem))]";

/**
 * Switches a new session to another machine, a folder on it, then any agent
 * the machine has. The machine is only offered when there is more than one.
 * Every list is ordered by last use.
 */
export function AgentSetupPicker({
  setups: allSetups,
  workspaceId,
  provider,
  lockedProvider = null,
  fork = null,
  focusWorkspace = false,
}: {
  setups: AgentSetup[];
  workspaceId: string;
  provider: AgentProviderId;
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
  // A locked agent needs no detection: it only moves between its own folders.
  const snapshot = useAgentProviderSnapshot(
    lockedProvider ? null : (current?.target ?? null),
  ).data;
  if (!current) return null;
  const hosts = agentSetupHosts(setups);
  const workspaces = agentSetupWorkspaces(setups, current.hostKey);
  const agents = agentSetupAgentsForWorkspace(
    setups,
    current.hostKey,
    current.workspacePath,
    snapshot,
  );
  // The marks the connection settings use: this server, or a machine over SSH.
  const HostIcon = current.transport === "ssh" ? Wifi : Server;

  function open(agent: Pick<AgentSetupAgent, "workspaceId" | "provider"> | undefined) {
    if (
      !agent ||
      (agent.workspaceId === workspaceId && agent.provider === provider)
    ) {
      return;
    }
    void navigate({
      to: "/agents/new",
      search: {
        workspaceId: agent.workspaceId,
        provider: agent.provider,
        fork: fork ?? undefined,
      },
      replace: true,
    });
  }

  return (
    <>
      {hosts.length > 1 && (
        <Select
          value={current.hostKey}
          // A machine opens with the folder and agent last used on it.
          onValueChange={(hostKey) =>
            open(hostKey ? agentSetupWorkspaces(setups, hostKey)[0] : undefined)
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
              <SelectItem key={host.hostKey} value={host.hostKey}>
                {host.hostLabel}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select
        value={current.workspacePath}
        // The agent stays if the machine has it; otherwise the folder's last-used agent.
        onValueChange={(path) =>
          open(
            path
              ? agentSetupForWorkspace(
                  setups,
                  current.hostKey,
                  path,
                  provider,
                  snapshot,
                )
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
          value={provider}
          onValueChange={(id) => open(agents.find((agent) => agent.provider === id))}
        >
          <SelectTrigger size="sm" aria-label="Agent" title="Agent" className={PILL}>
            <SelectValue className="min-w-0 gap-1.5">
              {() => (
                <>
                  <AgentProviderLogo provider={provider} className="opacity-100" />
                  <span className="truncate">
                    {agentProviderMetadata(provider).label}
                  </span>
                </>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false} className={POPUP}>
            {agents.map((agent) => (
              <SelectItem
                key={agent.provider}
                value={agent.provider}
                disabled={!agent.detected}
              >
                <AgentProviderLogo provider={agent.provider} className="opacity-100" />
                <span className="truncate">
                  {agentProviderMetadata(agent.provider).label}
                </span>
                {!agent.detected && (
                  <span className="truncate text-muted-foreground">Not detected</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </>
  );
}
