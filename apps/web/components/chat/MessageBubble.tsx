"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { writeText as clipboardWriteText } from "clipboard-polyfill";
import type { FileUIPart, UIMessage } from "ai";
import {
  codeExecutionFileIndex,
  openUIStateKey,
  type CodeExecutionFile,
  type OpenUIAction,
  type OpenUIFormState,
} from "@overtchat/shared";
import { Streamdown } from "streamdown";
import {
  Check,
  Copy,
  Loader2,
  Pencil,
  RotateCcw,
  Play,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { groupMessageParts, isToolSettled } from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { humanMediaLabel } from "@/lib/chat/attachments";
import {
  STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  MESSAGE_MARKDOWN_PLUGINS,
} from "@/lib/chat/markdown";
import { speakableText, textOf } from "@/lib/chat/message";
import { stripCitationMarkers, type CitationRefType } from "@/lib/citations";
import { unicodeCitation } from "@/lib/citations-remark";
import { CODE_FILE_ALLOWED_TAGS, CODE_FILE_TAG, codeFileLinks } from "@/lib/chat/code-file-links";
import type { MessageStats } from "@/lib/chat/stats";
import { motionClasses } from "@/lib/motion";
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
import { CodeFileLink, CodeFilesProvider } from "./CodeExecutionFiles";
import { DocumentCard } from "./DocumentCard";
import { GeneratedImageCard } from "./GeneratedImageCard";
import { MemoryArtifact } from "./MemoryArtifact";
import { OpenUICard } from "./OpenUICard";
import { StatsPopover } from "./StatsPopover";
import {
  MessageActions,
  MessageActionButton as ActionButton,
} from "./MessageActions";
import { serverUrl } from "@/lib/api-url";

const REPLY_REMARK_PLUGINS = [
  ...STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  unicodeCitation,
  codeFileLinks,
];
const REPLY_ALLOWED_TAGS = {
  citation: ["turn", "reftype", "index", "citationid"],
  "composite-citation": ["citations", "citationid"],
  "highlighted-text": ["citationid"],
  ...CODE_FILE_ALLOWED_TAGS,
};

function CodeFileElement(props: Record<string, unknown>) {
  return (
    <CodeFileLink
      filename={props.filename as string | undefined}
      embed={props.embed as string | undefined}
    >
      {props.children as React.ReactNode}
    </CodeFileLink>
  );
}

export function MessageBubble({
  message,
  streaming,
  canAct,
  readOnly = false,
  onRegenerate,
  onContinue,
  onImageReference,
  onOpenUIAction,
  openuiStates,
  codeFiles,
  onEdit,
  speech,
  showStats,
  stats,
}: {
  message: UIMessage;
  streaming: boolean;
  canAct: boolean;
  readOnly?: boolean;
  onRegenerate?: (id: string) => void;
  onContinue?: (id: string) => void;
  onImageReference?: (file: FileUIPart) => void;
  onOpenUIAction?: (action: OpenUIAction) => void;
  openuiStates?: Map<string, OpenUIFormState>;
  /** Files the conversation's runs returned, which replies link by name. */
  codeFiles?: ReadonlyMap<string, CodeExecutionFile>;
  onEdit?: (id: string, text: string, files: FileUIPart[]) => void;
  speech?: ReturnType<typeof useSpeech>;
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
              onEdit?.(message.id, next, keptFiles);
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
          <div
            data-chat-find-text=""
            className="min-w-0 max-w-[80%] rounded-2xl bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap wrap-anywhere text-secondary-foreground"
          >
            {text}
          </div>
        )}
        <MessageActions show={canAct || readOnly}>
          <CopyButton text={text} />
          {!readOnly && <ActionButton
            label="Edit"
            onClick={() => setEditing(true)}
            icon={<Pencil className="size-3.5" />}
          />}
        </MessageActions>
      </div>
    );
  }

  return (
    <AssistantBubble
      message={message}
      streaming={streaming}
      canAct={canAct && !readOnly}
      readOnly={readOnly}
      onRegenerate={onRegenerate}
      onContinue={onContinue}
      onImageReference={onImageReference}
      onOpenUIAction={onOpenUIAction}
      openuiStates={openuiStates}
      codeFiles={codeFiles}
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
  readOnly = false,
  onRegenerate,
  onContinue,
  onImageReference,
  onOpenUIAction,
  openuiStates,
  codeFiles,
  speech,
  showStats,
  stats,
}: {
  message: UIMessage;
  streaming: boolean;
  canAct: boolean;
  readOnly?: boolean;
  onRegenerate?: (id: string) => void;
  onContinue?: (id: string) => void;
  onImageReference?: (file: FileUIPart) => void;
  onOpenUIAction?: (action: OpenUIAction) => void;
  openuiStates?: Map<string, OpenUIFormState>;
  codeFiles?: ReadonlyMap<string, CodeExecutionFile>;
  speech?: ReturnType<typeof useSpeech>;
  showStats: boolean;
  stats: MessageStats | null;
}) {
  const text = textOf(message);
  const lookup = useMemo(() => buildSourceLookup(message), [message]);
  const ownFiles = useMemo(
    () => (codeFiles ? undefined : codeExecutionFileIndex([message])),
    [codeFiles, message],
  );
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
      [CODE_FILE_TAG]: CodeFileElement,
    }),
    [lookup],
  );

  return (
    <CodeFilesProvider value={codeFiles ?? ownFiles!}>
    <div className="group flex flex-col items-start gap-2">
      <div className="w-full max-w-full space-y-3 text-sm leading-relaxed">
        {(() => {
          const segments = groupMessageParts(message.parts);
          return segments.map((seg, i) => {
            const isLast = i === segments.length - 1;
            if (seg.kind === "text") {
              const showCaret = streaming && isLast;
              return (
                <div key={seg.index} data-chat-find-text="">
                  <Streamdown
                    className="font-sans space-y-3 text-[15px] leading-relaxed"
                    plugins={MESSAGE_MARKDOWN_PLUGINS}
                    remarkPlugins={REPLY_REMARK_PLUGINS}
                    allowedTags={REPLY_ALLOWED_TAGS}
                    components={citationComponents}
                    isAnimating={streaming}
                    caret={showCaret ? "block" : undefined}
                  >
                    {(seg.part as { text: string }).text}
                  </Streamdown>
                </div>
              );
            }
            if (seg.kind === "image") {
              return (
                <GeneratedImageCard
                  readOnly={readOnly}
                  key={seg.index}
                  part={seg.part}
                  streaming={streaming}
                  onReference={canAct ? onImageReference : undefined}
                />
              );
            }
            if (seg.kind === "document") {
              return (
                <DocumentCard
                  key={seg.part.toolCallId}
                  part={seg.part}
                  streaming={streaming}
                />
              );
            }
            if (seg.kind === "openui") {
              return (
                <OpenUICard
                  key={seg.part.toolCallId}
                  messageId={message.id}
                  part={seg.part}
                  streaming={streaming}
                  initialState={openuiStates?.get(openUIStateKey(message.id, seg.part.toolCallId))}
                  onAction={canAct ? onOpenUIAction : undefined}
                />
              );
            }
            if (seg.kind === "memory") {
              return <MemoryArtifact key={seg.startIndex} parts={seg.parts} />;
            }
            // Run files show inside their run's step; the reply shows the
            // ones it links.
            if (seg.kind === "files") return null;
            const trailing = seg.parts[seg.parts.length - 1];
            const trailingDone =
              trailing.type === "reasoning"
                ? (trailing as { state?: string }).state === "done"
                : isToolSettled(
                    trailing as Parameters<typeof isToolSettled>[0],
                  );
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
        <MessageActions show={canAct || readOnly}>
          <CopyButton text={stripCitationMarkers(text)} />
          {!readOnly && speech && <SpeakButton
            messageId={message.id}
            text={speakableText(message)}
            speech={speech}
          />}
          {!readOnly && onRegenerate && <ActionButton
            label="Regenerate"
            onClick={() => onRegenerate(message.id)}
            icon={<RotateCcw className="size-3.5" />}
          />}
          {!readOnly && onContinue && (
            <ActionButton
              label="Continue response"
              onClick={() => onContinue(message.id)}
              icon={<Play className="size-3.5" />}
            />
          )}
          {showStats && stats && <StatsPopover stats={stats} />}
        </MessageActions>
      )}
    </div>
    </CodeFilesProvider>
  );
}

function MessageAttachment({ part }: { part: FileUIPart }) {
  const isImage = part.mediaType?.startsWith("image/") ?? false;
  const label = part.filename ?? (isImage ? "image" : "file");
  if (isImage) {
    return (
      <a href={serverUrl(part.url)} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={serverUrl(part.url)}
          alt={label}
          className="max-h-64 max-w-full rounded-xl border object-cover"
        />
      </a>
    );
  }
  return (
    <a href={serverUrl(part.url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2.5">
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
    </a>
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
          .catch(() => {
            toast.error({
              title: "Failed to copy",
              description: "Clipboard access was denied by the browser.",
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
    <Loader2 className={`size-3.5 ${motionClasses.spinner}`} />
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
