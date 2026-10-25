"use client";

import { useEffect, useMemo, useState } from "react";
import { CodeBlock, Streamdown } from "streamdown";
import { Code, Download, Eye, Loader2, X } from "lucide-react";
import type { CodeExecutionFile } from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { serverUrl } from "@/lib/api-url";
import { formatSize, humanMediaLabel } from "@/lib/chat/attachments";
import { htmlPreviewDocument } from "@/lib/chat/code-preview";
import {
  filePreview,
  MAX_TABLE_ROWS,
  MAX_TEXT_PREVIEW_BYTES,
  parseDelimited,
  type FilePreview,
} from "@/lib/chat/file-preview";
import { MESSAGE_MARKDOWN_PLUGINS } from "@/lib/chat/markdown";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { MediaIcon } from "./attachment-icons";
import { SidePanel } from "./SidePanel";

type TextPreview = Extract<FilePreview, { kind: "table" | "markdown" | "html" | "text" }>;

/** A file a code run returned, previewed beside the chat. */
export function FilePanel({
  file,
  variant = "docked",
  onClose,
}: {
  file: CodeExecutionFile;
  variant?: "docked" | "overlay";
  onClose: () => void;
}) {
  const preview = filePreview(file);
  const [showSource, setShowSource] = useState(false);
  const rendered =
    preview?.kind === "table" || preview?.kind === "markdown" || preview?.kind === "html";
  return (
    <SidePanel
      aria-label={`File: ${file.name}`}
      data-file-panel=""
      variant={variant}
      onClose={onClose}
    >
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <MediaIcon mediaType={file.mediaType} filename={file.name} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{file.name}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {humanMediaLabel(file.mediaType)} · {formatSize(file.size)}
          </p>
        </div>
        {rendered && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={showSource ? "Show preview" : "Show source"}
            title={showSource ? "Show preview" : "Show source"}
            aria-pressed={showSource}
            onClick={() => setShowSource((value) => !value)}
          >
            {showSource ? <Eye /> : <Code />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Download file"
          title={`Download ${file.name}`}
          render={<a href={serverUrl(file.url)} download={file.name} />}
        >
          <Download />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close file"
          title="Close file"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto" data-file-body="">
        {preview ? (
          <FileBody key={`${file.id}:${showSource}`} file={file} preview={preview} source={showSource} />
        ) : (
          <Notice>There is no preview for this file type.</Notice>
        )}
      </div>
    </SidePanel>
  );
}

function FileBody({
  file,
  preview,
  source,
}: {
  file: CodeExecutionFile;
  preview: FilePreview;
  source: boolean;
}) {
  const url = serverUrl(file.url);
  switch (preview.kind) {
    case "image":
      return (
        <div className="flex size-full items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={file.name} className="max-h-full max-w-full object-contain" />
        </div>
      );
    case "pdf":
      return <iframe src={url} title={file.name} className="block size-full border-0" />;
    case "audio":
      return (
        <div className="p-6">
          <audio controls src={url} className="w-full" />
        </div>
      );
    case "video":
      return (
        <div className="flex size-full items-center justify-center bg-black">
          <video controls src={url} className="max-h-full max-w-full" />
        </div>
      );
    default:
      return file.size > MAX_TEXT_PREVIEW_BYTES ? (
        <Notice>This file is too large to preview. Download it to open it.</Notice>
      ) : (
        <TextFile file={file} preview={preview} source={source} />
      );
  }
}

function TextFile({
  file,
  preview,
  source,
}: {
  file: CodeExecutionFile;
  preview: TextPreview;
  source: boolean;
}) {
  const [loaded, setLoaded] = useState<{ text?: string; failed?: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(serverUrl(file.url), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Loading failed (${response.status})`);
        return response.text();
      })
      .then((text) => setLoaded({ text }))
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ failed: true });
      });
    return () => controller.abort();
  }, [file.url]);

  if (loaded?.failed) return <Notice>This file could not be loaded.</Notice>;
  if (loaded?.text === undefined) {
    return (
      <div className="flex justify-center p-6 text-muted-foreground" role="status" aria-label="Loading file">
        <Loader2 className={cn("size-4", motionClasses.spinner)} />
      </div>
    );
  }
  const text = loaded.text;
  if (source || preview.kind === "text") {
    return (
      <div className="[&_[data-streamdown=code-block-header]]:hidden">
        <CodeBlock
          code={text}
          language={preview.kind === "text" ? preview.language : preview.kind === "table" ? "text" : preview.kind}
          className="my-0 min-h-full rounded-none border-0"
        />
      </div>
    );
  }
  switch (preview.kind) {
    case "table":
      return <Table text={text} delimiter={preview.delimiter} />;
    case "markdown":
      return (
        <div className="mx-auto max-w-3xl px-6 py-5">
          <Streamdown
            className="font-sans space-y-3 text-[15px] leading-relaxed"
            plugins={MESSAGE_MARKDOWN_PLUGINS}
            mode="static"
          >
            {text}
          </Streamdown>
        </div>
      );
    case "html":
      return (
        <iframe
          title={`${file.name} preview`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={htmlPreviewDocument(text)}
          className="block size-full min-h-[24rem] border-0 bg-white"
        />
      );
  }
}

function Table({ text, delimiter }: { text: string; delimiter: string }) {
  const rows = useMemo(() => parseDelimited(text, delimiter), [text, delimiter]);
  if (!rows.length) return <Notice>This file is empty.</Notice>;
  const [header, ...body] = rows;
  const shown = body.slice(0, MAX_TABLE_ROWS);
  const columns = Math.max(header.length, ...shown.map((row) => row.length));
  return (
    <div>
      <table className="w-full border-collapse text-xs" data-file-table="">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {Array.from({ length: columns }, (_, column) => (
              <th key={column} className="border-b px-3 py-2 text-left font-medium whitespace-nowrap">
                {header[column] ?? ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <tr key={index} className="border-b">
              {Array.from({ length: columns }, (_, column) => (
                <td key={column} className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                  {row[column] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > shown.length && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Showing the first {MAX_TABLE_ROWS.toLocaleString()} of {body.length.toLocaleString()} rows.
        </p>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-sm text-muted-foreground">{children}</p>;
}
