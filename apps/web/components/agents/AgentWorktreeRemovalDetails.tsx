"use client";

import { Loader2 } from "lucide-react";
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
  const inspection = useAgentWorktreeInspection(workspaceId);
  const data = inspection.data;
  return (
    <>
      <span className="font-medium text-foreground">{name}</span> and its agent
      chats will be removed from OvertChat, and the worktree folder will be
      deleted from the host.
      {data?.branch && (
        <>
          {" "}
          Its commits stay on the{" "}
          <span className="font-mono text-xs text-foreground">
            {data.branch}
          </span>{" "}
          branch.
        </>
      )}
      <span
        className="mt-3 block text-xs"
        data-testid="agent-worktree-removal-status"
      >
        {inspection.isPending ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className={cn("size-3", motionClasses.spinner)} />
            Checking for uncommitted changes…
          </span>
        ) : inspection.error ? (
          <span className="text-destructive">{inspection.error.message}</span>
        ) : !data?.exists ? (
          "The worktree folder is already gone."
        ) : data.changedFiles > 0 ? (
          <span className="font-medium text-destructive">
            {data.changedFiles} uncommitted{" "}
            {data.changedFiles === 1 ? "change" : "changes"} will be lost.
          </span>
        ) : (
          "No uncommitted changes."
        )}
      </span>
    </>
  );
}
