"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { cjk } from "@streamdown/cjk";
import remarkBreaks from "remark-breaks";
import { remark } from "remark";
import strip from "strip-markdown";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  File as FileIcon,
  FileCode,
  FileSpreadsheet,
  FileText,
  Ghost,
  Globe,
  Loader2,
  Paperclip,
  Pencil,
  RotateCcw,
  Sparkles,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  fetchModelConfigs,
  useSelectedModel,
  type PublicModelConfig,
} from "@/lib/config";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { useSpeech } from "@/lib/useSpeech";
import { ModelPicker } from "@/components/ModelPicker";
import { SidebarToggle } from "@/components/SidebarToggle";
import {
  ToolCall,
  type FetchUrlPart,
  type WebSearchPart,
} from "@/components/ToolCall";

const SEARCH_STORAGE_KEY = "overtchat_search_enabled";

const ATTACH_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/*",
  ".md",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".py",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".sh",
  ".sql",
].join(",");

type AttachmentCategory = "image" | "document" | "text" | "spreadsheet";

interface AttachmentMeta {
  category?: AttachmentCategory;
  size?: number;
  pageCount?: number | null;
  truncated?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderCategoryIcon(
  cat: AttachmentCategory | undefined,
  className: string,
) {
  switch (cat) {
    case "text":
      return <FileCode className={className} />;
    case "spreadsheet":
      return <FileSpreadsheet className={className} />;
    case "document":
      return <FileText className={className} />;
    default:
      return <FileIcon className={className} />;
  }
}

function renderMediaIcon(
  mediaType: string | undefined,
  filename: string | undefined,
  className: string,
) {
  if (mediaType === "application/pdf")
    return <FileText className={className} />;
  if (mediaType?.includes("wordprocessingml"))
    return <FileText className={className} />;
  if (mediaType?.includes("spreadsheetml") || mediaType === "text/csv")
    return <FileSpreadsheet className={className} />;
  if (mediaType?.startsWith("text/"))
    return <FileCode className={className} />;
  if (
    filename &&
    /\.(md|json|yaml|yml|toml|py|js|ts|tsx|jsx|go|rs|java|c|cpp|h|sh|sql)$/i.test(filename)
  ) {
    return <FileCode className={className} />;
  }
  return <FileIcon className={className} />;
}

interface Props {
  chatId: string;
  initialMessages?: UIMessage[];
  isNew?: boolean;
  projectId?: string | null;
}

const PLUGINS = { code, math, cjk };

const stripper = remark().use(strip);

function stripMarkdown(s: string): string {
  return String(stripper.processSync(s)).replace(/\s+/g, " ").trim();
}

function speakableText(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => stripMarkdown((p as { text: string }).text))
    .join(" ")
    .trim();
}

export function ChatArea({ chatId, initialMessages, isNew, projectId }: Props) {
  const router = useRouter();

  const [models, setModels] = useState<PublicModelConfig[] | null>(null);
  const [selectedId, setSelectedId] = useSelectedModel();

  useEffect(() => {
    let cancelled = false;
    fetchModelConfigs()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        if (list.length > 0 && !list.some((m) => m.id === selectedId)) {
          setSelectedId(list[0].id);
        }
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const configured = (models?.length ?? 0) > 0 && Boolean(selectedId);

  const [searchEnabled, setSearchEnabled] = useLocalStorage<boolean>(
    SEARCH_STORAGE_KEY,
    false,
  );

  const [temporary, setTemporary] = useState(false);

  const isNewRef = useRef(isNew ?? false);

  const [transport] = useState(
    () => new DefaultChatTransport<UIMessage>({ api: "/api/chat" }),
  );

  const temporaryRef = useRef(false);
  useEffect(() => {
    temporaryRef.current = temporary;
  }, [temporary]);

  const { messages, sendMessage, regenerate, status, stop, error } = useChat({
    transport,
    messages: initialMessages,
    onFinish: () => {
      if (temporaryRef.current) return;
      router.refresh();
    },
  });

  const speech = useSpeech();

  const requestBody = () => ({
    modelConfigId: selectedId,
    searchEnabled,
    chatId,
    projectId: projectId ?? null,
    temporary,
  });

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FileUIPart[]>([]);
  const [attachmentMeta, setAttachmentMeta] = useState<
    Record<string, AttachmentMeta>
  >({});
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
    if (!configured) return;
    if (isNewRef.current && !temporary) {
      isNewRef.current = false;
      window.history.replaceState(null, "", `/chat/${chatId}`);
    }
    sendMessage({ text, files: attachments }, { body: requestBody() });
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
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <SidebarToggle />
        <ModelPicker
          models={models}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <div className="ml-auto flex items-center">
          {isNew && messages.length === 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                "rounded-full",
                temporary && "bg-accent text-foreground hover:bg-accent",
              )}
              onClick={() => setTemporary((t) => !t)}
              aria-label={
                temporary ? "Disable temporary chat" : "Enable temporary chat"
              }
              aria-pressed={temporary}
              title="Temporary chat — won't be saved to history"
            >
              <Ghost />
            </Button>
          ) : temporary ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-foreground">
              <Ghost className="size-3.5" />
              Temporary
            </span>
          ) : null}
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain"
      >
        {messages.length === 0 ? (
          <EmptyState configured={configured} temporary={temporary} />
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
                speech={speech}
              />
            ))}
            {status === "submitted" &&
              messages.at(-1)?.role === "user" && <PendingIndicator />}
          </div>
        )}
      </div>

      <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
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
              placeholder={configured ? "Message…" : "No models available — ask an admin to add one"}
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

function EmptyState({
  configured,
  temporary,
}: {
  configured: boolean;
  temporary: boolean;
}) {
  return (
    <div className="flex h-full min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {temporary ? (
          <Ghost className="size-5" />
        ) : (
          <Sparkles className="size-5" />
        )}
      </div>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        {temporary ? "Temporary chat" : "What can I help with?"}
      </h1>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        {!configured
          ? "No models configured yet. An admin needs to add one in Settings → Models."
          : temporary
            ? "Messages won't be saved to your history."
            : "Ask a question or start a conversation."}
      </p>
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
  speech,
}: {
  message: UIMessage;
  streaming: boolean;
  canAct: boolean;
  onRegenerate: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  speech: ReturnType<typeof useSpeech>;
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
              <MessageAttachment key={i} part={part} />
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
            const isLast = i === message.parts.length - 1;
            const active = streaming && part.state !== "done" && isLast;
            return (
              <ThinkingBlock
                key={i}
                content={part.text}
                active={active}
              />
            );
          }
          if (part.type === "text") {
            const isLast = i === message.parts.length - 1;
            const showCaret = streaming && isLast;
            return (
              <Streamdown
                key={i}
                className="font-serif space-y-3 text-[15px] leading-relaxed"
                plugins={PLUGINS}
                isAnimating={streaming}
                caret={showCaret ? "block" : undefined}
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
          <SpeakButton
            messageId={message.id}
            text={speakableText(message)}
            speech={speech}
          />
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

function SpeakButton({
  messageId,
  text,
  speech,
}: {
  messageId: string;
  text: string;
  speech: ReturnType<typeof useSpeech>;
}) {
  if (!text) return null;
  const active = speech.activeId === messageId;
  const loading = active && speech.status === "loading";
  const playing = active && speech.status === "playing";
  const label = playing ? "Stop" : loading ? "Loading…" : "Speak";
  const icon = loading ? (
    <Loader2 className="size-3.5 animate-spin" />
  ) : playing ? (
    <Square className="size-3 fill-current" />
  ) : (
    <Volume2 className="size-3.5" />
  );
  return (
    <ActionButton
      label={label}
      icon={icon}
      onClick={() => void speech.play(messageId, text)}
    />
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
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
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
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-md:p-2.5"
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

function MessageAttachment({ part }: { part: FileUIPart }) {
  const isImage = part.mediaType?.startsWith("image/") ?? false;
  const label = part.filename ?? (isImage ? "image" : "file");
  if (isImage) {
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
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        {renderMediaIcon(part.mediaType, part.filename, "size-4")}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">
          {humanMediaLabel(part.mediaType)}
        </div>
      </div>
    </div>
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
        {renderCategoryIcon(meta?.category, "size-4")}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium">{label}</div>
        {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
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

function humanMediaLabel(mediaType: string | undefined): string {
  if (!mediaType) return "File";
  if (mediaType === "application/pdf") return "PDF";
  if (mediaType.includes("wordprocessingml")) return "Word document";
  if (mediaType.includes("spreadsheetml")) return "Excel spreadsheet";
  if (mediaType === "text/csv") return "CSV";
  if (mediaType.startsWith("text/")) return mediaType.replace(/^text\//, "").toUpperCase();
  return mediaType;
}

function ThinkingBlock({
  content,
  active,
}: {
  content: string;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    if (active) {
      if (startedAtRef.current == null) startedAtRef.current = Date.now();
      settledRef.current = false;
      const tick = () => {
        if (startedAtRef.current != null) {
          setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
        }
      };
      tick();
      const id = window.setInterval(tick, 1000);
      return () => window.clearInterval(id);
    }
    if (startedAtRef.current != null && !settledRef.current) {
      settledRef.current = true;
      setDuration(
        Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)),
      );
    }
  }, [active]);

  const trimmed = content.trim();
  if (!trimmed && !active) return null;

  const label = active
    ? "Thinking…"
    : duration > 0
      ? `Thought for ${duration}s`
      : "Thoughts";

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group/think inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 -mx-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        aria-expanded={open}
      >
        <span className={cn(active && "animate-text-shimmer")}>{label}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          open ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-l-2 border-border pl-3">
            <Streamdown
              className="space-y-3 text-xs leading-relaxed text-muted-foreground [&_pre]:text-xs [&_code]:text-xs"
              plugins={PLUGINS}
              remarkPlugins={[remarkBreaks]}
            >
              {trimmed}
            </Streamdown>
          </div>
        </div>
      </div>
    </div>
  );
}

function PendingIndicator() {
  return (
    <div className="flex items-start">
      <span className="animate-text-shimmer text-xs font-medium">
        Thinking…
      </span>
    </div>
  );
}

