"use client";

import { isPreviewableImage, type CodeExecutionFile } from "@overtchat/shared";
import { Download } from "lucide-react";
import { serverUrl } from "@/lib/api-url";
import { formatSize, humanMediaLabel } from "@/lib/chat/attachments";
import { MediaIcon } from "./attachment-icons";

/** Files code runs returned: images display inline, other files download. */
export function CodeExecutionFiles({ files }: { files: CodeExecutionFile[] }) {
  const images = files.filter(isPreviewableImage);
  const others = files.filter((file) => !isPreviewableImage(file));
  return (
    <div className="w-full max-w-lg space-y-3" data-code-files="">
      {images.map((file) => (
        <figure key={file.id} className="overflow-hidden rounded-xl border bg-card">
          <a
            href={serverUrl(file.url)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${file.name}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={serverUrl(file.url)}
              alt={file.name}
              className="max-h-[32rem] w-full object-contain"
            />
          </a>
          <figcaption className="flex items-center gap-2 py-1.5 pr-1.5 pl-3 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <a
              href={serverUrl(file.url)}
              download={file.name}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground"
            >
              <Download className="size-3.5" /> Download
            </a>
          </figcaption>
        </figure>
      ))}
      {others.map((file) => (
        <a
          key={file.id}
          href={serverUrl(file.url)}
          download={file.name}
          data-code-file=""
          className="group flex w-full max-w-md items-center gap-3 rounded-xl border bg-card px-3 py-2.5 motion-colors hover:bg-muted/60"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <MediaIcon mediaType={file.mediaType} filename={file.name} className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {file.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {humanMediaLabel(file.mediaType)} · {formatSize(file.size)}
            </span>
          </span>
          <Download
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
          />
        </a>
      ))}
    </div>
  );
}
