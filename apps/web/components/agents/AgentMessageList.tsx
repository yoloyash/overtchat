"use client";

import { useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import { useStickToBottom } from "use-stick-to-bottom";
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleX,
  FilePenLine,
  FileText,
  Globe,
  Loader2,
  Minimize2,
  Search,
  Terminal,
  Wrench,
  GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  STREAMDOWN_PLUGINS,
} from "@/lib/chat/markdown";
import { ThinkingContent } from "@/components/chat/ThinkingContent";
import {
  agentToolStatus,
  describeAgentActivity,
  describeAgentTool,
  formatAgentToolDetail,
  projectAgentTranscript,
  type AgentActivityEntry,
  type AgentToolActivity,
  type AgentToolCategory,
  type AgentToolStatus,
  type AgentTranscriptItem,
} from "@/lib/agents/presentation";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

type UnknownRecord = Record<string, unknown>;

export type AgentRunActivity =
  | "working"
  | "stopping"
  | "compacting"
  | "reconnecting";

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

export function AgentMessageList({
  providerLabel,
  messages,
  streaming,
  activity,
  activityStartedAt,
  error,
  workspaceName,
}: {
  providerLabel: string;
  messages: unknown[];
  streaming: boolean;
  activity: AgentRunActivity | null;
  activityStartedAt: number | null;
  error?: string;
  workspaceName: string;
}) {
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
    useStickToBottom({
      initial: "instant",
      resize: "instant",
    });
  const transcript = useMemo(
    () => projectAgentTranscript(messages),
    [messages],
  );

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
          {messages.length === 0 && !error && !activity ? (
            <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
              <Terminal className="size-6 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{workspaceName}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                New {providerLabel} session
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {transcript.map((item, index) => (
                <AgentTranscriptRow
                  key={item.key}
                  item={item}
                  active={streaming && index === transcript.length - 1}
                />
              ))}
              {activity && (
                <AgentRunIndicator
                  activity={activity}
                  startedAt={activityStartedAt}
                  providerLabel={providerLabel}
                />
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

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function AgentRunIndicator({
  activity,
  startedAt,
  providerLabel,
}: {
  activity: AgentRunActivity;
  startedAt: number | null;
  providerLabel: string;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (startedAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const label =
    activity === "stopping"
      ? "Stopping"
      : activity === "compacting"
        ? "Compacting"
        : activity === "reconnecting"
          ? "Reconnecting"
          : "Working";
  const elapsed =
    startedAt === null ? null : formatElapsed(Math.max(0, now - startedAt));

  return (
    <div
      className="flex min-h-8 items-center gap-2 py-1 text-xs text-muted-foreground"
      role="status"
      aria-label={`${providerLabel}: ${label.toLowerCase()}${elapsed ? ` for ${elapsed}` : ""}`}
      data-testid="agent-run-activity"
    >
      <Loader2 className={`size-3.5 ${motionClasses.spinner}`} />
      <span className="font-medium text-foreground">{label}</span>
      {elapsed && <span className="tabular-nums">{elapsed}</span>}
    </div>
  );
}

function AgentTranscriptRow({
  item,
  active,
}: {
  item: AgentTranscriptItem;
  active: boolean;
}) {
  if (item.type === "message") {
    return <AgentMessage message={item.message} />;
  }
  if (item.type === "assistant_text") {
    return (
      <div className="text-sm leading-relaxed">
        <Markdown streaming={active}>{item.text}</Markdown>
      </div>
    );
  }
  if (item.type === "assistant_error") {
    return <p className="text-sm text-destructive">{item.text}</p>;
  }
  return <AgentActivityGroup entries={item.entries} active={active} />;
}

function AgentMessage({ message }: { message: unknown }) {
  const record = recordOf(message);
  if (!record) return null;
  const role = roleOf(message);
  if (role === "user") {
    return <UserMessage content={contentOf(message)} />;
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

function AgentActivityGroup({
  entries,
  active,
}: {
  entries: AgentActivityEntry[];
  active: boolean;
}) {
  const presentation = describeAgentActivity(entries, active);
  const hasError = presentation.status === "failed";
  const [open, setOpen] = useState(hasError);
  const toolCount = entries.filter((entry) => entry.type === "tool").length;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-muted/10 text-xs",
        hasError && "border-destructive/30",
      )}
      data-testid="agent-activity-group"
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex min-h-10 w-full items-center gap-2.5 px-3 py-2 text-left motion-colors hover:bg-muted/30"
      >
        <ActivityIcon
          entries={entries}
          status={presentation.status}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">
            {presentation.label}
          </span>
          {presentation.secondary && (
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {presentation.secondary}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground motion-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="divide-y border-t" data-testid="agent-activity-details">
          {entries.map((entry) =>
            entry.type === "thinking" ? (
              <ThinkingActivityDetail
                key={entry.id}
                content={entry.content}
                showLabel={toolCount > 0}
              />
            ) : (
              <ToolActivityRow
                key={entry.id}
                tool={entry.tool}
                active={active}
                defaultOpen={toolCount === 1}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingActivityDetail({
  content,
  showLabel,
}: {
  content: string;
  showLabel: boolean;
}) {
  return (
    <div className="px-3 py-3">
      {showLabel && (
        <div className="mb-2 flex items-center gap-2 text-muted-foreground">
          <Brain className="size-3.5 shrink-0" />
          <span className="font-medium">Thinking</span>
        </div>
      )}
      <ThinkingContent content={content} />
    </div>
  );
}

function ToolActivityRow({
  tool,
  active,
  defaultOpen,
}: {
  tool: AgentToolActivity;
  active: boolean;
  defaultOpen: boolean;
}) {
  const presentation = describeAgentTool(tool);
  const status = agentToolStatus(tool, active);
  const detail = formatAgentToolDetail(tool);
  const [open, setOpen] = useState(defaultOpen && Boolean(detail));
  const canOpen = Boolean(detail);

  return (
    <div data-testid="agent-tool-activity">
      <button
        type="button"
        onClick={() => canOpen && setOpen((current) => !current)}
        disabled={!canOpen}
        aria-expanded={canOpen ? open : undefined}
        aria-label={`${presentation.label}${presentation.summary ? `: ${presentation.summary}` : ""}, ${status}`}
        className={cn(
          "flex min-h-10 w-full items-center gap-2.5 px-3 py-2 text-left",
          canOpen && "motion-colors hover:bg-muted/30",
        )}
      >
        <ToolIcon category={presentation.category} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">
            {presentation.label}
          </span>
          {presentation.summary && (
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {presentation.summary}
            </span>
          )}
        </span>
        <ToolStatusIcon status={status} />
        {canOpen && (
          <ChevronDown
            className={cn(
              "size-3 shrink-0 text-muted-foreground motion-transform",
              open && "rotate-180",
            )}
          />
        )}
      </button>
      {open && detail && (
        <pre className="max-h-80 overflow-auto border-t bg-background/40 px-3 py-3 font-mono text-xs leading-5 whitespace-pre-wrap wrap-anywhere text-muted-foreground">
          {detail}
        </pre>
      )}
    </div>
  );
}

function ActivityIcon({
  entries,
  status,
}: {
  entries: AgentActivityEntry[];
  status: AgentToolStatus;
}) {
  if (status === "running") {
    return (
      <Loader2
        className={cn(
          "size-4 shrink-0 text-muted-foreground",
          motionClasses.spinner,
        )}
      />
    );
  }
  if (status === "failed" || status === "stopped") {
    return (
      <CircleAlert
        className={cn(
          "size-4 shrink-0",
          status === "failed" ? "text-destructive" : "text-muted-foreground",
        )}
      />
    );
  }
  const categories = new Set(
    entries.flatMap((entry) =>
      entry.type === "tool" ? [describeAgentTool(entry.tool).category] : [],
    ),
  );
  if (categories.size === 0) {
    return <Brain className="size-4 shrink-0 text-muted-foreground" />;
  }
  if (categories.size !== 1) {
    return <Wrench className="size-4 shrink-0 text-muted-foreground" />;
  }
  return <ToolIcon category={[...categories][0]} className="size-4" />;
}

function ToolIcon({
  category,
  className = "size-3.5",
}: {
  category: AgentToolCategory;
  className?: string;
}) {
  const iconClassName = cn(className, "shrink-0 text-muted-foreground");
  switch (category) {
    case "shell":
      return <Terminal className={iconClassName} />;
    case "read":
      return <FileText className={iconClassName} />;
    case "edit":
    case "write":
      return <FilePenLine className={iconClassName} />;
    case "search":
      return <Search className={iconClassName} />;
    case "fetch":
      return <Globe className={iconClassName} />;
    case "other":
      return <Wrench className={iconClassName} />;
  }
}

function ToolStatusIcon({ status }: { status: AgentToolStatus }) {
  const className = cn(
    "size-3.5 shrink-0 text-muted-foreground",
    status === "running" && motionClasses.spinner,
    status === "failed" && "text-destructive",
  );
  switch (status) {
    case "running":
      return <Loader2 className={className} />;
    case "completed":
      return <CircleCheck className={className} />;
    case "failed":
      return <CircleAlert className={className} />;
    case "stopped":
      return <CircleX className={className} />;
  }
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
              Compacted from {tokens.toLocaleString()} tokens
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
