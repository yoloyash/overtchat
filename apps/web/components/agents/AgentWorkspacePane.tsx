"use client";

import { ErrorNotice } from "@/components/ui/error-notice";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Menu } from "@base-ui/react/menu";
import { code, type HighlightResult } from "@streamdown/code";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { writeText as clipboardWriteText } from "clipboard-polyfill";
import {
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  Eye,
  File,
  FileCode2,
  FileDiff,
  Folder,
  FolderOpen,
  Link,
  Loader2,
  RefreshCw,
  WrapText,
  X,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type {
  AgentWorkspaceDirectoryEntry,
  AgentWorkspaceFilePreview,
  AgentWorkspaceGitFile,
  AgentWorkspaceTextFilePreview,
} from "@overtchat/agent-bridge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  useAgentWorkspaceDirectory,
  useAgentWorkspaceFile,
  useAgentWorkspaceFileDiff,
  useAgentWorkspaceGitStatus,
} from "@/lib/queries/agentWorkspaces";
import { motionClasses } from "@/lib/motion";
import {
  agentWorkspaceGitDecorationMap,
  agentWorkspaceGitFileDecoration,
  ignoredGitDecoration,
  type AgentWorkspaceGitDecoration,
} from "@/lib/agents/workspaceGitDecorations";
import { workspaceFileRendering } from "@/lib/agents/workspaceFilePreview";
import { agentWorkspaceKeys } from "@/lib/queries/keys";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { cn } from "@/lib/utils";
import type { AgentWorkspaceFileSelection } from "./AgentWorkspaceNavigationContext";
import { AgentDiffLines } from "./AgentDiffLines";
import {
  AgentWorkspaceImage,
  AgentWorkspaceRenderedFile,
} from "./AgentWorkspaceRenderedFile";

const EMPTY_CHANGED_FILES: AgentWorkspaceGitFile[] = [];
const WRAP_LINES_KEY = "overtchat:agent-workspace-wrap-lines";

/**
 * How an open file is shown: `preview` is its rendered form where it has one
 * and its source otherwise, `diff` its uncommitted changes.
 */
type FileView = "preview" | "source" | "diff";

/** A file's chosen view, kept until a link asks for a different line. */
type FileViewChoice = { view: FileView; lineStart: number | undefined };

export function AgentWorkspacePane({
  workspaceId,
  workspaceName,
  active,
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
  active: boolean;
  selection: AgentWorkspaceFileSelection | null;
  openFiles: AgentWorkspaceFileSelection[];
  running: boolean;
  onSelect: (selection: AgentWorkspaceFileSelection) => void;
  onActivateFiles: () => void;
  onActivateFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const gitStatus = useAgentWorkspaceGitStatus(workspaceId, {
    active: true,
    running,
  });
  const changedFiles = gitStatus.data?.files ?? EMPTY_CHANGED_FILES;
  const gitDecorations = useMemo(
    () => agentWorkspaceGitDecorationMap(changedFiles),
    [changedFiles],
  );
  const [viewChoices, setViewChoices] = useState<Record<string, FileViewChoice>>(
    {},
  );
  const viewChoice = selection ? viewChoices[selection.path] : undefined;
  const changedFile = selection
    ? changedFiles.find((file) => file.path === selection.path)
    : undefined;
  const chosenView =
    viewChoice && viewChoice.lineStart === selection?.lineStart
      ? viewChoice.view
      : undefined;
  const view: FileView =
    // A deleted file has nothing left to show but what was removed.
    changedFile && gitDecorations.get(changedFile.path)?.kind === "deleted"
      ? "diff"
      : chosenView && (chosenView !== "diff" || changedFile)
        ? chosenView
        : // A link to a line opens the source, where that line can be shown.
          selection?.lineStart !== undefined
          ? "source"
          : "preview";
  const chooseView = (path: string, next: FileView, lineStart?: number) =>
    setViewChoices((current) => ({
      ...current,
      [path]: { view: next, lineStart },
    }));

  return (
    <aside
      className="flex h-full w-full flex-col border-l bg-background"
      data-testid="agent-workspace-pane"
      aria-label={t("agents.workspace.paneLabel", { workspace: workspaceName })}
    >
      <WorkspaceTabs
        selection={selection}
        openFiles={openFiles}
        gitDecorations={gitDecorations}
        onActivateFiles={onActivateFiles}
        onActivateFile={onActivateFile}
        onCloseFile={onCloseFile}
        onClose={onClose}
      />
      {selection ? (
        <WorkspaceFilePreview
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          active={active}
          selection={selection}
          view={view}
          onView={(next) => chooseView(selection.path, next, selection.lineStart)}
          changedFile={changedFile}
          decoration={
            gitDecorations.get(selection.path) ??
            (selection.gitIgnored ? ignoredGitDecoration : undefined)
          }
          running={running}
        />
      ) : (
        <WorkspaceExplorer
          workspaceId={workspaceId}
          active={active}
          isGit={gitStatus.data?.isGit === true}
          changedFiles={changedFiles}
          gitDecorations={gitDecorations}
          onSelect={onSelect}
          onSelectChange={(file) => {
            chooseView(file.path, "diff");
            onSelect({ path: file.path });
          }}
        />
      )}
    </aside>
  );
}

function fileName(filePath: string): string {
  return filePath.split("/").filter(Boolean).at(-1) ?? filePath;
}

function gitDecorationTextClass(
  decoration: AgentWorkspaceGitDecoration | undefined,
): string | undefined {
  switch (decoration?.kind) {
    case "added":
      return "text-emerald-700 dark:text-emerald-300";
    case "modified":
    case "renamed":
      return "text-amber-700 dark:text-amber-300";
    case "conflicted":
    case "deleted":
      return "text-red-700 dark:text-red-300";
    case "ignored":
      return "text-muted-foreground/50";
    default:
      return undefined;
  }
}

function gitDecorationLabel(
  decoration: AgentWorkspaceGitDecoration,
  t: TFunction,
): string {
  if (decoration.kind === "added" && decoration.code === "U") {
    return t("agents.workspace.gitStatus.untracked");
  }
  return t(`agents.workspace.gitStatus.${decoration.kind}`);
}

function gitDecoratedTitle(
  path: string,
  decoration: AgentWorkspaceGitDecoration | undefined,
  t: TFunction,
): string {
  return decoration
    ? t("agents.workspace.decoratedPath", {
        path,
        status: gitDecorationLabel(decoration, t),
      })
    : path;
}

function WorkspaceTabs({
  selection,
  openFiles,
  gitDecorations,
  onActivateFiles,
  onActivateFile,
  onCloseFile,
  onClose,
}: {
  selection: AgentWorkspaceFileSelection | null;
  openFiles: AgentWorkspaceFileSelection[];
  gitDecorations: Map<string, AgentWorkspaceGitDecoration>;
  onActivateFiles: () => void;
  onActivateFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header data-titlebar className="flex h-12 shrink-0 border-b bg-muted/15">
      <div
        role="tablist"
        aria-label={t("agents.workspace.viewsLabel")}
        className="flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain"
      >
        <button
          type="button"
          role="tab"
          aria-selected={selection === null}
          title={t("agents.workspace.browseFiles")}
          onClick={onActivateFiles}
          className={cn(
            "relative flex h-full shrink-0 items-center gap-2 border-r px-3 text-xs outline-none motion-colors hover:bg-muted/50 focus-visible:bg-muted/60",
            selection === null
              ? "bg-background font-medium text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary"
              : "text-muted-foreground",
          )}
        >
          <FolderOpen className="size-3.5" />
          {t("agents.workspace.files")}
        </button>
        {openFiles.map((file) => {
          const active = selection?.path === file.path;
          const name = fileName(file.path);
          const decoration =
            gitDecorations.get(file.path) ??
            (file.gitIgnored ? ignoredGitDecoration : undefined);
          return (
            <div
              key={file.path}
              data-git-status={decoration?.kind}
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
                aria-label={t("agents.activity.openFilePath", {
                  path: file.path,
                })}
                title={gitDecoratedTitle(file.path, decoration, t)}
                onClick={() => onActivateFile(file.path)}
                className={cn(
                  "flex h-full min-w-0 items-center gap-2 py-0 pr-1 pl-3 text-xs outline-none",
                  active && "font-medium",
                )}
              >
                <FileCode2
                  className={cn(
                    "size-3.5 shrink-0",
                    gitDecorationTextClass(decoration),
                  )}
                />
                <span
                  className={cn("truncate", gitDecorationTextClass(decoration))}
                >
                  {name}
                </span>
                {decoration?.code && (
                  <span
                    aria-label={gitDecorationLabel(decoration, t)}
                    className={cn(
                      "shrink-0 text-[10px] font-semibold",
                      gitDecorationTextClass(decoration),
                    )}
                  >
                    {decoration.code}
                  </span>
                )}
              </button>
              <button
                type="button"
                aria-label={t("agents.workspace.closePath", {
                  path: file.path,
                })}
                title={t("agents.workspace.closePath", { path: file.path })}
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
          aria-label={t("agents.session.closeFiles")}
          title={t("agents.session.closeFiles")}
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
  active,
  isGit,
  changedFiles,
  gitDecorations,
  onSelect,
  onSelectChange,
}: {
  workspaceId: string;
  active: boolean;
  isGit: boolean;
  changedFiles: AgentWorkspaceGitFile[];
  gitDecorations: Map<string, AgentWorkspaceGitDecoration>;
  onSelect: (selection: AgentWorkspaceFileSelection) => void;
  /** Opens a changed file on its changes instead of its contents. */
  onSelectChange: (file: AgentWorkspaceGitFile) => void;
}) {
  const { t } = useTranslation();
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
      {isGit && changedFiles.length > 0 && (
        <section className="pb-3" aria-labelledby="workspace-changes-heading">
          <div className="flex h-8 items-center gap-2 px-3">
            <FileDiff className="size-3.5 text-muted-foreground" />
            <h2
              id="workspace-changes-heading"
              className="text-xs font-medium"
            >
              {t("agents.workspace.changes")}
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
                onSelect={() => onSelectChange(file)}
              />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="workspace-files-heading">
        <div className="flex h-8 items-center gap-2 px-3">
          <Folder className="size-3.5 text-muted-foreground" />
          <h2 id="workspace-files-heading" className="text-xs font-medium">
            {t("agents.workspace.files")}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            aria-label={t("agents.workspace.refreshFiles")}
            title={t("agents.workspace.refreshFiles")}
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
          active={active}
          path="."
          depth={0}
          expanded={expanded}
          gitDecorations={gitDecorations}
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
  const { t } = useTranslation();
  const decoration = agentWorkspaceGitFileDecoration(file);

  return (
    <button
      type="button"
      onClick={onSelect}
      title={gitDecoratedTitle(file.path, decoration, t)}
      data-git-status={decoration.kind}
      className="group flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs outline-none motion-colors hover:bg-muted"
    >
      <FileCode2
        className={cn("size-3.5 shrink-0", gitDecorationTextClass(decoration))}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-mono",
          gitDecorationTextClass(decoration),
        )}
      >
        {file.path}
      </span>
      <span
        className={cn(
          "shrink-0 text-[10px] font-medium",
          gitDecorationTextClass(decoration),
        )}
      >
        {gitDecorationLabel(decoration, t)}
      </span>
    </button>
  );
}

function WorkspaceDirectory({
  workspaceId,
  active,
  path,
  depth,
  expanded,
  gitDecorations,
  onToggle,
  onSelect,
}: {
  workspaceId: string;
  active: boolean;
  path: string;
  depth: number;
  expanded: Set<string>;
  gitDecorations: Map<string, AgentWorkspaceGitDecoration>;
  onToggle: (path: string) => void;
  onSelect: (selection: AgentWorkspaceFileSelection) => void;
}) {
  const { t } = useTranslation();
  const isExpanded = expanded.has(path);
  const directory = useAgentWorkspaceDirectory(workspaceId, path, {
    enabled: active && isExpanded,
  });

  if (!isExpanded) return null;
  if (directory.isPending) {
    return (
      <div className="flex h-8 items-center gap-2 px-3 text-xs text-muted-foreground">
        <Loader2 className={cn("size-3.5", motionClasses.spinner)} />
        {t("agents.workspace.loadingFiles")}
      </div>
    );
  }
  if (directory.error) {
    return (
      <ErrorNotice
        className="mx-3 my-1"
        message={directory.error}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => void directory.refetch()}
          >
            {t("agents.common.retry")}
          </Button>
        }
      />
    );
  }

  return (
    <div>
      {directory.data?.entries.map((entry) => (
        <WorkspaceEntryRow
          key={entry.path}
          entry={entry}
          workspaceId={workspaceId}
          active={active}
          depth={depth}
          expanded={expanded}
          gitDecorations={gitDecorations}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
      {directory.data?.entries.length === 0 && depth === 0 && (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          {t("agents.workspace.empty")}
        </p>
      )}
      {directory.data?.truncated && (
        <p className="px-3 py-2 text-[11px] text-muted-foreground">
          {t("agents.workspace.truncatedEntries")}
        </p>
      )}
    </div>
  );
}

function WorkspaceEntryRow({
  entry,
  workspaceId,
  active,
  depth,
  expanded,
  gitDecorations,
  onToggle,
  onSelect,
}: {
  entry: AgentWorkspaceDirectoryEntry;
  workspaceId: string;
  active: boolean;
  depth: number;
  expanded: Set<string>;
  gitDecorations: Map<string, AgentWorkspaceGitDecoration>;
  onToggle: (path: string) => void;
  onSelect: (selection: AgentWorkspaceFileSelection) => void;
}) {
  const { t } = useTranslation();
  const directory = entry.kind === "directory" && !entry.symlink;
  const open = directory && expanded.has(entry.path);
  const disabled = entry.kind === "symlink" || entry.symlink;
  const decoration =
    gitDecorations.get(entry.path) ??
    (entry.ignored ? ignoredGitDecoration : undefined);
  const title = disabled
    ? t("agents.workspace.symlinkNotPreviewable", { path: entry.path })
    : gitDecoratedTitle(entry.path, decoration, t);

  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          directory
            ? onToggle(entry.path)
            : onSelect({
                path: entry.path,
                ...(decoration?.kind === "ignored" ? { gitIgnored: true } : {}),
              })
        }
        title={title}
        data-git-status={decoration?.kind}
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
            <FolderOpen
              className={cn(
                "size-3.5 shrink-0",
                gitDecorationTextClass(decoration) ?? "text-muted-foreground",
              )}
            />
          ) : (
            <Folder
              className={cn(
                "size-3.5 shrink-0",
                gitDecorationTextClass(decoration) ?? "text-muted-foreground",
              )}
            />
          )
        ) : (
          <File
            className={cn(
              "size-3.5 shrink-0",
              gitDecorationTextClass(decoration) ?? "text-muted-foreground",
            )}
          />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            gitDecorationTextClass(decoration),
          )}
        >
          {entry.name}
        </span>
        {!directory && decoration?.code && (
          <span
            aria-label={gitDecorationLabel(decoration, t)}
            className={cn(
              "shrink-0 text-[10px] font-semibold",
              gitDecorationTextClass(decoration),
            )}
          >
            {decoration.code}
          </span>
        )}
      </button>
      {open && (
        <WorkspaceDirectory
          workspaceId={workspaceId}
          active={active}
          path={entry.path}
          depth={depth + 1}
          expanded={expanded}
          gitDecorations={gitDecorations}
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
  active,
  selection,
  view,
  onView,
  changedFile,
  decoration,
  running,
}: {
  workspaceId: string;
  workspaceName: string;
  active: boolean;
  selection: AgentWorkspaceFileSelection;
  view: FileView;
  onView: (view: FileView) => void;
  /** The file's Git change, when it has uncommitted ones to show. */
  changedFile?: AgentWorkspaceGitFile;
  decoration?: AgentWorkspaceGitDecoration;
  running: boolean;
}) {
  const { t } = useTranslation();
  const showDiff = view === "diff";
  const file = useAgentWorkspaceFile(workspaceId, selection.path, {
    enabled: active && !showDiff,
    running,
  });
  const diff = useAgentWorkspaceFileDiff(
    workspaceId,
    selection.path,
    changedFile?.originalPath ?? null,
    { enabled: active && showDiff, running },
  );
  const shown = showDiff ? diff : file;
  const displayPath = file.data?.path ?? selection.path;
  const rendering = useMemo(
    () => workspaceFileRendering(displayPath),
    [displayPath],
  );
  const showSource = view === "source";
  // Annotated because the query's own result type does not narrow by kind.
  const loaded: AgentWorkspaceFilePreview | undefined = file.data;
  const image = loaded?.kind === "image" ? loaded : null;
  const text = loaded?.kind === "text" ? loaded : null;
  const rendered = !showDiff && rendering !== null && !showSource;
  const [wrapLines, setWrapLines] = useLocalStorage<boolean>(
    WRAP_LINES_KEY,
    false,
  );
  const content = text?.content;

  async function copy(
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs text-muted-foreground"
          title={gitDecoratedTitle(
            `${workspaceName}/${displayPath}`,
            decoration,
            t,
          )}
          aria-label={t("agents.workspace.filePathLabel", {
            path: `${workspaceName}/${displayPath}`,
          })}
          data-git-status={decoration?.kind}
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
                    cn(
                      "font-medium text-foreground",
                      gitDecorationTextClass(decoration),
                    ),
                )}
              >
                {segment}
              </span>
              {index === parts.length - 1 && decoration?.code && (
                <span
                  aria-label={gitDecorationLabel(decoration, t)}
                  className={cn(
                    "shrink-0 text-[10px] font-semibold",
                    gitDecorationTextClass(decoration),
                  )}
                >
                  {decoration.code}
                </span>
              )}
            </span>
          ))}
        </div>
        {changedFile && decoration?.kind !== "deleted" && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("agents.workspace.showChanges")}
            title={t("agents.workspace.showChanges")}
            aria-pressed={showDiff}
            className="aria-pressed:bg-accent aria-pressed:text-foreground aria-pressed:hover:bg-accent"
            onClick={() => onView(showDiff ? "preview" : "diff")}
          >
            <FileDiff />
          </Button>
        )}
        {rendering && !showDiff && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={
              showSource
                ? t("agents.workspace.showPreview")
                : t("agents.workspace.showSource")
            }
            title={
              showSource
                ? t("agents.workspace.showPreview")
                : t("agents.workspace.showSource")
            }
            aria-pressed={showSource}
            onClick={() => onView(showSource ? "preview" : "source")}
          >
            {showSource ? <Eye /> : <Code />}
          </Button>
        )}
        {!rendered && !image && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("agents.workspace.wrapLongLines")}
            title={t("agents.workspace.wrapLongLines")}
            aria-pressed={wrapLines}
            className="aria-pressed:bg-accent aria-pressed:text-foreground aria-pressed:hover:bg-accent"
            onClick={() => setWrapLines(!wrapLines)}
          >
            <WrapText />
          </Button>
        )}
        <Menu.Root>
          <Menu.Trigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("agents.common.copy")}
                title={t("agents.common.copy")}
              />
            }
          >
            <Copy />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={6}>
              <Menu.Popup
                className={cn(
                  "z-50 w-40 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
                  motionClasses.popup,
                )}
              >
                <Menu.Item
                  onClick={() =>
                    void copy(
                      displayPath,
                      t("agents.workspace.filePathCopied"),
                      t("agents.workspace.filePathCopyFailed"),
                    )
                  }
                  className="flex min-h-9 cursor-pointer items-center rounded-md px-2.5 outline-none motion-colors data-[highlighted]:bg-accent"
                >
                  {t("agents.workspace.copyPath")}
                </Menu.Item>
                <Menu.Item
                  disabled={content === undefined}
                  onClick={() => {
                    if (content !== undefined) {
                      void copy(
                        content,
                        t("agents.workspace.fileContentsCopied"),
                        t("agents.workspace.fileContentsCopyFailed"),
                      );
                    }
                  }}
                  className="flex min-h-9 cursor-pointer items-center rounded-md px-2.5 outline-none motion-colors data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
                >
                  {t("agents.workspace.copyContents")}
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("agents.workspace.refreshFile")}
          title={t("agents.workspace.refreshFile")}
          disabled={shown.isFetching}
          onClick={() => void shown.refetch()}
        >
          <RefreshCw className={shown.isFetching ? motionClasses.spinner : undefined} />
        </Button>
      </div>
      {showDiff ? (
        diff.isPending ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className={cn("size-4", motionClasses.spinner)} />
            {t("agents.workspace.loadingChanges")}
          </div>
        ) : diff.error ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <ErrorNotice
              className="max-w-xs"
              title={t("agents.workspace.changesUnavailable")}
              message={diff.error}
              actions={
                decoration?.kind !== "deleted" && (
                  <Button size="sm" variant="outline" onClick={() => onView("preview")}>
                    {t("agents.activity.openFile")}
                  </Button>
                )
              }
            />
          </div>
        ) : diff.data ? (
          <WorkspaceFileDiff diff={diff.data} wrap={wrapLines} />
        ) : null
      ) : file.isPending ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className={cn("size-4", motionClasses.spinner)} />
          {t("agents.workspace.loadingFile")}
        </div>
      ) : file.error ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <ErrorNotice
            className="max-w-xs"
            title={t("agents.workspace.fileNotPreviewable")}
            message={file.error}
          />
        </div>
      ) : image ? (
        <AgentWorkspaceImage
          path={image.path}
          source={`data:${image.mediaType};base64,${image.content}`}
        />
      ) : text && rendering && rendered ? (
        <AgentWorkspaceRenderedFile
          workspaceId={workspaceId}
          path={text.path}
          content={text.content}
          rendering={rendering}
        />
      ) : text ? (
        <HighlightedFile
          file={text}
          lineStart={selection.lineStart}
          lineEnd={selection.lineEnd}
          wrap={wrapLines}
        />
      ) : null}
    </div>
  );
}

function WorkspaceFileDiff({
  diff,
  wrap,
}: {
  diff: { patch: string; truncated: boolean; binary: boolean };
  wrap: boolean;
}) {
  const { t } = useTranslation();
  // One file's patch: the lines before its first hunk only repeat its name.
  const firstHunk = diff.patch.startsWith("@@")
    ? 0
    : diff.patch.indexOf("\n@@") + 1;
  const hunks =
    firstHunk > 0 || diff.patch.startsWith("@@")
      ? diff.patch.slice(firstHunk).replace(/\n$/u, "")
      : "";

  if (!hunks) {
    return (
      <p className="p-6 text-center text-xs text-muted-foreground">
        {diff.binary
          ? t("agents.workspace.binaryDiff")
          : diff.patch
            ? t("agents.workspace.modeOrRenameDiff")
            : t("agents.workspace.noUncommittedChanges")}
      </p>
    );
  }
  return (
    <div
      className="min-h-0 flex-1 overflow-auto bg-muted/10"
      data-testid="agent-workspace-diff"
    >
      <pre className="py-3 font-mono text-xs leading-5 text-foreground tab-size-4">
        <AgentDiffLines value={hunks} wrap={wrap} />
      </pre>
      {diff.truncated && (
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          {t("agents.workspace.diffTruncated")}
        </p>
      )}
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
  wrap,
}: {
  file: AgentWorkspaceTextFilePreview;
  lineStart?: number;
  lineEnd?: number;
  wrap: boolean;
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
      <pre
        className={cn(
          "py-3 font-mono text-xs leading-5 text-foreground tab-size-4",
          !wrap && "min-w-max",
        )}
      >
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
                <span
                  className={
                    wrap
                      ? "min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]"
                      : "whitespace-pre"
                  }
                >
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
