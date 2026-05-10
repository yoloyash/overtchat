"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { cjk } from "@streamdown/cjk";
import {
  ArrowUp,
  Check,
  Copy,
  Globe,
  Paperclip,
  Pencil,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type ApiConfig } from "@/lib/config";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { ModelPicker } from "@/components/ModelPicker";
import {
  ToolCall,
  type FetchUrlPart,
  type WebSearchPart,
} from "@/components/ToolCall";

const SEARCH_STORAGE_KEY = "overtchat_search_enabled";

interface Props {
  config: ApiConfig;
  onConfigChange: (config: ApiConfig) => void;
  chatId?: string;
  initialMessages?: UIMessage[];
}

const PLUGINS = { code, math, cjk };

export function ChatArea({
  config,
  onConfigChange,
  chatId,
  initialMessages,
}: Props) {
  const router = useRouter();
  const configured = Boolean(config.baseUrl && config.model);

  const [searchEnabled, setSearchEnabled] = useLocalStorage<boolean>(
    SEARCH_STORAGE_KEY,
    false,
  );

  const chatIdRef = useRef<string | undefined>(chatId);

  const [transport] = useState(
    () => new DefaultChatTransport<UIMessage>({ api: "/api/chat" }),
  );

  const { messages, sendMessage, regenerate, status, stop, error } = useChat({
    transport,
    messages: initialMessages,
    onFinish: () => router.refresh(),
  });

  const requestBody = () => ({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    searchEnabled,
    chatId: chatIdRef.current,
  });

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FileUIPart[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickToBottomRef = useRef(true);

  const streaming = status === "streaming" || status === "submitted";

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

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
    if (!configured) {
      router.push("/settings");
      return;
    }
    if (!chatIdRef.current) {
      const id = crypto.randomUUID();
      chatIdRef.current = id;
      window.history.replaceState(null, "", `/chat/${id}`);
    }
    sendMessage({ text, files: attachments }, { body: requestBody() });
    setInput("");
    setAttachments([]);
    setUploadError(null);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      const uploaded: FileUIPart[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/uploads", { method: "POST", body: form });
        const json = (await res.json().catch(() => ({}))) as {
          url?: string;
          mediaType?: string;
          filename?: string;
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
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleRegenerate(messageId: string) {
    if (streaming || !configured) return;
    regenerate({ messageId, body: requestBody() });
  }

  function handleEdit(messageId: string, text: string) {
    if (streaming || !configured) return;
    sendMessage({ text, messageId }, { body: requestBody() });
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
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center border-b px-3">
        <ModelPicker
          config={config}
          onChange={onConfigChange}
        />
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain"
      >
        {messages.length === 0 ? (
          <EmptyState configured={configured} />
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pt-10 pb-8">
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                streaming={streaming && i === messages.length - 1}
                canAct={!streaming && configured}
                onRegenerate={handleRegenerate}
                onEdit={handleEdit}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pb-6">
        <div className="mx-auto max-w-3xl">
          {error && (
            <p className="mb-2 text-sm text-destructive">{error.message}</p>
          )}
          {uploadError && (
            <p className="mb-2 text-sm text-destructive">{uploadError}</p>
          )}
          <div className="flex flex-col gap-2 rounded-3xl border bg-background px-3 py-2.5 shadow-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-1 pt-1">
                {attachments.map((att, i) => (
                  <AttachmentChip
                    key={`${att.url}-${i}`}
                    attachment={att}
                    onRemove={() =>
                      setAttachments((prev) => prev.filter((_, j) => j !== i))
                    }
                  />
                ))}
              </div>
            )}
            <Textarea
              ref={textareaRef}
              rows={1}
              placeholder={configured ? "Message…" : "Configure an API endpoint to start chatting"}
              className="max-h-48 min-h-6 resize-none border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0 md:text-sm"
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
                  accept="image/png,image/jpeg,image/gif,image/webp"
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
                  aria-label="Attach image"
                >
                  <Paperclip />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 rounded-full px-3",
                    searchEnabled &&
                      "bg-accent text-foreground hover:bg-accent",
                  )}
                  onClick={() => setSearchEnabled(!searchEnabled)}
                  aria-label={searchEnabled ? "Disable web search" : "Enable web search"}
                  aria-pressed={searchEnabled}
                >
                  <Globe />
                  <span className="text-xs">Search</span>
                </Button>
              </div>
              {streaming ? (
                <Button
                  size="icon-sm"
                  variant="secondary"
                  className="shrink-0 rounded-full"
                  onClick={() => stop()}
                  aria-label="Stop generating"
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <Button
                  size="icon-sm"
                  className="shrink-0 rounded-full"
                  disabled={uploading || (!input.trim() && attachments.length === 0)}
                  onClick={submit}
                  aria-label="Send message"
                >
                  <ArrowUp />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ configured }: { configured: boolean }) {
  return (
    <div className="flex h-full min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Sparkles className="size-5" />
      </div>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        What can I help with?
      </h1>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        {configured
          ? "Ask a question or start a conversation."
          : "Point overtchat at any OpenAI-compatible endpoint to begin."}
      </p>
      {!configured && (
        <Button render={<Link href="/settings" />} variant="outline" className="mt-5">
          Configure endpoint
        </Button>
      )}
    </div>
  );
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function MessageBubble({
  message,
  streaming,
  canAct,
  onRegenerate,
  onEdit,
}: {
  message: UIMessage;
  streaming: boolean;
  canAct: boolean;
  onRegenerate: (id: string) => void;
  onEdit: (id: string, text: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (message.role === "user") {
    const text = textOf(message);
    const files = message.parts.filter(
      (p): p is Extract<typeof p, { type: "file" }> => p.type === "file",
    );
    if (editing) {
      return (
        <EditBubble
          initial={text}
          onCancel={() => setEditing(false)}
          onSave={(next) => {
            setEditing(false);
            if (next.trim() && next !== text) onEdit(message.id, next);
          }}
        />
      );
    }
    return (
      <div className="group flex flex-col items-end gap-1">
        {files.length > 0 && (
          <div className="flex max-w-[80%] flex-wrap justify-end gap-2">
            {files.map((part, i) => (
              <MessageImage key={i} part={part} />
            ))}
          </div>
        )}
        {text && (
        <div className="max-w-[80%] rounded-2xl bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap text-secondary-foreground">
          {text}
        </div>
        )}
        <MessageActions show={canAct}>
          <CopyButton text={text} />
          <ActionButton
            label="Edit"
            onClick={() => setEditing(true)}
            icon={<Pencil className="size-3.5" />}
          />
        </MessageActions>
      </div>
    );
  }

  const text = textOf(message);
  return (
    <div className="group flex flex-col items-start gap-2">
      <div className="w-full max-w-full space-y-3 text-sm leading-relaxed">
        {message.parts.map((part, i) => {
          if (part.type === "reasoning") {
            return (
              <ThinkingBlock
                key={i}
                content={part.text}
                open={streaming && part.state !== "done"}
              />
            );
          }
          if (part.type === "text") {
            return (
              <Streamdown
                key={i}
                className="font-serif space-y-3 text-[15px] leading-relaxed"
                plugins={PLUGINS}
                isAnimating={streaming}
              >
                {part.text}
              </Streamdown>
            );
          }
          if (part.type === "tool-web_search") {
            return <ToolCall key={i} part={part as unknown as WebSearchPart} />;
          }
          if (part.type === "tool-fetch_url") {
            return <ToolCall key={i} part={part as unknown as FetchUrlPart} />;
          }
          return null;
        })}
      </div>
      {!streaming && (
        <MessageActions show={canAct}>
          <CopyButton text={text} />
          <ActionButton
            label="Regenerate"
            onClick={() => onRegenerate(message.id)}
            icon={<RotateCcw className="size-3.5" />}
          />
        </MessageActions>
      )}
    </div>
  );
}

function MessageActions({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      {children}
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {icon}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ActionButton
      label={copied ? "Copied" : "Copy"}
      icon={
        copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )
      }
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    />
  );
}

function EditBubble({
  initial,
  onCancel,
  onSave,
}: {
  initial: string;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  return (
    <div className="flex w-full justify-end">
      <div className="flex w-full max-w-[80%] flex-col gap-2 rounded-2xl bg-secondary px-4 py-2.5">
        <Textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSave(draft);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          className="min-h-0 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 md:text-sm"
        />
        <div className="flex justify-end gap-1">
          <ActionButton
            label="Cancel"
            onClick={onCancel}
            icon={<X className="size-3.5" />}
          />
          <ActionButton
            label="Save"
            onClick={() => onSave(draft)}
            icon={<Check className="size-3.5" />}
          />
        </div>
      </div>
    </div>
  );
}

function MessageImage({ part }: { part: FileUIPart }) {
  const label = part.filename ?? "image";
  return (
    <a href={part.url} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={part.url}
        alt={label}
        className="max-h-64 max-w-full rounded-xl border object-cover"
      />
    </a>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: FileUIPart;
  onRemove: () => void;
}) {
  const label = attachment.filename ?? "image";
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
        className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 text-foreground opacity-0 transition-opacity group-hover/chip:opacity-100 hover:bg-background"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function ThinkingBlock({ content, open }: { content: string; open: boolean }) {
  const trimmed = content.trim();
  if (!trimmed) return null;
  return (
    <details
      open={open}
      className={cn(
        "group/think rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2",
      )}
    >
      <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground select-none group-open/think:mb-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1 rounded-full bg-muted-foreground/70" />
          Thinking
          <span className="text-muted-foreground/70 group-open/think:hidden">— click to expand</span>
        </span>
      </summary>
      <div className="whitespace-pre-wrap text-xs text-muted-foreground">{trimmed}</div>
    </details>
  );
}
