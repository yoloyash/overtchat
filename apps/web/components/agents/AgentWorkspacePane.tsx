"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { code, type HighlightResult } from "@streamdown/code";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileDiff,
  Folder,
  FolderOpen,
  Link,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import type {
  AgentWorkspaceDirectoryEntry,
  AgentWorkspaceFilePreview,
  AgentWorkspaceGitFile,
} from "@overtchat/agent-bridge";
import { Button } from "@/components/ui/button";
import {
  useAgentWorkspaceDirectory,
  useAgentWorkspaceFile,
  useAgentWorkspaceGitStatus,
} from "@/lib/queries/agentWorkspaces";
import { motionClasses } from "@/lib/motion";
import { agentWorkspaceKeys } from "@/lib/queries/keys";
import { cn } from "@/lib/utils";
import type { AgentWorkspaceFileSelection } from "./AgentWorkspaceNavigationContext";

export function AgentWorkspacePane({
  workspaceId,
  workspaceName,
  selection,
  openFiles,
  running,
  onSelect,
  onActivateFiles,
  onActivateFile,
  onCloseFile,
  onClose,
}: {
  workspaceId: string;
  workspaceName: string;
  selection: AgentWorkspaceFileSelection | null;
  openFiles: AgentWorkspaceFileSelection[];
  running: boolean;
  onSelect: (selection: AgentWorkspaceFileSelection) => void;
  onActivateFiles: () => void;
  onActivateFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <aside
      className="flex h-full w-full flex-col border-l bg-background"
      data-testid="agent-workspace-pane"
      aria-label={`${workspaceName} workspace`}
    >
      <WorkspaceTabs
        selection={selection}
        openFiles={openFiles}
        onActivateFiles={onActivateFiles}
        onActivateFile={onActivateFile}
        onCloseFile={onCloseFile}
        onClose={onClose}
      />
      {selection ? (
        <WorkspaceFilePreview
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          selection={selection}
          running={running}
        />
      ) : (
        <WorkspaceExplorer
          workspaceId={workspaceId}
          running={running}
          onSelect={onSelect}
        />
      )}
    </aside>
  );
}

function fileName(filePath: string): string {
  return filePath.split("/").filter(Boolean).at(-1) ?? filePath;
}

function WorkspaceTabs({
  selection,
  openFiles,
  onActivateFiles,
  onActivateFile,
  onCloseFile,
  onClose,
}: {
  selection: AgentWorkspaceFileSelection | null;
  openFiles: AgentWorkspaceFileSelection[];
  onActivateFiles: () => void;
  onActivateFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 border-b bg-muted/15">
      <div
        role="tablist"
        aria-label="Workspace views"
        className="flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain"
      >
        <button
          type="button"
          role="tab"
          aria-selected={selection === null}
          title="Browse workspace files"
          onClick={onActivateFiles}
          className={cn(
            "relative flex h-full shrink-0 items-center gap-2 border-r px-3 text-xs outline-none motion-colors hover:bg-muted/50 focus-visible:bg-muted/60",
            selection === null
              ? "bg-background font-medium text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary"
              : "text-muted-foreground",
          )}
        >
          <FolderOpen className="size-3.5" />
          Files
        </button>
        {openFiles.map((file) => {
          const active = selection?.path === file.path;
          const name = fileName(file.path);
          return (
            <div
              key={file.path}
              className={cn(
                "group relative flex h-full min-w-0 max-w-56 shrink-0 items-center border-r motion-colors hover:bg-muted/50 focus-within:bg-muted/60",
                active
                  ? "bg-background text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary"
                  : "text-muted-foreground",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`Open ${file.path}`}
                title={file.path}
                onClick={() => onActivateFile(file.path)}
                className={cn(
                  "flex h-full min-w-0 items-center gap-2 py-0 pr-1 pl-3 text-xs outline-none",
                  active && "font-medium",
                )}
              >
                <FileCode2 className="size-3.5 shrink-0" />
                <span className="truncate">{name}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${file.path}`}
                title={`Close ${file.path}`}
                onClick={() => onCloseFile(file.path)}
                className={cn(
                  "mr-1 flex size-6 shrink-0 items-center justify-center rounded-md outline-none motion-colors hover:bg-muted focus-visible:bg-muted",
                  active
                    ? "text-muted-foreground"
                    : "text-muted-foreground/0 group-hover:text-muted-foreground group-focus-within:text-muted-foreground [@media(hover:none)]:text-muted-foreground",
                )}
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center border-l bg-background px-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close workspace files"
          title="Close workspace files"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
    </header>
  );
}

function WorkspaceExplorer({
  workspaceId,
  running,
  onSelect,
}: {
  workspaceId: string;
  running: boolean;
  onSelect: (selection: AgentWorkspaceFileSelection) => void;
}) {
  const gitStatus = useAgentWorkspaceGitStatus(workspaceId, {
    active: true,
    running,
  });
  const changedFiles = gitStatus.data?.files ?? [];
  const queryClient = useQueryClient();
  const directoryQueries = agentWorkspaceKeys.directories(workspaceId);
  const refreshingDirectories =
    useIsFetching({ queryKey: directoryQueries }) > 0;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["."]));

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
      {gitStatus.data?.isGit && changedFiles.length > 0 && (
        <section className="pb-3" aria-labelledby="workspace-changes-heading">
          <div className="flex h-8 items-center gap-2 px-3">
            <FileDiff className="size-3.5 text-muted-foreground" />
            <h2
              id="workspace-changes-heading"
              className="text-xs font-medium"
            >
              Changes
            </h2>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {changedFiles.length}
            </span>
          </div>
          <div className="px-1.5">
            {changedFiles.map((file) => (
              <ChangedFileRow
                key={`${file.originalPath ?? ""}:${file.path}`}
                file={file}
                onSelect={() => onSelect({ path: file.path })}
              />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="workspace-files-heading">
        <div className="flex h-8 items-center gap-2 px-3">
          <Folder className="size-3.5 text-muted-foreground" />
          <h2 id="workspace-files-heading" className="text-xs font-medium">
            Files
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            aria-label="Refresh workspace files"
            title="Refresh workspace files"
            disabled={refreshingDirectories}
            onClick={() =>
              void queryClient.invalidateQueries({ queryKey: directoryQueries })
            }
          >
            <RefreshCw
              className={
                refreshingDirectories ? motionClasses.spinner : undefined
              }
            />
          </Button>
        </div>
        <WorkspaceDirectory
          workspaceId={workspaceId}
          path="."
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          onSelect={onSelect}
        />
      </section>
    </div>
  );
}

function ChangedFileRow({
  file,
  onSelect,
}: {
  file: AgentWorkspaceGitFile;
  onSelect: () => void;
}) {
  const status = file.worktreeStatus ?? file.indexStatus ?? "M";
  const label =
    status === "?" || status === "A"
      ? "Added"
      : status === "D"
        ? "Deleted"
        : status === "R"
          ? "Renamed"
          : status === "U"
            ? "Conflicted"
            : "Modified";
  const deleted = status === "D";

  return (
    <button
      type="button"
      disabled={deleted}
      onClick={onSelect}
      title={deleted ? `${file.path} was deleted` : file.path}
      className="group flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs outline-none motion-colors hover:bg-muted disabled:cursor-default disabled:opacity-60"
    >
      <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
      <span
        className={cn(
          "shrink-0 text-[10px] font-medium",
          label === "Added" && "text-emerald-700 dark:text-emerald-300",
          label === "Deleted" && "text-red-700 dark:text-red-300",
          label === "Conflicted" && "text-amber-700 dark:text-amber-300",
          (label === "Modified" || label === "Renamed") &&
            "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </button>
  );
}

function WorkspaceDirectory({
  workspaceId,
  path,
  depth,
  expanded,
  onToggle,
  onSelect,
}: {
  workspaceId: string;
  path: string;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (selection: AgentWorkspaceFileSelection) => void;
}) {
  const isExpanded = expanded.has(path);
  const directory = useAgentWorkspaceDirectory(workspaceId, path, {
    enabled: isExpanded,
  });

  if (!isExpanded) return null;
  if (directory.isPending) {
    return (
      <div className="flex h-8 items-center gap-2 px-3 text-xs text-muted-foreground">
        <Loader2 className={cn("size-3.5", motionClasses.spinner)} />
        Loading files…
      </div>
    );
  }
  if (directory.error) {
    return (
      <div className="mx-3 my-1 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
        {directory.error.message}
      </div>
    );
  }

  return (
    <div>
      {directory.data?.entries.map((entry) => (
        <WorkspaceEntryRow
          key={entry.path}
          entry={entry}
          workspaceId={workspaceId}
          depth={depth}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
      {directory.data?.entries.length === 0 && depth === 0 && (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          This workspace is empty.
        </p>
      )}
      {directory.data?.truncated && (
        <p className="px-3 py-2 text-[11px] text-muted-foreground">
          Showing the first 1,000 entries.
        </p>
      )}
    </div>
  );
}

function WorkspaceEntryRow({
  entry,
  workspaceId,
  depth,
  expanded,
  onToggle,
  onSelect,
}: {
  entry: AgentWorkspaceDirectoryEntry;
  workspaceId: string;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (selection: AgentWorkspaceFileSelection) => void;
}) {
  const directory = entry.kind === "directory" && !entry.symlink;
  const open = directory && expanded.has(entry.path);
  const disabled = entry.kind === "symlink" || entry.symlink;

  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          directory
            ? onToggle(entry.path)
            : onSelect({ path: entry.path })
        }
        title={
          disabled
            ? `${entry.path} is a symbolic link and cannot be previewed`
            : entry.path
        }
        className="flex min-h-8 w-full items-center gap-1.5 pr-2 text-left text-xs outline-none motion-colors hover:bg-muted disabled:cursor-default disabled:opacity-60"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {directory ? (
          open ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {disabled ? (
          <Link className="size-3.5 shrink-0 text-muted-foreground" />
        ) : directory ? (
          open ? (
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <File className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
      {open && (
        <WorkspaceDirectory
          workspaceId={workspaceId}
          path={entry.path}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function WorkspaceFilePreview({
  workspaceId,
  workspaceName,
  selection,
  running,
}: {
  workspaceId: string;
  workspaceName: string;
  selection: AgentWorkspaceFileSelection;
  running: boolean;
}) {
  const file = useAgentWorkspaceFile(workspaceId, selection.path, { running });
  const displayPath = file.data?.path ?? selection.path;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs text-muted-foreground"
          title={`${workspaceName}/${displayPath}`}
          aria-label={`File path: ${workspaceName}/${displayPath}`}
        >
          <span className="shrink-0 truncate">{workspaceName}</span>
          {displayPath.split("/").filter(Boolean).map((segment, index, parts) => (
            <span
              key={`${index}:${segment}`}
              className="flex min-w-0 items-center gap-1"
            >
              <ChevronRight className="size-3 shrink-0 opacity-60" />
              <span
                className={cn(
                  "truncate",
                  index === parts.length - 1 &&
                    "font-medium text-foreground",
                )}
              >
                {segment}
              </span>
            </span>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh file"
          title="Refresh file"
          disabled={file.isFetching}
          onClick={() => void file.refetch()}
        >
          <RefreshCw className={file.isFetching ? motionClasses.spinner : undefined} />
        </Button>
      </div>
      {file.isPending ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className={cn("size-4", motionClasses.spinner)} />
          Loading file…
        </div>
      ) : file.error ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div className="max-w-xs">
            <AlertTriangle className="mx-auto size-5 text-destructive" />
            <p className="mt-3 text-sm font-medium">File cannot be previewed</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {file.error.message}
            </p>
          </div>
        </div>
      ) : file.data ? (
        <HighlightedFile
          file={file.data}
          lineStart={selection.lineStart}
          lineEnd={selection.lineEnd}
        />
      ) : null}
    </div>
  );
}

function languageForPath(filePath: string): string {
  const name = filePath.split("/").at(-1)?.toLowerCase() ?? "";
  const extension = name.includes(".") ? name.split(".").at(-1) ?? "" : "";
  const aliases: Record<string, string> = {
    cjs: "javascript",
    cts: "typescript",
    h: "c",
    hpp: "cpp",
    js: "javascript",
    jsx: "jsx",
    md: "markdown",
    mdx: "mdx",
    mjs: "javascript",
    mts: "typescript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "shellscript",
    ts: "typescript",
    tsx: "tsx",
    yml: "yaml",
  };
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  const language = aliases[extension] ?? extension;
  return language && code.supportsLanguage(language as never) ? language : "text";
}

function HighlightedFile({
  file,
  lineStart,
  lineEnd,
}: {
  file: AgentWorkspaceFilePreview;
  lineStart?: number;
  lineEnd?: number;
}) {
  const [highlighted, setHighlighted] = useState<HighlightResult | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const language = useMemo(() => languageForPath(file.path), [file.path]);

  useEffect(() => {
    let active = true;
    const update = (result: HighlightResult) => {
      if (active) setHighlighted(result);
    };
    const result = code.highlight(
      {
        code: file.content,
        language: language as never,
        themes: code.getThemes(),
      },
      update,
    );
    if (result) update(result);
    return () => {
      active = false;
    };
  }, [file.content, language]);

  useEffect(() => {
    if (!highlighted || !lineStart) return;
    scrollerRef.current
      ?.querySelector(`[data-line="${lineStart}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [highlighted, lineStart]);

  const fallbackLines = file.content.split("\n");
  const lines: HighlightResult["tokens"] =
    highlighted?.tokens ??
    fallbackLines.map((content) => [{ content, offset: 0 }]);

  return (
    <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto bg-muted/10">
      <pre className="min-w-max py-3 font-mono text-xs leading-5 text-foreground tab-size-4">
        <code>
          {lines.map((tokens, index) => {
            const line = index + 1;
            const selected =
              lineStart !== undefined &&
              line >= lineStart &&
              line <= (lineEnd ?? lineStart);
            return (
              <span
                key={line}
                data-line={line}
                className={cn(
                  "flex min-h-5 px-3",
                  selected && "bg-primary/10 ring-1 ring-inset ring-primary/15",
                )}
              >
                <span
                  aria-hidden="true"
                  className="mr-4 w-8 shrink-0 select-none text-right text-muted-foreground/60"
                >
                  {line}
                </span>
                <span className="whitespace-pre">
                  {tokens.map((token, tokenIndex) => {
                    const {
                      color: htmlColor,
                      "background-color": htmlBackground,
                      ...htmlStyle
                    } = token.htmlStyle ?? {};
                    return (
                      <span
                        key={`${line}:${tokenIndex}`}
                        data-workspace-code-token
                        className="text-[var(--workspace-token-color,inherit)] dark:text-[var(--shiki-dark,var(--workspace-token-color,inherit))] bg-[var(--workspace-token-background,transparent)] dark:bg-[var(--shiki-dark-bg,var(--workspace-token-background,transparent))]"
                        style={{
                          "--workspace-token-color":
                            htmlColor ?? token.color ?? "inherit",
                          "--workspace-token-background":
                            htmlBackground ?? token.bgColor ?? "transparent",
                          fontStyle:
                            token.fontStyle && token.fontStyle & 1
                              ? "italic"
                              : undefined,
                          fontWeight:
                            token.fontStyle && token.fontStyle & 2
                              ? "bold"
                              : undefined,
                          textDecoration:
                            token.fontStyle && token.fontStyle & 4
                              ? "underline"
                              : undefined,
                          ...htmlStyle,
                        } as CSSProperties}
                      >
                        {token.content || " "}
                      </span>
                    );
                  })}
                </span>
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
