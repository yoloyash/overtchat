"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { writeText as clipboardWriteText } from "clipboard-polyfill";
import type { FileUIPart, UIMessage } from "ai";
import { Streamdown } from "streamdown";
import {
  Check,
  Copy,
  Loader2,
  Pencil,
  RotateCcw,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { humanMediaLabel } from "@/lib/chat/attachments";
import {
  STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  STREAMDOWN_PLUGINS,
} from "@/lib/chat/markdown";
import { speakableText, textOf } from "@/lib/chat/message";
import { groupMessageParts } from "@/lib/chat/parts";
import { stripCitationMarkers, type CitationRefType } from "@/lib/citations";
import { unicodeCitation } from "@/lib/citations-remark";
import type { MessageStats } from "@/lib/chat/stats";
import type { useSpeech } from "@/lib/useSpeech";
import {
  Citation,
  CompositeCitation,
  HighlightedText,
  buildSourceLookup,
} from "./Citation";
import { Sources } from "./Sources";
import { MediaIcon } from "./attachment-icons";
import { ChainOfThought } from "./ChainOfThought";
import { StatsPopover } from "./StatsPopover";

const CITATION_REMARK_PLUGINS = [
  ...STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  unicodeCitation,
];
const CITATION_ALLOWED_TAGS = {
  citation: ["turn", "reftype", "index", "citationid"],
  "composite-citation": ["citations", "citationid"],
  "highlighted-text": ["citationid"],
};

export function MessageBubble({
  message,
  streaming,
  canAct,
  onRegenerate,
  onEdit,
  speech,
  showStats,
  stats,
}: {
  message: UIMessage;
  streaming: boolean;
  canAct: boolean;
  onRegenerate: (id: string) => void;
  onEdit: (id: string, text: string, files: FileUIPart[]) => void;
  speech: ReturnType<typeof useSpeech>;
  showStats: boolean;
  stats: MessageStats | null;
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
          initialFiles={files}
          onCancel={() => setEditing(false)}
          onSave={(next, keptFiles) => {
            setEditing(false);
            const changed =
              next !== text || keptFiles.length !== files.length;
            if (changed && (next.trim() || keptFiles.length > 0)) {
              onEdit(message.id, next, keptFiles);
            }
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
          <div className="min-w-0 max-w-[80%] rounded-2xl bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap wrap-anywhere text-secondary-foreground">
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

  return (
    <AssistantBubble
      message={message}
      streaming={streaming}
      canAct={canAct}
      onRegenerate={onRegenerate}
      speech={speech}
      showStats={showStats}
      stats={stats}
    />
  );
}

function AssistantBubble({
  message,
  streaming,
  canAct,
  onRegenerate,
  speech,
  showStats,
  stats,
}: {
  message: UIMessage;
  streaming: boolean;
  canAct: boolean;
  onRegenerate: (id: string) => void;
  speech: ReturnType<typeof useSpeech>;
  showStats: boolean;
  stats: MessageStats | null;
}) {
  const text = textOf(message);
  const lookup = useMemo(() => buildSourceLookup(message), [message]);
  const citationComponents = useMemo(
    () => ({
      citation: (props: Record<string, unknown>) => (
        <Citation
          turn={props.turn as string | number | undefined}
          reftype={props.reftype as CitationRefType | undefined}
          index={props.index as string | number | undefined}
          lookup={lookup}
        />
      ),
      "composite-citation": (props: Record<string, unknown>) => (
        <CompositeCitation
          citations={props.citations as string | undefined}
          lookup={lookup}
        />
      ),
      "highlighted-text": (props: Record<string, unknown>) => (
        <HighlightedText>{props.children as React.ReactNode}</HighlightedText>
      ),
    }),
    [lookup],
  );

  return (
    <div className="group flex flex-col items-start gap-2">
      <div className="w-full max-w-full space-y-3 text-sm leading-relaxed">
        {(() => {
          const segments = groupMessageParts(message.parts);
          return segments.map((seg, i) => {
            const isLast = i === segments.length - 1;
            if (seg.kind === "text") {
              const showCaret = streaming && isLast;
              return (
                <Streamdown
                  key={seg.index}
                  className="font-sans space-y-3 text-[15px] leading-relaxed"
                  plugins={STREAMDOWN_PLUGINS}
                  remarkPlugins={CITATION_REMARK_PLUGINS}
                  allowedTags={CITATION_ALLOWED_TAGS}
                  components={citationComponents}
                  isAnimating={streaming}
                  caret={showCaret ? "block" : undefined}
                >
                  {(seg.part as { text: string }).text}
                </Streamdown>
              );
            }
            const trailing = seg.parts[seg.parts.length - 1];
            const trailingDone =
              trailing.type === "reasoning"
                ? (trailing as { state?: string }).state === "done"
                : (trailing as { state?: string }).state ===
                    "output-available" ||
                  (trailing as { state?: string }).state === "output-error";
            const active = streaming && isLast && !trailingDone;
            return (
              <ChainOfThought
                key={seg.startIndex}
                parts={
                  seg.parts as Parameters<typeof ChainOfThought>[0]["parts"]
                }
                active={active}
              />
            );
          });
        })()}
        {!streaming && <Sources message={message} />}
      </div>
      {!streaming && (
        <MessageActions show={canAct}>
          <CopyButton text={stripCitationMarkers(text)} />
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
          {showStats && stats && <StatsPopover stats={stats} />}
        </MessageActions>
      )}
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
        <MediaIcon
          mediaType={part.mediaType}
          filename={part.filename}
          className="size-4"
        />
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

function EditBubble({
  initial,
  initialFiles,
  onCancel,
  onSave,
}: {
  initial: string;
  initialFiles: FileUIPart[];
  onCancel: () => void;
  onSave: (text: string, files: FileUIPart[]) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [files, setFiles] = useState(initialFiles);
  const ref = useRef<HTMLTextAreaElement>(null);
  const nextText = draft.trim();
  const initialText = initial.trim();
  const dirty = nextText !== initialText || files.length !== initialFiles.length;
  const canSave = dirty && (nextText.length > 0 || files.length > 0);

  function save() {
    if (!canSave) return;
    onSave(nextText, files);
  }

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
      <form
        className="flex w-full max-w-[min(42rem,100%)] flex-col gap-3 rounded-3xl border bg-card px-4 pt-4 pb-3 shadow-sm dark:bg-muted/70"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((part, i) => (
              <div key={i} className="relative">
                <MessageAttachment part={part} />
                <button
                  type="button"
                  onClick={() =>
                    setFiles((prev) => prev.filter((_, j) => j !== i))
                  }
                  aria-label={`Remove ${part.filename ?? "attachment"}`}
                  className="absolute top-1 right-1 rounded-full bg-foreground/70 p-0.5 text-background shadow-sm hover:bg-foreground max-md:p-1"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <Textarea
          ref={ref}
          rows={1}
          value={draft}
          aria-label="Edit message"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          className="max-h-72 min-h-20 resize-none border-0 bg-transparent px-1 py-0 text-[15px] leading-6 shadow-none focus-visible:ring-0 md:text-[15px] dark:bg-transparent"
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-9 rounded-full px-4"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="lg"
            className="h-9 rounded-full px-5"
            disabled={!canSave}
          >
            Send
          </Button>
        </div>
      </form>
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
        void clipboardWriteText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          })
          .catch((err) => {
            toast.error({
              title: "Failed to copy",
              description:
                err instanceof Error ? err.message : "Clipboard access was denied.",
            });
          });
      }}
    />
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
  const live = active && (speech.status === "playing" || speech.status === "paused");
  const label = live ? "Stop" : loading ? "Loading…" : "Speak";
  const icon = loading ? (
    <Loader2 className="size-3.5 animate-spin" />
  ) : live ? (
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
