"use client";

import { useEffect, useRef, useState } from "react";
import type { FileUIPart } from "ai";
import {
  ArrowUp,
  Globe,
  Loader2,
  Mic,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ATTACH_ACCEPT,
  type AttachmentCategory,
  type AttachmentMeta,
  formatSize,
} from "@/lib/chat/attachments";
import { dictationErrorMessage } from "@/lib/chat/message";
import { useDictation } from "@/lib/useDictation";
import { CategoryIcon } from "./attachment-icons";

export function Composer({
  configured,
  streaming,
  searchEnabled,
  onToggleSearch,
  onSubmit,
  onStop,
  isAdmin,
}: {
  configured: boolean;
  streaming: boolean;
  searchEnabled: boolean;
  onToggleSearch: () => void;
  onSubmit: (input: string, attachments: FileUIPart[]) => void;
  onStop: () => void;
  isAdmin: boolean;
}) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FileUIPart[]>([]);
  const [attachmentMeta, setAttachmentMeta] = useState<
    Record<string, AttachmentMeta>
  >({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dictation = useDictation((text) => {
    setInput((prev) => {
      const trimmed = prev.trimEnd();
      if (!trimmed) return text;
      return `${trimmed} ${text}`;
    });
    setTimeout(() => textareaRef.current?.focus(), 0);
  });

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  function submit() {
    const text = input.trim();
    if (streaming || uploading) return;
    if (!text && attachments.length === 0) return;
    if (!configured) return;
    onSubmit(text, attachments);
    setInput("");
    setAttachments([]);
    setAttachmentMeta({});
    setUploadError(null);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      const uploaded: FileUIPart[] = [];
      const nextMeta: Record<string, AttachmentMeta> = {};
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/uploads", { method: "POST", body: form });
        const json = (await res.json().catch(() => ({}))) as {
          url?: string;
          mediaType?: string;
          filename?: string;
          category?: AttachmentCategory;
          size?: number;
          pageCount?: number | null;
          truncated?: boolean;
          error?: string;
        };
        if (!res.ok || !json.url || !json.mediaType) {
          throw new Error(json.error ?? `Upload failed (${res.status})`);
        }
        uploaded.push({
          type: "file",
          url: json.url,
          mediaType: json.mediaType,
          filename: json.filename,
        });
        nextMeta[json.url] = {
          category: json.category,
          size: json.size,
          pageCount: json.pageCount,
          truncated: json.truncated,
        };
      }
      setAttachments((prev) => [...prev, ...uploaded]);
      setAttachmentMeta((prev) => ({ ...prev, ...nextMeta }));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0) return;
    e.preventDefault();
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    void handleFiles(dt.files);
  }

  return (
    <>
      {uploadError && (
        <p className="mb-2 text-sm text-destructive">{uploadError}</p>
      )}
      {dictation.error && (
        <p className="mb-2 text-sm text-destructive">
          {dictationErrorMessage(dictation.error, isAdmin)}
        </p>
      )}
      <div className="flex flex-col gap-2 rounded-3xl border bg-background px-3.5 pt-3.5 pb-2.5 shadow-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pt-1">
            {attachments.map((att, i) => (
              <AttachmentChip
                key={`${att.url}-${i}`}
                attachment={att}
                meta={attachmentMeta[att.url]}
                onRemove={() => {
                  setAttachments((prev) =>
                    prev.filter((_, j) => j !== i),
                  );
                  setAttachmentMeta((prev) => {
                    const next = { ...prev };
                    delete next[att.url];
                    return next;
                  });
                }}
              />
            ))}
          </div>
        )}
        <Textarea
          ref={textareaRef}
          rows={1}
          placeholder={
            configured
              ? "Message…"
              : "No models available — ask an admin to add one"
          }
          className="max-h-48 min-h-10 resize-none border-0 bg-transparent px-1 py-0 shadow-none focus-visible:ring-0 md:text-sm dark:bg-transparent"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept={ATTACH_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label="Attach file"
            >
              <Paperclip />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 rounded-full px-3 max-md:h-10 max-md:px-4",
                searchEnabled &&
                  "bg-accent text-foreground hover:bg-accent",
              )}
              onClick={onToggleSearch}
              aria-label={
                searchEnabled ? "Disable web search" : "Enable web search"
              }
              aria-pressed={searchEnabled}
            >
              <Globe />
              <span className="text-xs">Search</span>
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                "rounded-full",
                dictation.status === "recording" &&
                  "bg-destructive text-destructive-foreground hover:bg-destructive hover:text-destructive-foreground",
              )}
              onClick={() => {
                if (dictation.status === "recording") {
                  dictation.stop();
                } else if (dictation.status === "idle") {
                  void dictation.start();
                }
              }}
              disabled={dictation.status === "transcribing"}
              aria-label={
                dictation.status === "recording"
                  ? "Stop dictation"
                  : dictation.status === "transcribing"
                    ? "Transcribing"
                    : "Dictate"
              }
              aria-pressed={dictation.status === "recording"}
            >
              {dictation.status === "transcribing" ? (
                <Loader2 className="animate-spin" />
              ) : dictation.status === "recording" ? (
                <Square className="size-3 fill-current" />
              ) : (
                <Mic />
              )}
            </Button>
            {streaming ? (
              <Button
                size="icon-sm"
                variant="secondary"
                className="shrink-0 rounded-full"
                onClick={onStop}
                aria-label="Stop generating"
              >
                <Square className="size-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                className="shrink-0 rounded-full"
                disabled={
                  uploading || (!input.trim() && attachments.length === 0)
                }
                onClick={submit}
                aria-label="Send message"
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function AttachmentChip({
  attachment,
  meta,
  onRemove,
}: {
  attachment: FileUIPart;
  meta: AttachmentMeta | undefined;
  onRemove: () => void;
}) {
  const label = attachment.filename ?? "file";
  const isImage =
    meta?.category === "image" ||
    (!meta && attachment.mediaType?.startsWith("image/"));
  if (isImage) {
    return (
      <div className="group/chip relative h-16 w-16 overflow-hidden rounded-lg border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachment.url}
          alt={label}
          className="size-full object-cover"
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 text-foreground opacity-0 transition-opacity group-hover/chip:opacity-100 hover:bg-background max-md:p-1.5 [@media(hover:none)]:opacity-100"
        >
          <X className="size-3" />
        </button>
      </div>
    );
  }
  const sub = [
    meta?.pageCount ? `${meta.pageCount} pages` : null,
    meta?.size != null ? formatSize(meta.size) : null,
    meta?.truncated ? "truncated" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="group/chip relative flex items-center gap-2 rounded-lg border bg-muted/40 py-2 pr-8 pl-2 max-w-[18rem]">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        <CategoryIcon category={meta?.category} className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium">{label}</div>
        {sub && (
          <div className="truncate text-[11px] text-muted-foreground">
            {sub}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="absolute top-1 right-1 rounded-full bg-background/80 p-0.5 text-foreground opacity-0 transition-opacity group-hover/chip:opacity-100 hover:bg-background max-md:p-1.5 [@media(hover:none)]:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
