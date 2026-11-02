"use client";

import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPES,
  isDocumentOutput,
  type DocumentToolPart,
  type DocumentType,
} from "@overtchat/shared";
import {
  ChevronRight,
  CircleAlert,
  Code2,
  FileText,
  Globe,
  ImageIcon,
  Loader2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motionClasses } from "@/lib/motion";
import { useDocumentPanel } from "./DocumentPanelContext";

export const DOCUMENT_ICONS: Record<DocumentType, LucideIcon> = {
  markdown: FileText,
  code: Code2,
  html: Globe,
  svg: ImageIcon,
  mermaid: Workflow,
};

/** A document version produced by one tool call, opening it in the panel. */
export function DocumentCard({
  part,
  streaming,
}: {
  part: DocumentToolPart;
  streaming: boolean;
}) {
  const panel = useDocumentPanel();
  const output = isDocumentOutput(part.output) ? part.output : undefined;
  const creating = part.type === "tool-create_document";
  const pending =
    part.state === "input-streaming" || part.state === "input-available";
  const inputType = (DOCUMENT_TYPES as readonly unknown[]).includes(
    part.input?.type,
  )
    ? (part.input!.type as DocumentType)
    : undefined;
  const type = output?.type ?? inputType ?? "markdown";
  const title =
    output?.title ??
    part.input?.title?.trim() ??
    (creating ? undefined : part.input?.id?.trim()) ??
    "Untitled document";

  if (part.state === "output-error") {
    return (
      <div
        className="flex max-w-md items-start gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          {creating ? "Could not create" : "Could not update"} {title}
          {part.errorText ? (
            <span className="block text-xs">{firstLine(part.errorText)}</span>
          ) : null}
        </span>
      </div>
    );
  }

  const live = pending && streaming;
  const status = pending
    ? live
      ? creating
        ? "Writing…"
        : "Updating…"
      : creating
        ? "Stopped before it was saved"
        : "Update stopped"
    : `${DOCUMENT_TYPE_LABELS[type]} · ${creating ? "Created" : "Updated"} · Version ${output?.version ?? 1}`;
  const openable = Boolean(panel && (output || (live && creating)));
  const active = panel?.activeToolCallId === part.toolCallId;
  const Icon = DOCUMENT_ICONS[type];

  return (
    <button
      type="button"
      data-document-card=""
      disabled={!openable}
      aria-pressed={active}
      onClick={() => panel?.open(part.toolCallId)}
      className={cn(
        "group flex w-full max-w-md items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left motion-colors",
        openable && "hover:bg-muted/60",
        active && "border-ring/60 bg-muted/60",
        !openable && "cursor-default",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {live ? (
          <Loader2 className={cn("size-4", motionClasses.spinner)} />
        ) : (
          <Icon className="size-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {status}
        </span>
      </span>
      {openable && (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground motion-transform group-hover:translate-x-0.5" />
      )}
    </button>
  );
}

function firstLine(text: string): string {
  const line = text.split("\n", 1)[0];
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}
