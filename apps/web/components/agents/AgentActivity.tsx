"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Brain,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  FilePenLine,
  FileText,
  Globe,
  Loader2,
  MessageSquareText,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import { ThinkingContent } from "@/components/chat/ThinkingContent";
import {
  agentToolStatus,
  describeAgentActivity,
  describeAgentTool,
  type AgentActivityEntry,
  type AgentToolActivity,
  type AgentToolCategory,
  type AgentToolStatus,
} from "@/lib/agents/presentation";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

type UnknownRecord = Record<string, unknown>;

export type AgentRunActivity =
  | "working"
  | "stopping"
  | "compacting"
  | "reconnecting";

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function useElapsed(startedAt: number | null): string | null {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (startedAt === null) return;
    const tick = () => setNow(Date.now());
    const initial = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [startedAt]);

  return startedAt === null
    ? null
    : formatElapsed(Math.max(0, now - startedAt));
}

export function agentActivityOwnsLiveStatus(
  entries: AgentActivityEntry[],
  active: boolean,
): boolean {
  return active && describeAgentActivity(entries, true).status === "running";
}

export function AgentRunIndicator({
  activity,
  startedAt,
  providerLabel,
}: {
  activity: AgentRunActivity;
  startedAt: number | null;
  providerLabel: string;
}) {
  const elapsed = useElapsed(startedAt);
  const label =
    activity === "stopping"
      ? "Stopping"
      : activity === "compacting"
        ? "Compacting"
        : activity === "reconnecting"
          ? "Reconnecting"
          : "Working";

  return (
    <div
      className="flex min-h-8 items-center gap-2 py-1 text-xs text-muted-foreground"
      role="status"
      aria-label={`${providerLabel}: ${label.toLowerCase()}${elapsed ? ` for ${elapsed}` : ""}`}
      data-testid="agent-run-activity"
    >
      <Loader2 className={cn("size-3.5", motionClasses.spinner)} />
      <span
        className={cn(
          "font-medium text-foreground",
          activity === "working" && motionClasses.shimmer,
        )}
      >
        {label}
      </span>
      {elapsed && <span className="tabular-nums">{elapsed}</span>}
    </div>
  );
}

export function AgentActivityGroup({
  entries,
  active,
  startedAt,
  durationMs,
}: {
  entries: AgentActivityEntry[];
  active: boolean;
  startedAt: number | null;
  durationMs: number | null;
}) {
  const presentation = describeAgentActivity(entries, active);
  const hasError = presentation.status === "failed";
  const live = active && presentation.status === "running";
  const elapsed = useElapsed(live ? startedAt : null);
  const [open, setOpen] = useState(hasError);
  const hasTools = entries.some((entry) => entry.type === "tool");
  const completedCount = entries.filter(
    (entry) =>
      entry.type === "tool" &&
      agentToolStatus(entry.tool, active) === "completed",
  ).length;
  const progress =
    live && completedCount > 0 ? `${completedCount} completed` : null;
  const completedDuration =
    presentation.status === "completed" && durationMs !== null
      ? formatElapsed(durationMs)
      : null;
  const headerLabel =
    open && live && hasTools ? "Activity" : presentation.label;
  const headerSecondary =
    open && live && hasTools ? null : presentation.secondary;

  return (
    <div className="text-xs" data-testid="agent-activity-group">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={
          completedDuration ? `Worked for ${completedDuration}` : undefined
        }
        className="group flex min-h-8 w-full items-center gap-2 rounded-md py-1 pr-1 text-left text-muted-foreground motion-colors hover:text-foreground"
      >
        <ActivityIcon entries={entries} status={presentation.status} />
        <span className="min-w-0 flex flex-1 items-baseline gap-2">
          <span
            className={cn(
              "shrink-0 font-medium text-foreground",
              live && !open && motionClasses.shimmer,
            )}
          >
            {completedDuration ? (
              <span aria-hidden="true">
                <span>Worked</span>
                <span style={{ marginInlineStart: 4 }}>for</span>
                {completedDuration.split(" ").map((part) => (
                  <span
                    key={part}
                    className="tabular-nums"
                    style={{ marginInlineStart: 4 }}
                  >
                    {part}
                  </span>
                ))}
              </span>
            ) : (
              headerLabel
            )}
          </span>
          {headerSecondary && (
            <span className="min-w-0 truncate font-mono text-[11px]">
              {headerSecondary}
            </span>
          )}
        </span>
        {progress && (
          <span className="hidden shrink-0 tabular-nums text-[11px] sm:inline">
            {progress}
          </span>
        )}
        {elapsed && (
          <span className="shrink-0 tabular-nums text-[11px]">{elapsed}</span>
        )}
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 opacity-60 motion-transform",
            open && "rotate-90",
          )}
        />
      </button>

      <div
        className={cn(
          "grid",
          motionClasses.collapse,
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              "relative mt-1 ml-2 pl-5",
              hasTools && "border-l border-border/70",
            )}
            data-testid="agent-activity-details"
          >
            {entries.map((entry, index) => (
              <ActivityStep
                key={entry.id}
                entry={entry}
                active={active}
                last={index === entries.length - 1}
                showDetailedStep={hasTools || entries.length > 1}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityStep({
  entry,
  active,
  last,
  showDetailedStep,
}: {
  entry: AgentActivityEntry;
  active: boolean;
  last: boolean;
  showDetailedStep: boolean;
}) {
  if (entry.type === "commentary") {
    if (!showDetailedStep) {
      return (
        <div className={cn("min-w-0", last ? "pb-1" : "pb-4")}>
          <ThinkingContent content={entry.content} />
        </div>
      );
    }
    return (
      <TimelineStep
        icon={<MessageSquareText className="size-3.5" />}
        last={last}
      >
        <ThinkingContent content={entry.content} />
      </TimelineStep>
    );
  }

  if (entry.type === "thinking") {
    if (!showDetailedStep) {
      return (
        <div className={cn("min-w-0", last ? "pb-1" : "pb-4")}>
          <ThinkingContent content={entry.content} />
        </div>
      );
    }
    return (
      <TimelineStep
        icon={<Brain className="size-3.5" />}
        last={last}
      >
        <div className="space-y-2">
          <div className="font-medium text-foreground">Thinking</div>
          <ThinkingContent content={entry.content} />
        </div>
      </TimelineStep>
    );
  }

  return (
    <TimelineStep
      icon={
        <ToolCategoryIcon
          category={describeAgentTool(entry.tool).category}
          className="size-3.5"
        />
      }
      last={last}
    >
      <ToolActivityStep tool={entry.tool} active={active} />
    </TimelineStep>
  );
}

function TimelineStep({
  icon,
  last,
  children,
}: {
  icon: ReactNode;
  last: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative min-w-0", last ? "pb-1" : "pb-4")}>
      <span className="absolute top-0.5 -left-[29px] flex size-4 items-center justify-center bg-background text-muted-foreground">
        {icon}
      </span>
      {children}
    </div>
  );
}

function ToolActivityStep({
  tool,
  active,
}: {
  tool: AgentToolActivity;
  active: boolean;
}) {
  const presentation = describeAgentTool(tool);
  const status = agentToolStatus(tool, active);
  const detail = toolDetail(tool, presentation.category);
  const [open, setOpen] = useState(status === "failed");
  const canOpen = detail !== null;

  return (
    <div data-testid="agent-tool-activity">
      <button
        type="button"
        onClick={() => canOpen && setOpen((current) => !current)}
        disabled={!canOpen}
        aria-expanded={canOpen ? open : undefined}
        aria-label={`${presentation.label}${presentation.summary ? `: ${presentation.summary}` : ""}, ${status}`}
        className={cn(
          "flex min-h-5 w-full items-start gap-2 text-left",
          canOpen && "cursor-pointer hover:text-foreground",
        )}
      >
        <span className="min-w-0 flex flex-1 items-baseline gap-2">
          <span className="shrink-0 font-medium text-foreground">
            {toolStepLabel(presentation.category, status)}
          </span>
          {presentation.summary && (
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {presentation.summary}
            </span>
          )}
        </span>
        <ToolStatusIcon status={status} />
        {canOpen && (
          <ChevronRight
            className={cn(
              "mt-0.5 size-3 shrink-0 text-muted-foreground/60 motion-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>
      {open && detail}
    </div>
  );
}

function toolStepLabel(
  category: AgentToolCategory,
  status: AgentToolStatus,
): string {
  const running = status === "running";
  switch (category) {
    case "shell":
      return running ? "Running" : "Terminal";
    case "read":
      return running ? "Reading" : "Read";
    case "edit":
      return running ? "Editing" : "Edited";
    case "write":
      return running ? "Writing" : "Wrote";
    case "search":
      return running ? "Searching" : "Searched";
    case "fetch":
      return running ? "Fetching" : "Fetched";
    case "other":
      return running ? "Running tool" : "Tool";
  }
}

function toolDetail(
  tool: AgentToolActivity,
  category: AgentToolCategory,
): ReactNode | null {
  const args = recordOf(tool.args);

  if (category === "shell") {
    const command = firstString(args, ["command", "cmd"]);
    const notices = [
      tool.cancelled ? "Command cancelled." : null,
      tool.exitCode !== null && tool.exitCode !== 0
        ? `Exited with code ${tool.exitCode}.`
        : null,
      tool.truncated && tool.fullOutputPath
        ? `Output truncated. Full output: ${tool.fullOutputPath}`
        : null,
    ].filter((notice): notice is string => notice !== null);

    if (!command && !tool.output && notices.length === 0) return null;
    return (
      <div className="mt-2 overflow-hidden rounded-md border bg-muted/15">
        {command && (
          <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[11px] leading-5 text-foreground">
            <span className="select-none text-muted-foreground">$ </span>
            {command}
          </pre>
        )}
        {tool.output && (
          <pre className="max-h-72 overflow-auto border-t bg-background/50 px-3 py-2.5 font-mono text-[11px] leading-5 whitespace-pre-wrap wrap-anywhere text-muted-foreground">
            {tool.output.replace(/^\n+/, "")}
          </pre>
        )}
        {notices.length > 0 && (
          <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
            {notices.join(" ")}
          </div>
        )}
      </div>
    );
  }

  const patch =
    category === "edit"
      ? firstString(args, ["patch", "diff", "unifiedDiff", "unified_diff"])
      : null;
  const content =
    category === "write"
      ? firstString(args, ["content", "text", "fileText", "file_text"])
      : null;
  const input = formatDetailInput(tool.args, category);
  const output =
    (patch || content) && !tool.isError ? "" : tool.output.trim();

  if (!patch && !content && !input && !output) return null;

  return (
    <div className="mt-2 space-y-2">
      {patch && <DiffSurface value={patch} />}
      {content && <CodeSurface label="Content" value={content} />}
      {!patch && !content && input && (
        <CodeSurface label="Input" value={input} />
      )}
      {output && <CodeSurface label="Output" value={output} />}
    </div>
  );
}

function CodeSurface({ label, value }: { label: string; value: string }) {
  return (
    <div className="overflow-hidden rounded-md border bg-muted/15">
      <div className="border-b px-3 py-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <pre className="max-h-72 overflow-auto bg-background/50 px-3 py-2.5 font-mono text-[11px] leading-5 whitespace-pre-wrap wrap-anywhere text-muted-foreground">
        {value}
      </pre>
    </div>
  );
}

function DiffSurface({ value }: { value: string }) {
  return (
    <div className="overflow-hidden rounded-md border bg-muted/15">
      <div className="border-b px-3 py-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        Changes
      </div>
      <pre className="max-h-80 overflow-auto bg-background/50 py-2.5 font-mono text-[11px] leading-5">
        {value.split("\n").map((line, index) => (
          <span
            key={index}
            className={cn(
              "block min-w-max px-3 whitespace-pre",
              line.startsWith("+") &&
                !line.startsWith("+++") &&
                "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              line.startsWith("-") &&
                !line.startsWith("---") &&
                "bg-red-500/10 text-red-700 dark:text-red-300",
              line.startsWith("@@") && "text-muted-foreground",
            )}
          >
            {line || " "}
          </span>
        ))}
      </pre>
    </div>
  );
}

function recordOf(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function firstString(
  record: UnknownRecord | null,
  keys: string[],
): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function formatDetailInput(
  value: unknown,
  category: AgentToolCategory,
): string {
  const record = recordOf(value);
  if (!record) return formatUnknown(value);

  const summaryKeys: Partial<Record<AgentToolCategory, Set<string>>> = {
    read: new Set(["path", "filePath", "file_path"]),
    search: new Set(["query", "pattern", "path", "url"]),
    fetch: new Set(["url"]),
  };
  const omitted = summaryKeys[category];
  if (!omitted) return formatUnknown(value);

  const remaining = Object.fromEntries(
    Object.entries(record).filter(([key]) => !omitted.has(key)),
  );
  return Object.keys(remaining).length > 0 ? formatUnknown(remaining) : "";
}

function formatUnknown(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ToolCategoryIcon({
  category,
  className,
}: {
  category: AgentToolCategory;
  className: string;
}) {
  switch (category) {
    case "shell":
      return <Terminal className={className} />;
    case "read":
      return <FileText className={className} />;
    case "edit":
    case "write":
      return <FilePenLine className={className} />;
    case "search":
      return <Search className={className} />;
    case "fetch":
      return <Globe className={className} />;
    case "other":
      return <Wrench className={className} />;
  }
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
          "size-3.5 shrink-0 text-muted-foreground",
          motionClasses.spinner,
        )}
      />
    );
  }
  if (status === "failed" || status === "stopped") {
    return (
      <CircleAlert
        className={cn(
          "size-3.5 shrink-0",
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
    if (entries.some((entry) => entry.type === "commentary")) {
      return (
        <MessageSquareText className="size-3.5 shrink-0 text-muted-foreground" />
      );
    }
    return <Brain className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  if (categories.size > 1) {
    return <Wrench className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return (
    <ToolCategoryIcon
      category={[...categories][0]}
      className="size-3.5 shrink-0 text-muted-foreground"
    />
  );
}

function ToolStatusIcon({ status }: { status: AgentToolStatus }) {
  const className = cn(
    "mt-0.5 size-3.5 shrink-0 text-muted-foreground",
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
