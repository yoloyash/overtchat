"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { FileUIPart } from "ai";
import {
  AlertCircle,
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
  formatSize,
  getDataTransferFiles,
} from "@/lib/chat/attachments";
import { dictationErrorMessage } from "@/lib/chat/message";
import { motionClasses } from "@/lib/motion";
import { useDictation } from "@/lib/useDictation";
import { CategoryIcon } from "./attachment-icons";
import {
  type ChatAttachment,
  useChatAttachments,
} from "./useChatAttachments";

export interface ComposerHandle {
  addFiles: (files: readonly File[]) => void;
  focus: (options?: FocusOptions) => void;
}

interface ComposerProps {
  configured: boolean;
  streaming: boolean;
  searchEnabled: boolean;
  dropActive: boolean;
  onToggleSearch: () => void;
  onSubmit: (input: string, attachments: FileUIPart[]) => void;
  onStop: () => void;
  isAdmin: boolean;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({
  configured,
  streaming,
  searchEnabled,
  dropActive,
  onToggleSearch,
  onSubmit,
  onStop,
  isAdmin,
}, ref) {
  const [input, setInput] = useState("");
  const {
    attachments,
    uploading,
    readyParts,
    addFiles,
    removeAttachment,
    clearAttachments,
  } = useChatAttachments();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      addFiles(files) {
        addFiles(files);
        setTimeout(
          () => textareaRef.current?.focus({ preventScroll: true }),
          0,
        );
      },
      focus(options) {
        textareaRef.current?.focus(options);
      },
    }),
    [addFiles],
  );

  const dictation = useDictation((text) => {
    setInput((prev) => {
      const trimmed = prev.trimEnd();
      if (!trimmed) return text;
      return `${trimmed} ${text}`;
    });
    setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 0);
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
    if (!text && readyParts.length === 0) return;
    if (!configured) return;
    onSubmit(text, readyParts);
    setInput("");
    clearAttachments();
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    addFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = getDataTransferFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  }

  return (
    <>
      {dictation.error && (
        <p className="mb-2 text-sm text-destructive">
          {dictationErrorMessage(dictation.error, isAdmin)}
        </p>
      )}
      <div
        className={cn(
          "flex flex-col gap-2 rounded-3xl border bg-background px-3.5 pt-3.5 pb-2.5 shadow-sm motion-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring",
          dropActive && "border-ring bg-accent/20 ring-2 ring-ring/30",
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pt-1">
            {attachments.map((att) => (
              <AttachmentChip
                key={att.id}
                attachment={att}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
          </div>
        )}
        <Textarea
          ref={textareaRef}
          rows={1}
          placeholder={
            configured ? "Message…" : "No models configured"
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
                <Loader2 className={motionClasses.spinner} />
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
                  uploading ||
                  (!input.trim() &&
                    readyParts.length === 0)
                }
                onClick={submit}
                aria-label="Send message"
              >
                {uploading ? <Loader2 className={motionClasses.spinner} /> : <ArrowUp />}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
});

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove: () => void;
}) {
  const { status, meta, part } = attachment;
  const label = attachment.filename;
  const isImage =
    meta?.category === "image" ||
    Boolean(attachment.previewUrl) ||
    attachment.mediaType.startsWith("image/");
  const removeButton = (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${label}`}
      className="absolute top-0.5 right-0.5 rounded-full bg-foreground/70 p-0.5 text-background shadow-sm motion-colors hover:bg-foreground max-md:p-1"
    >
      <X className="size-3" />
    </button>
  );

  // Images render as a thumbnail while uploading/ready. On failure we fall back
  // to the row chip below so the actual error reason has room to show.
  if (isImage && status !== "error") {
    const src = attachment.previewUrl ?? part?.url;
    return (
      <div className="group/chip relative h-16 w-16 overflow-hidden rounded-lg border bg-muted">
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} className="size-full object-cover" />
        )}
        {status === "uploading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50">
            <Loader2 className={`size-4 text-foreground ${motionClasses.spinner}`} />
          </div>
        )}
        {removeButton}
      </div>
    );
  }

  const sub =
    status === "error"
      ? (attachment.error ?? "Upload failed")
      : [
          meta?.pageCount ? `${meta.pageCount} pages` : null,
          meta?.size != null ? formatSize(meta.size) : null,
          meta?.truncated ? "truncated" : null,
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <div
      className={cn(
        "group/chip relative flex items-center gap-2 rounded-lg border bg-muted/40 py-2 pr-8 pl-2 max-w-[18rem]",
        status === "error" && "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        {status === "uploading" ? (
          <Loader2 className={`size-4 ${motionClasses.spinner}`} />
        ) : status === "error" ? (
          <AlertCircle className="size-4 text-destructive" />
        ) : (
          <CategoryIcon category={meta?.category} className="size-4" />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium">{label}</div>
        {sub && (
          <div
            className={cn(
              "truncate text-[11px] text-muted-foreground",
              status === "error" && "text-destructive",
            )}
            title={status === "error" ? sub : undefined}
          >
            {sub}
          </div>
        )}
      </div>
      {removeButton}
    </div>
  );
}
