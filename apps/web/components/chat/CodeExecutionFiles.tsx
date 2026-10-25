"use client";

import { createContext, useContext, type ReactNode } from "react";
import { isPreviewableImage, type CodeExecutionFile } from "@overtchat/shared";
import { Download } from "lucide-react";
import { serverUrl } from "@/lib/api-url";
import { formatSize, humanMediaLabel } from "@/lib/chat/attachments";
import { filePreview } from "@/lib/chat/file-preview";
import { cn } from "@/lib/utils";
import { MediaIcon } from "./attachment-icons";
import { useFilePanel } from "./FilePanelContext";

const CodeFilesContext = createContext<ReadonlyMap<string, CodeExecutionFile>>(new Map());

/** Files the conversation's runs returned, by lower-cased name. */
export const CodeFilesProvider = CodeFilesContext.Provider;

/** Opens the file in the side panel when one is hosted and can show it. */
function usePanelOpener(file: CodeExecutionFile): (() => void) | null {
  const panel = useFilePanel();
  return panel && filePreview(file) ? () => panel.open(file) : null;
}

function useActive(file: CodeExecutionFile): boolean {
  return useFilePanel()?.activeFileId === file.id;
}

/**
 * Opens a file in the side panel, or without a panel opens it in a new tab
 * (`download` false) or downloads it.
 */
function FileTrigger({
  file,
  download,
  className,
  children,
  ...props
}: {
  file: CodeExecutionFile;
  download: boolean;
  className?: string;
  children: ReactNode;
  title?: string;
  "aria-label"?: string;
  "data-code-run-file"?: string;
}) {
  const open = usePanelOpener(file);
  const active = useActive(file);
  if (open) {
    return (
      <button
        type="button"
        onClick={open}
        aria-pressed={active}
        className={cn(className, "text-left")}
        {...props}
      >
        {children}
      </button>
    );
  }
  return (
    <a
      href={serverUrl(file.url)}
      {...(download
        ? { download: file.name }
        : { target: "_blank", rel: "noopener noreferrer" })}
      className={className}
      {...props}
    >
      {children}
    </a>
  );
}

/**
 * A reply's link to a file a run returned. Embedded links show an image in
 * full or a file card; others stay links. A name no run returned keeps only
 * the link text, since the target would not open.
 */
export function CodeFileLink({
  filename,
  embed,
  children,
}: {
  filename?: string;
  embed?: string;
  children?: ReactNode;
}) {
  const file = useContext(CodeFilesContext).get(filename?.toLowerCase() ?? "");
  if (!file) return <>{children}</>;
  if (!embed) return <InlineFileLink file={file}>{children}</InlineFileLink>;
  return isPreviewableImage(file) ? <CodeFileImage file={file} /> : <CodeFileCard file={file} />;
}

function InlineFileLink({ file, children }: { file: CodeExecutionFile; children: ReactNode }) {
  const open = usePanelOpener(file);
  return (
    <a
      href={serverUrl(file.url)}
      download={file.name}
      onClick={
        open
          ? (event) => {
              event.preventDefault();
              open();
            }
          : undefined
      }
      className="wrap-anywhere font-medium text-primary underline"
    >
      {children}
    </a>
  );
}

// Embedded files render inside paragraphs, so they use phrasing elements only.

function CodeFileImage({ file }: { file: CodeExecutionFile }) {
  const active = useActive(file);
  return (
    <span
      className={cn(
        "my-1 block w-full max-w-lg overflow-hidden rounded-xl border bg-card",
        active && "ring-2 ring-ring",
      )}
      data-code-file-image=""
    >
      <FileTrigger file={file} download={false} aria-label={`Open ${file.name}`} className="block w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={serverUrl(file.url)}
          alt={file.name}
          className="max-h-[32rem] w-full object-contain"
        />
      </FileTrigger>
      <span className="flex items-center gap-2 py-1.5 pr-1.5 pl-3 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <a
          href={serverUrl(file.url)}
          download={file.name}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 no-underline hover:bg-accent hover:text-foreground"
        >
          <Download className="size-3.5" /> Download
        </a>
      </span>
    </span>
  );
}

function CodeFileCard({ file }: { file: CodeExecutionFile }) {
  const open = usePanelOpener(file);
  const active = useActive(file);
  const details = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <MediaIcon mediaType={file.mediaType} filename={file.name} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{file.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {humanMediaLabel(file.mediaType)} · {formatSize(file.size)}
        </span>
      </span>
    </>
  );
  const frame = "my-1 flex w-full max-w-md items-center rounded-xl border bg-card no-underline motion-colors";
  if (!open) {
    return (
      <a
        href={serverUrl(file.url)}
        download={file.name}
        data-code-file-card=""
        className={cn(frame, "group gap-3 px-3 py-2.5 hover:bg-muted/60")}
      >
        {details}
        <Download
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
        />
      </a>
    );
  }
  // Opening the preview and downloading are separate controls.
  return (
    <span data-code-file-card="" className={cn(frame, "overflow-hidden", active && "ring-2 ring-ring")}>
      <button
        type="button"
        onClick={open}
        aria-pressed={active}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left motion-colors hover:bg-muted/60"
      >
        {details}
      </button>
      <a
        href={serverUrl(file.url)}
        download={file.name}
        aria-label={`Download ${file.name}`}
        title={`Download ${file.name}`}
        className="flex shrink-0 items-center self-stretch px-3 text-muted-foreground motion-colors hover:bg-muted/60 hover:text-foreground"
      >
        <Download aria-hidden className="size-4" />
      </a>
    </span>
  );
}

/** Every file one run returned, small, inside the run's activity step. */
export function CodeRunFiles({ files }: { files: CodeExecutionFile[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-code-run-files="">
      {files.map((file) => (
        <RunFile key={file.id} file={file} />
      ))}
    </div>
  );
}

function RunFile({ file }: { file: CodeExecutionFile }) {
  const active = useActive(file);
  if (isPreviewableImage(file)) {
    return (
      <FileTrigger
        file={file}
        download={false}
        title={file.name}
        aria-label={`Open ${file.name}`}
        data-code-run-file=""
        className={cn(
          "block overflow-hidden rounded-md border bg-muted motion-colors hover:border-foreground/30",
          active && "ring-2 ring-ring",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={serverUrl(file.url)} alt={file.name} loading="lazy" className="size-14 object-cover" />
      </FileTrigger>
    );
  }
  return (
    <FileTrigger
      file={file}
      download
      title={`${file.name} · ${formatSize(file.size)}`}
      data-code-run-file=""
      className={cn(
        "flex h-8 max-w-56 items-center gap-1.5 rounded-md border bg-background/40 px-2 text-foreground motion-colors hover:bg-accent/60",
        active && "ring-2 ring-ring",
      )}
    >
      <MediaIcon
        mediaType={file.mediaType}
        filename={file.name}
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 truncate">{file.name}</span>
    </FileTrigger>
  );
}
