"use client";

import { writeText as clipboardWriteText } from "clipboard-polyfill";
import { Menu } from "@base-ui/react/menu";
import {
  ChartNoAxesColumnIncreasing,
  Copy,
  FileDiff,
  Gauge,
  GitBranch,
  Hash,
  MoreHorizontal,
  PanelBottom,
  PanelRight,
  Pencil,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AgentBranchPicker } from "@/components/agents/AgentBranchPicker";
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

const PANE_TOGGLE_CLASS =
  "aria-pressed:bg-accent aria-pressed:text-foreground aria-pressed:hover:bg-accent";

export function AgentSessionHeader({
  provider,
  workspaceId,
  workspacePath,
  providerSessionId,
  running,
  commandPending,
  readOnly,
  onRename,
  onCompact,
  onShowSessionUsage,
  accountUsageAvailable,
  accountUsagePending,
  onShowAccountUsage,
  onShowWorkspaceChanges,
  filesOpen,
  onToggleFiles,
  terminalOpen,
  onToggleTerminal,
}: {
  provider: AgentProviderId;
  workspaceId: string;
  workspacePath: string;
  providerSessionId: string | null;
  running: boolean;
  commandPending: boolean;
  readOnly: boolean;
  onRename: () => void;
  onCompact: () => void;
  onShowSessionUsage: () => void;
  accountUsageAvailable: boolean;
  accountUsagePending: boolean;
  onShowAccountUsage: () => void;
  onShowWorkspaceChanges: () => void;
  filesOpen: boolean;
  onToggleFiles: () => void;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
}) {
  const { t } = useTranslation();
  const providerMetadata = agentProviderMetadata(provider);
  const providerVisual = AGENT_PROVIDER_VISUALS[provider];
  const gitStatus = useAgentWorkspaceGitStatus(workspaceId, {
    active: true,
    running,
  }).data;
  const branch = gitStatus?.branch;

  async function copyWorkspaceValue(
    value: string,
    successTitle: string,
    errorTitle: string,
  ) {
    try {
      await clipboardWriteText(value);
      toast.success({ title: successTitle });
    } catch {
      toast.error({ title: errorTitle });
    }
  }

  return (
    <header
      data-testid="agent-session-header"
      data-titlebar
      className="flex h-12 shrink-0 items-center gap-1 border-b px-3"
    >
      <SidebarToggle />
      <div
        data-testid="agent-provider-identity"
        aria-label={t("agents.session.providerAgent", {
          provider: providerMetadata.label,
        })}
        title={t("agents.session.providerAgent", {
          provider: providerMetadata.label,
        })}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium"
      >
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-md border bg-background",
            providerVisual.darkSurface && "bg-zinc-950",
          )}
          aria-hidden="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
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
      <WorkspaceGitSummary
        provider={provider}
        workspaceId={workspaceId}
        workspacePath={workspacePath}
        status={gitStatus}
        running={running}
        onShowChanges={onShowWorkspaceChanges}
      />
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {accountUsageAvailable && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("agents.session.accountUsage")}
            title={t("agents.session.accountUsage")}
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
                aria-label={t("agents.session.actions")}
                title={t("agents.session.actions")}
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
                    void copyWorkspaceValue(
                      workspacePath,
                      t("agents.session.workspacePathCopied"),
                      t("agents.session.workspacePathCopyFailed"),
                    )
                  }
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[highlighted]:bg-accent"
                >
                  <Copy className="size-3.5 text-muted-foreground" />
                  {t("agents.session.copyWorkspacePath")}
                </Menu.Item>
                {branch && (
                  <Menu.Item
                    onClick={() =>
                      void copyWorkspaceValue(
                        branch,
                        t("agents.session.branchNameCopied"),
                        t("agents.session.branchNameCopyFailed"),
                      )
                    }
                    className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[highlighted]:bg-accent"
                >
                  <GitBranch className="size-3.5 text-muted-foreground" />
                  {t("agents.session.copyBranchName")}
                </Menu.Item>
                )}
                {providerSessionId && (
                  <Menu.Item
                    onClick={() =>
                      void copyWorkspaceValue(
                        providerSessionId,
                        t("agents.session.sessionIdCopied"),
                        t("agents.session.sessionIdCopyFailed"),
                      )
                    }
                    className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[highlighted]:bg-accent"
                  >
                    <Hash className="size-3.5 text-muted-foreground" />
                    {t("agents.session.copySessionId")}
                  </Menu.Item>
                )}
                <Menu.Separator className="my-1 h-px bg-border" />
                <Menu.Item
                  onClick={onShowSessionUsage}
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[highlighted]:bg-accent"
                >
                  <ChartNoAxesColumnIncreasing className="size-3.5 text-muted-foreground" />
                  {t("agents.session.sessionUsage")}
                </Menu.Item>
                {providerMetadata.capabilities.renameSession !== false && (
                  <Menu.Item
                    disabled={readOnly}
                    onClick={onRename}
                    className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
                  >
                    <Pencil className="size-3.5 text-muted-foreground" />
                    {t("agents.session.rename")}
                  </Menu.Item>
                )}
                <Menu.Item
                  disabled={readOnly || running || commandPending}
                  onClick={onCompact}
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
                >
                  <Sparkles className="size-3.5 text-muted-foreground" />
                  {t("agents.session.compactContext")}
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        {/* The two pane toggles stay last, in a fixed order, and each icon shows
            where its pane opens. */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={
            terminalOpen
              ? t("agents.session.closeTerminal")
              : t("agents.session.openTerminal")
          }
          title={
            terminalOpen
              ? t("agents.session.closeTerminal")
              : t("agents.session.openTerminal")
          }
          aria-pressed={terminalOpen}
          className={PANE_TOGGLE_CLASS}
          onClick={onToggleTerminal}
        >
          <PanelBottom />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={
            filesOpen
              ? t("agents.session.closeFiles")
              : t("agents.session.openFiles")
          }
          title={
            filesOpen
              ? t("agents.session.closeFiles")
              : t("agents.session.openFiles")
          }
          aria-pressed={filesOpen}
          className={PANE_TOGGLE_CLASS}
          onClick={onToggleFiles}
        >
          <PanelRight />
        </Button>
      </div>
    </header>
  );
}

function WorkspaceGitSummary({
  provider,
  workspaceId,
  workspacePath,
  status,
  running,
  onShowChanges,
}: {
  provider: AgentProviderId;
  workspaceId: string;
  workspacePath: string;
  status: AgentWorkspaceGitStatus | undefined;
  running: boolean;
  onShowChanges: () => void;
}) {
  const { t } = useTranslation();
  if (!status?.isGit) return null;
  const branch = status.branch ?? t("agents.branch.detachedHead");
  const tracking = [
    status.ahead ? t("agents.branch.ahead", { count: status.ahead }) : null,
    status.behind ? t("agents.branch.behind", { count: status.behind }) : null,
  ].filter(Boolean);
  const title = [
    branch,
    ...tracking,
    status.dirty
      ? t("agents.branch.changedFiles", { count: status.changedFiles })
      : t("agents.branch.cleanWorkingTree"),
  ].join(" · ");

  return (
    <div
      data-testid="agent-workspace-git-status"
      title={title}
      className="hidden min-w-0 items-center gap-2 px-1 text-[11px] text-muted-foreground lg:flex"
    >
      <AgentBranchPicker
        provider={provider}
        workspaceId={workspaceId}
        workspaceName={workspacePath.split(/[\\/]/).filter(Boolean).at(-1) ?? workspacePath}
        branch={status.branch}
        running={running}
      />
      {status.dirty && (
        <button
          type="button"
          aria-label={t("agents.branch.viewChangedFiles", {
            count: status.changedFiles,
          })}
          title={t("agents.branch.viewWorkspaceChanges")}
          onClick={onShowChanges}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 tabular-nums outline-none motion-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground"
        >
          <FileDiff className="size-3.5" />
          <span>
            {t("agents.branch.fileCount", { count: status.changedFiles })}
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
        </button>
      )}
    </div>
  );
}
