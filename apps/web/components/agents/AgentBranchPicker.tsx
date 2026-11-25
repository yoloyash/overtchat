"use client";

import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  Check,
  ChevronDown,
  GitBranch,
  GitBranchPlus,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import type {
  AgentProviderId,
  AgentWorkspaceGitBranch,
  AgentWorkspaceGitSwitchResult,
  AgentWorkspaceGitSwitchTarget,
} from "@overtchat/agent-bridge";
import { formatUpdatedAt } from "@overtchat/shared";
import { NewAgentWorktreeDialog } from "@/components/agents/NewAgentWorktreeDialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { motionClasses } from "@/lib/motion";
import {
  useAgentWorkspaceGitBranches,
  useSwitchAgentWorkspaceGitBranch,
} from "@/lib/queries/agentWorkspaces";
import { cn } from "@/lib/utils";

const itemClassName =
  "flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 outline-none motion-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

function branchLabel(branch: AgentWorkspaceGitBranch): string {
  return branch.remote ? `${branch.remote}/${branch.name}` : branch.name;
}

function switchTarget(branch: AgentWorkspaceGitBranch): AgentWorkspaceGitSwitchTarget {
  return branch.remote
    ? { kind: "remote", remote: branch.remote, name: branch.name }
    : { kind: "local", name: branch.name };
}

function switchedDescription(
  result: Extract<AgentWorkspaceGitSwitchResult, { status: "switched" }>,
  previous: string | null,
  t: TFunction,
): string | undefined {
  const notes = [
    result.stashed &&
      (previous
        ? t("agents.branch.stashedOnBranch", { branch: previous })
        : t("agents.branch.stashed")),
    result.restored && t("agents.branch.restored"),
    result.keptStash &&
      t("agents.branch.keptStash", {
        branch: result.branch,
        stash: result.keptStash,
      }),
  ].filter(Boolean);
  return notes.length ? notes.join(" ") : undefined;
}

export function AgentBranchPicker({
  provider,
  workspaceId,
  workspaceName,
  branch,
  running,
}: {
  /** Agent a session in a new worktree starts with. */
  provider: AgentProviderId;
  workspaceId: string;
  workspaceName: string;
  /** Checked-out branch; null when HEAD is detached. */
  branch: string | null;
  /** The open session has a turn in progress. */
  running: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [stashPrompt, setStashPrompt] = useState<{
    target: AgentWorkspaceGitSwitchTarget;
    label: string;
    changedFiles: number;
  } | null>(null);
  const branches = useAgentWorkspaceGitBranches(workspaceId, { enabled: open });
  const switchBranch = useSwitchAgentWorkspaceGitBranch(workspaceId);
  const pending = switchBranch.isPending;
  const branchText = branch ?? t("agents.branch.detachedHead");

  const query = search.trim();
  const listed = branches.data?.branches ?? [];
  const filtered = query
    ? listed.filter((item) =>
        branchLabel(item).toLowerCase().includes(query.toLowerCase()),
      )
    : listed;
  const local = filtered.filter((item) => item.remote === null);
  const remote = filtered.filter((item) => item.remote !== null);
  const canCreate =
    Boolean(query) &&
    branches.data?.isGit === true &&
    !listed.some((item) => item.remote === null && item.name === query);

  function changeOpen(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setSearch("");
      setStashPrompt(null);
    }
  }

  async function select(
    target: AgentWorkspaceGitSwitchTarget,
    label: string,
    stash = false,
  ) {
    try {
      const result = await switchBranch.mutateAsync({ branch: target, stash });
      if (result.status === "changes_present") {
        setStashPrompt({ target, label, changedFiles: result.changedFiles });
        return;
      }
      setOpen(false);
      setSearch("");
      setStashPrompt(null);
      if (result.status === "agent_running") {
        toast.error({
          title: t("agents.branch.agentRunningTitle"),
          description: t("agents.branch.agentRunningDescription"),
        });
        return;
      }
      toast.success({
        title: t("agents.branch.switchedTitle", { branch: result.branch }),
        description: switchedDescription(result, branch, t),
      });
    } catch (error) {
      toast.error({
        title: t("agents.branch.switchErrorTitle"),
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function branchItem(item: AgentWorkspaceGitBranch) {
    const label = branchLabel(item);
    return (
      <Menu.Item
        key={label}
        closeOnClick={false}
        disabled={running || pending || item.current || Boolean(item.worktreePath)}
        onClick={() => void select(switchTarget(item), item.name)}
        data-testid="agent-branch-option"
        className={cn(itemClassName, item.current && "data-[disabled]:cursor-default data-[disabled]:opacity-100")}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {item.current && <Check className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs">{label}</span>
          {item.worktreePath && (
            <span
              className="block truncate text-[11px] text-muted-foreground"
              title={item.worktreePath}
            >
              {t("agents.branch.checkedOutIn", { path: item.worktreePath })}
            </span>
          )}
        </span>
        {item.committedAt !== null && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatUpdatedAt(item.committedAt)}
          </span>
        )}
      </Menu.Item>
    );
  }

  return (
    <>
      <Menu.Root open={open} onOpenChange={changeOpen}>
        <Menu.Trigger
          aria-label={t("agents.branch.triggerLabel", { branch: branchText })}
          data-testid="agent-branch-picker"
          className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 outline-none motion-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground data-[popup-open]:bg-muted data-[popup-open]:text-foreground"
        >
          <GitBranch className="size-3.5 shrink-0" />
          <span className="max-w-28 truncate">{branchText}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="start" sideOffset={6}>
            <Menu.Popup
              aria-label={t("agents.branch.menuLabel")}
              className={cn(
                "z-50 max-h-[min(28rem,calc(100vh-5rem))] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
                motionClasses.popup,
              )}
            >
              {stashPrompt ? (
                <>
                  <div className="px-2.5 pb-2 pt-1.5">
                    <div className="font-medium">
                      {t("agents.branch.uncommittedChanges", {
                        count: stashPrompt.changedFiles,
                      })}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {branch
                        ? t("agents.branch.stashPromptDescriptionWithBranch", {
                            target: stashPrompt.label,
                            current: branch,
                          })
                        : t("agents.branch.stashPromptDescription", {
                            target: stashPrompt.label,
                          })}
                    </p>
                  </div>
                  <Menu.Item
                    closeOnClick={false}
                    disabled={pending}
                    onClick={() =>
                      void select(stashPrompt.target, stashPrompt.label, true)
                    }
                    className={itemClassName}
                  >
                    {pending ? (
                      <Loader2 className={cn("size-3.5", motionClasses.spinner)} />
                    ) : (
                      <GitBranch className="size-3.5 text-muted-foreground" />
                    )}
                    {t("agents.branch.stashAndSwitch")}
                  </Menu.Item>
                  <Menu.Item
                    closeOnClick={false}
                    disabled={pending}
                    onClick={() => setStashPrompt(null)}
                    className={itemClassName}
                  >
                    <span className="size-3.5" />
                    {t("agents.common.cancel")}
                  </Menu.Item>
                </>
              ) : (
                <>
                  <div className="sticky top-0 z-10 bg-popover pb-1">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        autoFocus
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        onKeyDown={(event) => {
                          if (!["Escape", "Tab", "ArrowDown", "ArrowUp"].includes(event.key)) {
                            event.stopPropagation();
                          }
                        }}
                        placeholder={t("agents.branch.searchPlaceholder")}
                        aria-label={t("agents.branch.searchLabel")}
                        className="h-8 pl-7 text-xs md:text-xs"
                      />
                    </div>
                    {running && (
                      <p className="px-2 pt-1.5 text-xs text-muted-foreground">
                        {t("agents.branch.waitForTurn")}
                      </p>
                    )}
                    {pending && (
                      <p className="flex items-center gap-1.5 px-2 pt-1.5 text-xs text-muted-foreground">
                        <Loader2 className={cn("size-3", motionClasses.spinner)} />
                        {t("agents.branch.switching")}
                      </p>
                    )}
                  </div>
                  {branches.isPending && (
                    <div className="flex items-center justify-center gap-2 px-2 py-6 text-xs text-muted-foreground">
                      <Loader2 className={cn("size-3.5", motionClasses.spinner)} />
                      {t("agents.branch.loading")}
                    </div>
                  )}
                  {branches.error && (
                    <div className="px-2.5 py-4 text-xs text-destructive">
                      {branches.error.message}
                    </div>
                  )}
                  {canCreate && (
                    <Menu.Item
                      closeOnClick={false}
                      disabled={running || pending}
                      onClick={() => void select({ kind: "new", name: query }, query)}
                      className={itemClassName}
                    >
                      <Plus className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate">
                        <Trans
                          i18nKey="agents.branch.createBranch"
                          values={{ name: query }}
                          components={{
                            name: <span className="font-mono text-xs" />,
                          }}
                        />
                      </span>
                    </Menu.Item>
                  )}
                  {branches.data && !filtered.length && !canCreate && (
                    <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                      {branches.data.isGit
                        ? t("agents.branch.noMatches")
                        : t("agents.branch.notGitRepo")}
                    </div>
                  )}
                  {local.length > 0 && (
                    <Menu.Group>
                      <Menu.GroupLabel className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                        {t("agents.branch.local")}
                      </Menu.GroupLabel>
                      {local.map(branchItem)}
                    </Menu.Group>
                  )}
                  {remote.length > 0 && (
                    <Menu.Group>
                      <Menu.GroupLabel className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                        {t("agents.branch.remote")}
                      </Menu.GroupLabel>
                      {remote.map(branchItem)}
                    </Menu.Group>
                  )}
                  {branches.data?.truncated && (
                    <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
                      {t("agents.branch.showingRecent", {
                        count: branches.data.branches.length,
                      })}
                    </p>
                  )}
                  {branches.data?.isGit && (
                    <>
                      <Menu.Separator className="my-1 h-px bg-border" />
                      <Menu.Item
                        disabled={pending}
                        onClick={() => setWorktreeOpen(true)}
                        className={itemClassName}
                      >
                        <GitBranchPlus className="size-4 shrink-0 text-muted-foreground" />
                        {t("agents.branch.newWorktree")}
                      </Menu.Item>
                    </>
                  )}
                </>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <NewAgentWorktreeDialog
        open={worktreeOpen}
        onOpenChange={setWorktreeOpen}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        provider={provider}
      />
    </>
  );
}
