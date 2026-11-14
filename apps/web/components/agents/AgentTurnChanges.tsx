"use client";

import { useContext, useMemo, useState } from "react";
import type { AgentTurnChanges } from "@overtchat/agent-bridge";
import {
  agentTurnChangesDirectories,
  agentTurnChangesLabel,
  agentTurnChangesRows,
  buildAgentTurnChangesTree,
  formatAgentChangeCount,
  type AgentTurnChangesRow,
} from "@overtchat/shared/agent-turn-changes";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  File,
  Folder,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentDisclosureContext } from "./AgentTranscriptMotion";
import { useAgentWorkspaceNavigation } from "./AgentWorkspaceNavigationContext";

const rowClass =
  "group/row flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left";
const pressableClass =
  "cursor-pointer motion-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70";

function LineCounts({
  additions,
  deletions,
  className,
}: {
  additions: number;
  deletions: number;
  className?: string;
}) {
  return (
    <span
      role="group"
      aria-label={`${additions} added, ${deletions} removed`}
      className={cn("inline-flex shrink-0 items-center gap-1.5 font-mono tabular-nums", className)}
    >
      <span aria-hidden="true" className="text-emerald-700 dark:text-emerald-300">
        +{formatAgentChangeCount(additions)}
      </span>
      <span aria-hidden="true" className="text-red-700 dark:text-red-300">
        -{formatAgentChangeCount(deletions)}
      </span>
    </span>
  );
}

/** The files one turn changed, as a folder tree with line counts. */
export function AgentTurnChangesCard({ changes }: { changes: AgentTurnChanges }) {
  const navigation = useAgentWorkspaceNavigation();
  const holdDisclosure = useContext(AgentDisclosureContext);
  const tree = useMemo(() => buildAgentTurnChangesTree(changes), [changes]);
  const hasDirectories = useMemo(
    () => agentTurnChangesDirectories(tree).length > 0,
    [tree],
  );
  // Folders start closed; each one remembers a press until all are toggled.
  const [allOpen, setAllOpen] = useState(false);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const rows = useMemo(
    () => agentTurnChangesRows(tree, (path) => allOpen !== toggled.has(path)),
    [tree, allOpen, toggled],
  );
  const unlisted = changes.total.files - changes.files.length;
  const counted = changes.total.additions > 0 || changes.total.deletions > 0;

  const renderRow = ({ node, depth }: AgentTurnChangesRow) => {
    const style = { paddingLeft: 8 + depth * 14 };
    const counts = (node.additions > 0 || node.deletions > 0) && (
      <LineCounts
        additions={node.additions}
        deletions={node.deletions}
        className="ml-auto text-[11px]"
      />
    );
    if (node.kind === "directory") {
      const open = allOpen !== toggled.has(node.path);
      const Icon = open ? FolderOpen : Folder;
      return (
        <li key={`directory:${node.path}`}>
          <button
            type="button"
            aria-expanded={open}
            style={style}
            className={cn(rowClass, pressableClass)}
            onClick={(event) => {
              holdDisclosure(event.currentTarget);
              setToggled((current) => {
                const next = new Set(current);
                if (!next.delete(node.path)) next.add(node.path);
                return next;
              });
            }}
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/70 motion-transform",
                open && "rotate-90",
              )}
            />
            <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground group-hover/row:text-foreground">
              {node.name}
            </span>
            {counts}
          </button>
        </li>
      );
    }
    const content = (
      <>
        {(hasDirectories || depth > 0) && (
          <span aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        <File aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-mono text-xs text-foreground/85 group-hover/row:text-foreground">
          {node.name}
        </span>
        {counts}
      </>
    );
    const title = node.previousPath
      ? `${node.path} (renamed from ${node.previousPath})`
      : node.path;
    const workspacePath = node.workspacePath;
    return (
      <li key={`file:${node.path}`} data-testid="agent-turn-changes-file">
        {navigation && workspacePath ? (
          <button
            type="button"
            title={title}
            aria-label={`Open ${node.path}`}
            style={style}
            className={cn(rowClass, pressableClass)}
            onClick={() => navigation.openFile({ path: workspacePath })}
          >
            {content}
          </button>
        ) : (
          <div title={title} style={style} className={rowClass}>
            {content}
          </div>
        )}
      </li>
    );
  };

  return (
    <section
      aria-label="Changed files"
      className="overflow-hidden rounded-lg border bg-muted/15"
      data-testid="agent-turn-changes"
    >
      <div className="flex min-h-9 items-center gap-3 px-3 py-1.5 text-xs">
        <h3 className="font-medium">{agentTurnChangesLabel(changes.total.files)}</h3>
        {counted && (
          <LineCounts
            additions={changes.total.additions}
            deletions={changes.total.deletions}
          />
        )}
        {hasDirectories && (
          <button
            type="button"
            aria-label={allOpen ? "Collapse all folders" : "Expand all folders"}
            title={allOpen ? "Collapse all folders" : "Expand all folders"}
            className="ml-auto flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground motion-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            onClick={(event) => {
              holdDisclosure(event.currentTarget);
              setAllOpen((current) => !current);
              setToggled(new Set());
            }}
          >
            {allOpen ? (
              <ChevronsDownUp className="size-3.5" />
            ) : (
              <ChevronsUpDown className="size-3.5" />
            )}
          </button>
        )}
      </div>
      <ul className="px-1 pb-1">{rows.map(renderRow)}</ul>
      {unlisted > 0 && (
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          and {unlisted.toLocaleString("en-US")} more {unlisted === 1 ? "file" : "files"}
        </p>
      )}
    </section>
  );
}
