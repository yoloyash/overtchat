"use client";

import { Loader2 } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { motionClasses } from "@/lib/motion";
import { useAgentWorktreeInspection } from "@/lib/queries/agentWorkspaces";
import { cn } from "@/lib/utils";

/** Removal warning for a worktree OvertChat created, which removal deletes from the host. */
export function AgentWorktreeRemovalDetails({
  workspaceId,
  name,
}: {
  workspaceId: string;
  name: string;
}) {
  const { t } = useTranslation();
  const inspection = useAgentWorktreeInspection(workspaceId);
  const data = inspection.data;
  return (
    <>
      <Trans
        i18nKey={
          data?.branch
            ? "agents.worktreeRemoval.descriptionWithBranch"
            : "agents.worktreeRemoval.description"
        }
        values={{ name, branch: data?.branch ?? "" }}
        components={{
          name: <span className="font-medium text-foreground" />,
          branch: <span className="font-mono text-xs text-foreground" />,
        }}
      />
      <span
        className="mt-3 block text-xs"
        data-testid="agent-worktree-removal-status"
      >
        {inspection.isPending ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className={cn("size-3", motionClasses.spinner)} />
            {t("agents.worktreeRemoval.checking")}
          </span>
        ) : inspection.error ? (
          <span className="text-destructive">{inspection.error.message}</span>
        ) : !data?.exists ? (
          t("agents.worktreeRemoval.alreadyGone")
        ) : data.changedFiles > 0 ? (
          <span className="font-medium text-destructive">
            {t("agents.worktreeRemoval.uncommittedLost", {
              count: data.changedFiles,
            })}
          </span>
        ) : (
          t("agents.worktreeRemoval.noUncommitted")
        )}
      </span>
    </>
  );
}
