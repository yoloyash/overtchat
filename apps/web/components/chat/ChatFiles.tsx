"use client";

import { useId, type ReactNode } from "react";
import { ArrowLeft, File, Files, X } from "lucide-react";
import {
  DOCUMENT_TYPE_LABELS,
  type ConversationFiles,
  type PanelFile,
} from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { formatSize, humanMediaLabel } from "@/lib/chat/attachments";
import { cn } from "@/lib/utils";
import { MediaIcon } from "./attachment-icons";
import { DOCUMENT_ICONS } from "./DocumentCard";
import { SidePanel, SidePanelHeader } from "./SidePanel";

function countLabel(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

/** Shows and hides the side panel with the conversation's files. */
export function ChatFilesButton({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("max-md:h-10", open && "bg-accent text-foreground hover:bg-accent")}
      aria-label={countLabel(count)}
      aria-expanded={open}
      title={open ? "Hide files" : "Show files"}
      onClick={onToggle}
    >
      <File className="size-4" />
      <span className="tabular-nums">{count}</span>
    </Button>
  );
}

/** Returns from a file or document to the panel's list of files. */
export function BackToFilesButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Back to files"
      title="Back to files"
      onClick={onClick}
    >
      <ArrowLeft />
    </Button>
  );
}

/** The conversation's outputs and uploads, newest first; each opens in the panel. */
export function ChatFilesPanel({
  files,
  onOpenFile,
  onOpenDocument,
  onClose,
}: {
  files: ConversationFiles;
  onOpenFile: (file: PanelFile) => void;
  onOpenDocument: (toolCallId: string) => void;
  onClose: () => void;
}) {
  const { outputs, uploads } = files;
  const count = outputs.length + uploads.length;
  return (
    <SidePanel aria-label="Files" data-files-panel="" variant="docked" onClose={onClose}>
      <SidePanelHeader>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Files className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">Files</h2>
          <p className="truncate text-xs text-muted-foreground">{countLabel(count)}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close files"
          title="Close files"
          onClick={onClose}
        >
          <X />
        </Button>
      </SidePanelHeader>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        {count === 0 && (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            Files you attach and files the assistant makes appear here.
          </p>
        )}
        {outputs.length > 0 && (
          <Group label="Outputs">
            {outputs.map((output) => {
              if (output.kind === "file") {
                return (
                  <FileItem
                    key={output.file.id}
                    file={output.file}
                    onOpen={() => onOpenFile(output.file)}
                  />
                );
              }
              const { document } = output;
              const Icon = DOCUMENT_ICONS[document.type];
              return (
                <Item
                  key={document.id}
                  icon={<Icon className="size-4" />}
                  name={document.title || "Untitled"}
                  label={DOCUMENT_TYPE_LABELS[document.type]}
                  onOpen={() => onOpenDocument(document.toolCallId)}
                />
              );
            })}
          </Group>
        )}
        {uploads.length > 0 && (
          <Group label="Uploads">
            {uploads.map((file) => (
              <FileItem key={file.id} file={file} onOpen={() => onOpenFile(file)} />
            ))}
          </Group>
        )}
      </div>
    </SidePanel>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <section>
      <h3 id={id} className="px-2 py-1 text-xs font-medium text-muted-foreground">
        {label}
      </h3>
      <ul aria-labelledby={id}>{children}</ul>
    </section>
  );
}

function FileItem({ file, onOpen }: { file: PanelFile; onOpen: () => void }) {
  return (
    <Item
      icon={<MediaIcon mediaType={file.mediaType} filename={file.name} className="size-4" />}
      name={file.name}
      label={
        file.size === undefined
          ? fileTypeLabel(file)
          : `${fileTypeLabel(file)} · ${formatSize(file.size)}`
      }
      onOpen={onOpen}
    />
  );
}

function Item({
  icon,
  name,
  label,
  onOpen,
}: {
  icon: ReactNode;
  name: string;
  label: string;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        title={name}
        className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm outline-none motion-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      </button>
    </li>
  );
}

/** A short type such as "PNG" or "CSV", from the extension when it has one. */
function fileTypeLabel(file: PanelFile): string {
  const extension = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1];
  return extension ? extension.toUpperCase() : humanMediaLabel(file.mediaType);
}
