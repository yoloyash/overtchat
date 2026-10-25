"use client";

import { createContext, useContext, type ReactNode } from "react";
import { isPreviewableImage, type CodeExecutionFile } from "@overtchat/shared";
import { Download } from "lucide-react";
import { serverUrl } from "@/lib/api-url";
import { formatSize, humanMediaLabel } from "@/lib/chat/attachments";
import { MediaIcon } from "./attachment-icons";

const CodeFilesContext = createContext<ReadonlyMap<string, CodeExecutionFile>>(new Map());

/** Files the conversation's runs returned, by lower-cased name. */
export const CodeFilesProvider = CodeFilesContext.Provider;

/**
 * A reply's link to a file a run returned. Embedded links show an image in
 * full or a download card; others stay links. A name no run returned keeps
 * only the link text, since the target would not open.
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
  if (!embed) {
    return (
      <a
        href={serverUrl(file.url)}
        download={file.name}
        className="wrap-anywhere font-medium text-primary underline"
      >
        {children}
      </a>
    );
  }
  return isPreviewableImage(file) ? <CodeFileImage file={file} /> : <CodeFileCard file={file} />;
}

// Embedded files render inside paragraphs, so they use phrasing elements only.

function CodeFileImage({ file }: { file: CodeExecutionFile }) {
  return (
    <span className="my-1 block w-full max-w-lg overflow-hidden rounded-xl border bg-card" data-code-file-image="">
      <a
        href={serverUrl(file.url)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${file.name}`}
        className="block"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={serverUrl(file.url)}
          alt={file.name}
          className="max-h-[32rem] w-full object-contain"
        />
      </a>
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
  return (
    <a
      href={serverUrl(file.url)}
      download={file.name}
      data-code-file-card=""
      className="group my-1 flex w-full max-w-md items-center gap-3 rounded-xl border bg-card px-3 py-2.5 no-underline motion-colors hover:bg-muted/60"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <MediaIcon mediaType={file.mediaType} filename={file.name} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{file.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {humanMediaLabel(file.mediaType)} · {formatSize(file.size)}
        </span>
      </span>
      <Download
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
      />
    </a>
  );
}

/** Every file one run returned, small, inside the run's activity step. */
export function CodeRunFiles({ files }: { files: CodeExecutionFile[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-code-run-files="">
      {files.map((file) =>
        isPreviewableImage(file) ? (
          <a
            key={file.id}
            href={serverUrl(file.url)}
            target="_blank"
            rel="noopener noreferrer"
            title={file.name}
            aria-label={`Open ${file.name}`}
            data-code-run-file=""
            className="block overflow-hidden rounded-md border bg-muted motion-colors hover:border-foreground/30"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={serverUrl(file.url)}
              alt={file.name}
              loading="lazy"
              className="size-14 object-cover"
            />
          </a>
        ) : (
          <a
            key={file.id}
            href={serverUrl(file.url)}
            download={file.name}
            title={`${file.name} · ${formatSize(file.size)}`}
            data-code-run-file=""
            className="flex h-8 max-w-56 items-center gap-1.5 rounded-md border bg-background/40 px-2 text-foreground motion-colors hover:bg-accent/60"
          >
            <MediaIcon
              mediaType={file.mediaType}
              filename={file.name}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 truncate">{file.name}</span>
          </a>
        ),
      )}
    </div>
  );
}
