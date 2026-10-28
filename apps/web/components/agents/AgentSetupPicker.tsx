"use client";

import { useNavigate } from "@tanstack/react-router";
import { Folder } from "lucide-react";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  agentSetupWorkspaceNames,
  agentSetupsByHost,
  type AgentSetup,
} from "@/lib/agents/setups";
import { AgentProviderLogo } from "./AgentSessionStatus";

/** A borderless pill, so the pickers read as settings rather than form fields. */
const PILL =
  "min-w-0 shrink gap-1 border-0 px-2 py-0 text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground data-[size=sm]:rounded-full dark:bg-transparent dark:hover:bg-muted/50 [&>svg]:size-3.5 [&>svg]:text-muted-foreground/60";

const POPUP = "w-auto max-w-[min(28rem,calc(100vw-2rem))]";

/**
 * Switches a new session to any workspace, then to any agent and host that
 * have it. Both lists are ordered by last use.
 */
export function AgentSetupPicker({
  setups,
  workspaceId,
}: {
  setups: AgentSetup[];
  workspaceId: string;
}) {
  const navigate = useNavigate();
  const current = setups.find((setup) => setup.workspaceId === workspaceId);
  if (!current) return null;
  const hosts = agentSetupsByHost(setups, current.workspaceName);

  function open(setup: AgentSetup | undefined) {
    if (!setup || setup.workspaceId === workspaceId) return;
    void navigate({
      to: "/agents/new",
      search: { workspaceId: setup.workspaceId, provider: setup.provider },
      replace: true,
    });
  }

  return (
    <>
      <Select
        value={current.workspaceName}
        // The workspace's most recently used agent and host come with it.
        onValueChange={(name) =>
          open(setups.find((setup) => setup.workspaceName === name))
        }
      >
        <SelectTrigger
          size="sm"
          aria-label="Workspace"
          title="Workspace"
          className={PILL}
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
          {agentSetupWorkspaceNames(setups).map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={workspaceId}
        onValueChange={(id) =>
          open(setups.find((setup) => setup.workspaceId === id))
        }
      >
        <SelectTrigger
          size="sm"
          aria-label="Agent"
          title="Agent and host"
          className={PILL}
        >
          <SelectValue className="min-w-0 gap-1.5">
            {() => (
              <>
                <AgentProviderLogo provider={current.provider} className="opacity-100" />
                <span className="truncate">
                  {agentProviderMetadata(current.provider).label}
                  <span className="text-muted-foreground/60"> · {current.hostLabel}</span>
                </span>
              </>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false} className={POPUP}>
          {hosts.map((host) => (
            <SelectGroup key={host.hostLabel}>
              <SelectLabel>{host.hostLabel}</SelectLabel>
              {host.setups.map((setup) => (
                <SelectItem key={setup.workspaceId} value={setup.workspaceId}>
                  <AgentProviderLogo provider={setup.provider} className="opacity-100" />
                  <span className="truncate">
                    {agentProviderMetadata(setup.provider).label}
                  </span>
                  {/* Two folders with one name on the same host tell apart by path. */}
                  {host.setups.some(
                    (other) =>
                      other !== setup && other.provider === setup.provider,
                  ) && (
                    <span className="truncate text-muted-foreground">
                      {setup.workspacePath}
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
