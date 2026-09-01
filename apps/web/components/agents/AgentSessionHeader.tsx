"use client";

import { writeText as clipboardWriteText } from "clipboard-polyfill";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import Image from "next/image";
import {
  Coins,
  Copy,
  FileDiff,
  GitBranch,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarToggle } from "@/components/SidebarToggle";
import type {
  AgentProviderId,
  AgentSessionStats,
  AgentWorkspaceGitStatus,
} from "@overtchat/agent-bridge";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import { AGENT_PROVIDER_VISUALS } from "@/lib/agents/providerVisuals";
import { motionClasses } from "@/lib/motion";
import { useAgentWorkspaceGitStatus } from "@/lib/queries/agentWorkspaces";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

export function AgentSessionHeader({
  provider,
  workspaceId,
  workspacePath,
  stats,
  running,
  commandPending,
  readOnly,
  onRename,
  onCompact,
  filesOpen,
  onToggleFiles,
}: {
  provider: AgentProviderId;
  workspaceId: string;
  workspacePath: string;
  stats: AgentSessionStats;
  running: boolean;
  commandPending: boolean;
  readOnly: boolean;
  onRename: () => void;
  onCompact: () => void;
  filesOpen: boolean;
  onToggleFiles: () => void;
}) {
  const providerMetadata = agentProviderMetadata(provider);
  const providerVisual = AGENT_PROVIDER_VISUALS[provider];
  const gitStatus = useAgentWorkspaceGitStatus(workspaceId, {
    active: true,
    running,
  }).data;
  const branch = gitStatus?.branch;

  async function copyWorkspaceValue(value: string, label: string) {
    try {
      await clipboardWriteText(value);
      toast.success({ title: `${label} copied` });
    } catch {
      toast.error({ title: `Could not copy ${label.toLowerCase()}` });
    }
  }

  return (
    <header
      data-testid="agent-session-header"
      className="flex h-12 shrink-0 items-center gap-1 border-b px-3"
    >
      <SidebarToggle />
      <div
        data-testid="agent-provider-identity"
        aria-label={`${providerMetadata.label} agent`}
        title={`${providerMetadata.label} agent`}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium"
      >
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-md border bg-background",
            providerVisual.darkSurface && "bg-zinc-950",
          )}
          aria-hidden="true"
        >
          <Image
            src={providerVisual.icon}
            alt=""
            className="size-4 object-contain"
          />
        </span>
        <span className="hidden sm:inline">{providerMetadata.label}</span>
      </div>
      <span className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
      <span
        data-testid="agent-workspace-path"
        className="hidden max-w-40 truncate px-1 font-mono text-xs text-muted-foreground md:block lg:max-w-64 xl:max-w-96"
        title={workspacePath}
      >
        {workspacePath}
      </span>
      <WorkspaceGitSummary status={gitStatus} />
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={filesOpen ? "Close workspace files" : "Open workspace files"}
          title={filesOpen ? "Close workspace files" : "Open workspace files"}
          aria-pressed={filesOpen}
          onClick={onToggleFiles}
        >
          <PanelRight />
        </Button>
        <SessionStats stats={stats} />
        <Menu.Root>
          <Menu.Trigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Session actions"
                title="Session actions"
              />
            }
          >
            <MoreHorizontal />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={6}>
              <Menu.Popup
                className={cn(
                  "z-50 w-44 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
                  motionClasses.popup,
                )}
              >
                <Menu.Item
                  onClick={() =>
                    void copyWorkspaceValue(workspacePath, "Workspace path")
                  }
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[highlighted]:bg-accent"
                >
                  <Copy className="size-3.5 text-muted-foreground" />
                  Copy workspace path
                </Menu.Item>
                {branch && (
                  <Menu.Item
                    onClick={() =>
                      void copyWorkspaceValue(branch, "Branch name")
                    }
                    className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[highlighted]:bg-accent"
                >
                  <GitBranch className="size-3.5 text-muted-foreground" />
                  Copy branch name
                </Menu.Item>
                )}
                <Menu.Separator className="my-1 h-px bg-border" />
                <Menu.Item
                  disabled={readOnly}
                  onClick={onRename}
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
                >
                  <Pencil className="size-3.5 text-muted-foreground" />
                  Rename session
                </Menu.Item>
                <Menu.Item
                  disabled={readOnly || running || commandPending}
                  onClick={onCompact}
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
                >
                  <Sparkles className="size-3.5 text-muted-foreground" />
                  Compact context
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </header>
  );
}

function WorkspaceGitSummary({
  status,
}: {
  status: AgentWorkspaceGitStatus | undefined;
}) {
  if (!status?.isGit) return null;
  const branch = status.branch ?? "Detached HEAD";
  const tracking = [
    status.ahead ? `${status.ahead} ahead` : null,
    status.behind ? `${status.behind} behind` : null,
  ].filter(Boolean);
  const title = [
    branch,
    ...tracking,
    status.dirty
      ? `${status.changedFiles} changed ${status.changedFiles === 1 ? "file" : "files"}`
      : "Clean working tree",
  ].join(" · ");

  return (
    <div
      data-testid="agent-workspace-git-status"
      title={title}
      className="hidden min-w-0 items-center gap-2 px-1 text-[11px] text-muted-foreground lg:flex"
    >
      <span className="flex min-w-0 items-center gap-1">
        <GitBranch className="size-3.5 shrink-0" />
        <span className="max-w-28 truncate">{branch}</span>
      </span>
      {status.dirty && (
        <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
          <FileDiff className="size-3.5" />
          <span>
            {status.changedFiles}{" "}
            {status.changedFiles === 1 ? "file" : "files"}
          </span>
          {status.lineStatsComplete && (
            <>
              <span className="text-emerald-700 dark:text-emerald-300">
                +{status.additions}
              </span>
              <span className="text-red-700 dark:text-red-300">
                -{status.deletions}
              </span>
            </>
          )}
        </span>
      )}
    </div>
  );
}

function SessionStats({ stats }: { stats: AgentSessionStats }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Session usage"
            title="Session usage"
          />
        }
      >
        <Coins />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6}>
          <Popover.Popup
            className={cn(
              "z-50 w-64 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            <Popover.Title className="font-medium">Session usage</Popover.Title>
            <div className="mt-3 space-y-2">
              <StatsRow label="Input" value={formatInteger(stats.tokens.input)} />
              <StatsRow label="Output" value={formatInteger(stats.tokens.output)} />
              <StatsRow
                label="Cache read"
                value={formatInteger(stats.tokens.cacheRead)}
              />
              <StatsRow label="Total" value={formatInteger(stats.tokens.total)} />
              <StatsRow label="Estimated cost" value={formatCost(stats.cost)} />
              <StatsRow
                label="Tool calls"
                value={formatInteger(stats.toolCalls)}
              />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function StatsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatCost(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
}
