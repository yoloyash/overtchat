"use client";

import { useState } from "react";
import { Streamdown } from "streamdown";
import { useStickToBottom } from "use-stick-to-bottom";
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  CircleCheck,
  CircleX,
  GitBranch,
  Minimize2,
  Terminal,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  STREAMDOWN_PLUGINS,
} from "@/lib/chat/markdown";
import { ThinkingContent } from "@/components/chat/ThinkingContent";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

type UnknownRecord = Record<string, unknown>;

function recordOf(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function roleOf(message: unknown): string {
  return String(recordOf(message)?.role ?? "");
}

function contentOf(message: unknown): unknown {
  return recordOf(message)?.content;
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      const record = recordOf(part);
      return record?.type === "text" && typeof record.text === "string"
        ? [record.text]
        : [];
    })
    .join("\n");
}

function messageKey(message: unknown, index: number): string {
  const record = recordOf(message);
  const role = String(record?.role ?? "message");
  const identity =
    record?.id ?? record?.toolCallId ?? record?.timestamp ?? index;
  return `${role}:${String(identity)}:${index}`;
}

export function AgentMessageList({
  providerLabel,
  messages,
  streaming,
  error,
  workspaceName,
}: {
  providerLabel: string;
  messages: unknown[];
  streaming: boolean;
  error?: string;
  workspaceName: string;
}) {
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
    useStickToBottom({
      initial: "instant",
      resize: "instant",
    });

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto overscroll-contain"
      >
        <div
          ref={contentRef}
          className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pt-8 pb-8"
        >
          {messages.length === 0 && !error ? (
            <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
              <Terminal className="size-6 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{workspaceName}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                New {providerLabel} session
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((message, index) => (
                <AgentMessage
                  key={messageKey(message, index)}
                  message={message}
                  streaming={streaming && index === messages.length - 1}
                />
              ))}
              {streaming && roleOf(messages.at(-1)) === "user" && (
                <div
                  className="flex items-center gap-1.5 py-2"
                  role="status"
                  aria-label={`${providerLabel} is responding`}
                >
                  <span
                    className={`size-1.5 rounded-full bg-muted-foreground/70 [animation-delay:-0.3s] ${motionClasses.pendingDot}`}
                  />
                  <span
                    className={`size-1.5 rounded-full bg-muted-foreground/70 [animation-delay:-0.15s] ${motionClasses.pendingDot}`}
                  />
                  <span
                    className={`size-1.5 rounded-full bg-muted-foreground/70 ${motionClasses.pendingDot}`}
                  />
                </div>
              )}
              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <p className="min-w-0 break-words">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!isAtBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="pointer-events-auto rounded-full bg-background/95 shadow-md backdrop-blur"
            onClick={() => void scrollToBottom()}
            aria-label="Scroll to bottom"
          >
            <ChevronDown />
          </Button>
        </div>
      )}
    </div>
  );
}

function AgentMessage({
  message,
  streaming,
}: {
  message: unknown;
  streaming: boolean;
}) {
  const record = recordOf(message);
  if (!record) return null;
  const role = roleOf(message);
  if (role === "user") {
    return <UserMessage content={contentOf(message)} />;
  }
  if (role === "assistant") {
    return <AssistantMessage message={record} streaming={streaming} />;
  }
  if (role === "toolResult") {
    return <ToolResultMessage message={record} />;
  }
  if (role === "bashExecution") {
    return <BashExecutionMessage message={record} />;
  }
  if (role === "compactionSummary" || role === "branchSummary") {
    return <SummaryMessage message={record} role={role} />;
  }
  if (role === "custom") {
    if (record.display === false) return null;
    const text = textOfContent(record.content);
    return text ? (
      <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
        <Markdown>{text}</Markdown>
      </div>
    ) : null;
  }
  return null;
}

function UserMessage({ content }: { content: unknown }) {
  const text = textOfContent(content);
  const images = Array.isArray(content)
    ? content.flatMap((part) => {
        const record = recordOf(part);
        if (
          record?.type !== "image" ||
          typeof record.data !== "string" ||
          typeof record.mimeType !== "string"
        ) {
          return [];
        }
        return [
          {
            src: `data:${record.mimeType};base64,${record.data}`,
            alt: "Attached image",
          },
        ];
      })
    : [];
  return (
    <div className="flex flex-col items-end gap-2">
      {images.map((image, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={index}
          src={image.src}
          alt={image.alt}
          className="max-h-64 max-w-[80%] rounded-lg border object-contain"
        />
      ))}
      {text && (
        <div className="min-w-0 max-w-[80%] rounded-2xl bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap wrap-anywhere text-secondary-foreground">
          {text}
        </div>
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  streaming,
}: {
  message: UnknownRecord;
  streaming: boolean;
}) {
  const content = Array.isArray(message.content) ? message.content : [];
  const usage = recordOf(message.usage);
  const cost = recordOf(usage?.cost);
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {content.map((part, index) => {
        const record = recordOf(part);
        if (!record) return null;
        if (record.type === "text" && typeof record.text === "string") {
          return (
            <Markdown
              key={index}
              streaming={streaming && index === content.length - 1}
            >
              {record.text}
            </Markdown>
          );
        }
        if (
          record.type === "thinking" &&
          typeof record.thinking === "string"
        ) {
          return <ThinkingBlock key={index} content={record.thinking} />;
        }
        if (
          record.type === "toolCall" &&
          typeof record.name === "string"
        ) {
          return (
            <ToolCallBlock
              key={typeof record.id === "string" ? record.id : index}
              name={record.name}
              args={record.arguments}
            />
          );
        }
        return null;
      })}
      {typeof message.errorMessage === "string" && message.errorMessage && (
        <p className="text-sm text-destructive">{message.errorMessage}</p>
      )}
      {!streaming && usage && (
        <p className="font-mono text-[11px] text-muted-foreground">
          {formatUsage(usage, cost)}
        </p>
      )}
    </div>
  );
}

function Markdown({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}) {
  return (
    <Streamdown
      className="font-sans space-y-3 text-[15px] leading-relaxed"
      plugins={STREAMDOWN_PLUGINS}
      remarkPlugins={STREAMDOWN_DEFAULT_REMARK_PLUGINS}
      isAnimating={streaming}
      caret={streaming ? "block" : undefined}
    >
      {children}
    </Streamdown>
  );
}

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex items-center gap-2 py-1 text-xs font-medium text-muted-foreground motion-colors hover:text-foreground"
      >
        <Brain className="size-3.5" />
        <span>Thinking</span>
        <ChevronDown
          className={cn("size-3 motion-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="mt-1 border-l pl-3">
          <ThinkingContent content={content} />
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({ name, args }: { name: string; args: unknown }) {
  const command =
    recordOf(args) && typeof recordOf(args)?.command === "string"
      ? String(recordOf(args)?.command)
      : null;
  const detail = command ?? formatUnknown(args);
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/20">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
        <Wrench className="size-3.5 text-muted-foreground" />
        <span>{name}</span>
      </div>
      {detail && (
        <pre className="max-h-72 overflow-auto p-3 font-mono text-xs leading-5 whitespace-pre-wrap wrap-anywhere text-muted-foreground">
          {detail}
        </pre>
      )}
    </div>
  );
}

function ToolResultMessage({ message }: { message: UnknownRecord }) {
  const [open, setOpen] = useState(message.isError === true);
  const text = textOfContent(message.content);
  const partial = message.overtchatPartial === true;
  const Icon = message.isError === true ? CircleX : CircleCheck;
  const usage = recordOf(message.usage);
  const cost = recordOf(usage?.cost);
  return (
    <div className="rounded-lg border bg-muted/10 text-xs">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left motion-colors hover:bg-muted/30"
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            message.isError === true
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium">
          {String(message.toolName ?? "Tool")}{" "}
          {partial ? "running" : message.isError === true ? "failed" : "completed"}
        </span>
        <ChevronDown
          className={cn("size-3 motion-transform", open && "rotate-180")}
        />
      </button>
      {open && text && (
        <pre className="max-h-80 overflow-auto border-t p-3 font-mono text-xs leading-5 whitespace-pre-wrap wrap-anywhere text-muted-foreground">
          {text}
        </pre>
      )}
      {!partial && usage && (
        <p className="border-t px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {formatUsage(usage, cost)}
        </p>
      )}
    </div>
  );
}

function BashExecutionMessage({ message }: { message: UnknownRecord }) {
  const [open, setOpen] = useState(true);
  const command = String(message.command ?? "");
  const output = typeof message.output === "string" ? message.output : "";
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/15 text-xs">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left motion-colors hover:bg-muted/30"
      >
        <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono">{command}</span>
        <ChevronDown
          className={cn("size-3 motion-transform", open && "rotate-180")}
        />
      </button>
      {open && output && (
        <pre className="max-h-80 overflow-auto border-t p-3 font-mono text-xs leading-5 whitespace-pre-wrap wrap-anywhere text-muted-foreground">
          {output}
        </pre>
      )}
    </div>
  );
}

function SummaryMessage({
  message,
  role,
}: {
  message: UnknownRecord;
  role: "compactionSummary" | "branchSummary";
}) {
  const [open, setOpen] = useState(false);
  const summary =
    typeof message.summary === "string" ? message.summary : "";
  const compacted = role === "compactionSummary";
  const tokens =
    compacted && typeof message.tokensBefore === "number"
      ? message.tokensBefore
      : null;
  const Icon = compacted ? Minimize2 : GitBranch;
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/10 text-xs">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left motion-colors hover:bg-muted/30"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">
            {compacted ? "Conversation compacted" : "Branch summarized"}
          </span>
          {tokens !== null && (
            <span className="block text-[11px] text-muted-foreground">
              {tokens.toLocaleString()} tokens summarized
            </span>
          )}
        </span>
        <ChevronDown
          className={cn("size-3 motion-transform", open && "rotate-180")}
        />
      </button>
      {open && summary && (
        <div className="border-t p-3 text-sm">
          <Markdown>{summary}</Markdown>
        </div>
      )}
    </div>
  );
}

function formatUnknown(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatUsage(
  usage: UnknownRecord,
  cost: UnknownRecord | null,
): string {
  const input = numberOf(usage.input);
  const output = numberOf(usage.output);
  const cacheRead = numberOf(usage.cacheRead);
  const parts = [
    input !== null ? `${input.toLocaleString()} in` : null,
    output !== null ? `${output.toLocaleString()} out` : null,
    cacheRead ? `${cacheRead.toLocaleString()} cached` : null,
    cost && numberOf(cost.total) !== null
      ? formatCost(numberOf(cost.total)!)
      : null,
  ].filter((value): value is string => value !== null);
  return parts.join(" · ");
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatCost(value: number): string {
  if (value === 0) return "$0.00";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 0.01 ? 4 : 2,
    maximumFractionDigits: value < 0.01 ? 4 : 2,
  }).format(value);
}
