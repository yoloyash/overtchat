"use client";

import { writeText as clipboardWriteText } from "clipboard-polyfill";
import { Menu } from "@base-ui/react/menu";
import Image from "next/image";
import {
  ChartNoAxesColumnIncreasing,
  Copy,
  FileDiff,
  Gauge,
  GitBranch,
  MoreHorizontal,
  PanelRight,
  Pencil,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarToggle } from "@/components/SidebarToggle";
import type {
  AgentProviderId,
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
  running,
  commandPending,
  readOnly,
  onRename,
  onCompact,
  onShowSessionUsage,
  accountUsageAvailable,
  accountUsagePending,
  onShowAccountUsage,
  restartPending,
  onRestart,
  filesOpen,
  onToggleFiles,
}: {
  provider: AgentProviderId;
  workspaceId: string;
  workspacePath: string;
  running: boolean;
  commandPending: boolean;
  readOnly: boolean;
  onRename: () => void;
  onCompact: () => void;
  onShowSessionUsage: () => void;
  accountUsageAvailable: boolean;
  accountUsagePending: boolean;
  onShowAccountUsage: () => void;
  restartPending: boolean;
  onRestart: () => void;
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
        {accountUsageAvailable && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Account usage"
            title="Account usage"
            disabled={accountUsagePending}
            onClick={onShowAccountUsage}
          >
            <Gauge
              className={
                accountUsagePending ? motionClasses.spinner : undefined
              }
            />
          </Button>
        )}
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
                  onClick={onShowSessionUsage}
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[highlighted]:bg-accent"
                >
                  <ChartNoAxesColumnIncreasing className="size-3.5 text-muted-foreground" />
                  Session usage
                </Menu.Item>
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
                <Menu.Separator className="my-1 h-px bg-border" />
                <Menu.Item
                  disabled={commandPending || restartPending}
                  onClick={onRestart}
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-destructive outline-none motion-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-destructive/10"
                >
                  <RefreshCw className="size-3.5" />
                  Restart {providerMetadata.label}…
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
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
