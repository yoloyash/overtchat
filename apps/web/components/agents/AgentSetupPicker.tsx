"use client";

import { useNavigate } from "@tanstack/react-router";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentSetup } from "@/lib/agents/setups";
import { cn } from "@/lib/utils";
import { AgentProviderLogo } from "./AgentSessionStatus";

function SetupLabel({
  setup,
  detailClassName,
}: {
  setup: AgentSetup;
  detailClassName?: string;
}) {
  return (
    <>
      <AgentProviderLogo provider={setup.provider} className="opacity-100" />
      <span className="truncate">{setup.workspaceName}</span>
      <span className={cn("truncate text-muted-foreground", detailClassName)}>
        {agentProviderMetadata(setup.provider).label} · {setup.hostLabel}
      </span>
    </>
  );
}

/**
 * Switches a new session to any workspace and agent, most recently used first.
 * The trigger is a borderless pill, so it reads as a setting above the
 * composer rather than a form field.
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
  return (
    <Select
      value={workspaceId}
      onValueChange={(value) => {
        const setup = setups.find((item) => item.workspaceId === value);
        if (!setup || setup.workspaceId === workspaceId) return;
        void navigate({
          to: "/agents/new",
          search: { workspaceId: setup.workspaceId, provider: setup.provider },
          replace: true,
        });
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="Workspace and agent"
        title="Workspace and agent"
        className="max-w-full gap-1 border-0 px-2 py-0 text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground data-[size=sm]:rounded-full dark:bg-transparent dark:hover:bg-muted/50 [&>svg]:size-3.5 [&>svg]:text-muted-foreground/60"
      >
        <SelectValue className="min-w-0 gap-1.5">
          {() => (
            <SetupLabel setup={current} detailClassName="text-muted-foreground/60" />
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        className="w-auto max-w-[min(28rem,calc(100vw-2rem))]"
      >
        {setups.map((setup) => (
          <SelectItem key={setup.workspaceId} value={setup.workspaceId}>
            <SetupLabel setup={setup} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
