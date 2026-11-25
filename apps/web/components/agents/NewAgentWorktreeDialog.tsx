"use client";

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Dialog } from "@base-ui/react/dialog";
import { Loader2 } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import type {
  AgentProviderId,
  AgentWorkspaceGitBaseRef,
  AgentWorkspaceGitBranch,
} from "@overtchat/agent-bridge";
import { useSidebar } from "@/components/sidebar-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { motionClasses } from "@/lib/motion";
import { useCreateAgentWorktree } from "@/lib/queries/agentConnections";
import { useAgentWorkspaceGitBranches } from "@/lib/queries/agentWorkspaces";
import { cn } from "@/lib/utils";

const ADJECTIVES = [
  "amber",
  "brisk",
  "calm",
  "clever",
  "eager",
  "gentle",
  "keen",
  "lucky",
  "nimble",
  "quiet",
  "rapid",
  "steady",
  "swift",
  "tidy",
  "vivid",
  "witty",
];
const NOUNS = [
  "badger",
  "comet",
  "falcon",
  "fern",
  "fox",
  "harbor",
  "heron",
  "lynx",
  "maple",
  "otter",
  "pine",
  "quartz",
  "raven",
  "river",
  "spruce",
  "wren",
];

function generatedBranchName(): string {
  const pick = (words: string[]) =>
    words[Math.floor(Math.random() * words.length)]!;
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
}

function branchLabel(branch: AgentWorkspaceGitBranch): string {
  return branch.remote ? `${branch.remote}/${branch.name}` : branch.name;
}

function baseRef(branch: AgentWorkspaceGitBranch): AgentWorkspaceGitBaseRef {
  return branch.remote
    ? { kind: "remote", remote: branch.remote, name: branch.name }
    : { kind: "local", name: branch.name };
}

export function NewAgentWorktreeDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  provider,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Workspace the worktree is created from. */
  workspaceId: string;
  workspaceName: string;
  /** Agent the new session in the worktree starts with. */
  provider: AgentProviderId;
  onCreated?: (workspaceId: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { closeMobile } = useSidebar();
  const branches = useAgentWorkspaceGitBranches(workspaceId, { enabled: open });
  const create = useCreateAgentWorktree(workspaceId);
  const [base, setBase] = useState<string | null>(null);
  const [branch, setBranch] = useState(generatedBranchName);
  const [error, setError] = useState("");

  const listed = branches.data?.branches ?? [];
  const local = listed.filter((item) => item.remote === null);
  const remote = listed.filter((item) => item.remote !== null);
  const selectedLabel =
    base ??
    branches.data?.current ??
    (listed[0] ? branchLabel(listed[0]) : null);
  const selected = listed.find((item) => branchLabel(item) === selectedLabel);
  const name = branch.trim();

  function changeOpen(next: boolean) {
    if (create.isPending) return;
    onOpenChange(next);
    if (!next) {
      setBase(null);
      setBranch(generatedBranchName());
      setError("");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !name || create.isPending) return;
    setError("");
    try {
      const created = await create.mutateAsync({
        base: baseRef(selected),
        branch: name,
      });
      changeOpen(false);
      onCreated?.(created.workspaceId);
      toast.success({
        title: t("agents.worktreeDialog.createdTitle", {
          name: created.worktree.name,
        }),
        description: t("agents.worktreeDialog.createdDescription", {
          branch: created.worktree.branch,
          path: created.worktree.worktreePath,
        }),
      });
      closeMobile();
      void navigate({
        to: "/agents/new",
        search: { workspaceId: created.workspaceId, provider },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            "fixed inset-0 z-40 bg-black/40",
            motionClasses.overlay,
          )}
        />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            {t("agents.worktreeDialog.title")}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            <Trans
              i18nKey="agents.worktreeDialog.description"
              values={{ workspace: workspaceName }}
              components={{
                workspace: <span className="font-medium text-foreground" />,
              }}
            />
          </Dialog.Description>
          <form
            onSubmit={(event) => void submit(event)}
            className="mt-5 flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              <span id="worktree-base-label" className="text-sm font-medium">
                {t("agents.worktreeDialog.startFrom")}
              </span>
              {branches.isPending ? (
                <div className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className={cn("size-3.5", motionClasses.spinner)} />
                  {t("agents.branch.loading")}
                </div>
              ) : branches.error ? (
                <p className="text-xs text-destructive">
                  {branches.error.message}
                </p>
              ) : branches.data?.isGit === false ? (
                <p className="text-xs text-destructive">
                  {t("agents.worktreeDialog.notGitRepo")}
                </p>
              ) : (
                <Select
                  value={selectedLabel}
                  onValueChange={(value) => value && setBase(value)}
                  disabled={create.isPending}
                >
                  <SelectTrigger
                    aria-labelledby="worktree-base-label"
                    className="w-full font-mono text-xs"
                  >
                    <SelectValue>{selectedLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {local.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>{t("agents.branch.local")}</SelectLabel>
                        {local.map((item) => (
                          <SelectItem
                            key={branchLabel(item)}
                            value={branchLabel(item)}
                            className="font-mono text-xs"
                          >
                            {branchLabel(item)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {remote.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>{t("agents.branch.remote")}</SelectLabel>
                        {remote.map((item) => (
                          <SelectItem
                            key={branchLabel(item)}
                            value={branchLabel(item)}
                            className="font-mono text-xs"
                          >
                            {branchLabel(item)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="worktree-branch" className="text-sm font-medium">
                {t("agents.worktreeDialog.newBranch")}
              </label>
              <Input
                id="worktree-branch"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                disabled={create.isPending}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs md:text-xs"
              />
            </div>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={create.isPending}
                  />
                }
              >
                {t("agents.common.cancel")}
              </Dialog.Close>
              <Button
                type="submit"
                size="sm"
                disabled={!selected || !name || create.isPending}
              >
                {create.isPending
                  ? t("agents.worktreeDialog.creating")
                  : t("agents.worktreeDialog.create")}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
