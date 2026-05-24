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
import { Textarea } from "@/components/ui/textarea";
import { humanMediaLabel } from "@/lib/chat/attachments";
import {
  STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  STREAMDOWN_PLUGINS,
} from "@/lib/chat/markdown";
import { speakableText, textOf } from "@/lib/chat/message";
import { stripCitationMarkers, type CitationRefType } from "@/lib/citations";
import { unicodeCitation } from "@/lib/citations-remark";
import type { MessageStats } from "@/lib/chat/stats";
import type { useSpeech } from "@/lib/useSpeech";
import {
  ToolCall,
  type FetchUrlPart,
  type WebSearchPart,
} from "@/components/ToolCall";
import {
  Citation,
  CompositeCitation,
  HighlightedText,
  buildSourceLookup,
} from "./Citation";
import { Sources } from "./Sources";
import { MediaIcon } from "./attachment-icons";
import { ThinkingBlock } from "./ThinkingBlock";
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
  onEdit: (id: string, text: string) => void;
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
                plugins={STREAMDOWN_PLUGINS}
                remarkPlugins={CITATION_REMARK_PLUGINS}
                allowedTags={CITATION_ALLOWED_TAGS}
                components={citationComponents}
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
        void clipboardWriteText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
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
