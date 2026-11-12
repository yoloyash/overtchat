"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Brain,
  ChevronRight,
  CircleAlert,
  CircleX,
  FilePenLine,
  FileText,
  Globe,
  Loader2,
  PanelRightOpen,
  Search,
  Terminal,
  Users,
  Wrench,
} from "lucide-react";
import { ThinkingContent } from "@/components/chat/ThinkingContent";
import {
  agentThoughtPreview,
  agentToolStatus,
  describeAgentActivity,
  describeAgentTool,
  describeSubagentActivity,
  isSubagentRunning,
  type AgentActivityEntry,
  type AgentActivitySequencePosition,
  type AgentToolActivity,
  type AgentToolCategory,
  type AgentToolStatus,
} from "@/lib/agents/presentation";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AgentDiffLines } from "./AgentDiffLines";
import { useAgentWorkspaceNavigation } from "./AgentWorkspaceNavigationContext";

type UnknownRecord = Record<string, unknown>;

export type AgentRunActivity =
  | "working"
  | "stopping"
  | "compacting"
  | "reconnecting";

export function formatAgentElapsed(milliseconds: number): string {
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
    : formatAgentElapsed(Math.max(0, now - startedAt));
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
  sequencePosition,
}: {
  entries: AgentActivityEntry[];
  active: boolean;
  sequencePosition: AgentActivitySequencePosition;
}) {
  const presentation = describeAgentActivity(entries, active);
  const hasError = presentation.status === "failed";
  const [open, setOpen] = useState(hasError);
  const [openDetailHeight, reportDetailHeight] = useOpenDetailHeight();
  const singleEntry = entries.length === 1 ? entries[0] : null;
  if (singleEntry?.type === "subagent") {
    return (
      <div
        className="text-xs"
        data-testid="agent-activity-group"
        data-activity-sequence={sequencePosition}
      >
        <SubagentActivityStep activity={singleEntry.activity} showIcon />
      </div>
    );
  }

  const toolSummary = entries.some((entry) => entry.type === "tool");
  const live = active && presentation.status === "running";
  const hasDetailedSteps = entries.some(
    (entry) =>
      entry.type === "tool" ||
      entry.type === "subagent",
  );

  return (
    <div
      className="text-xs"
      data-testid="agent-activity-group"
      data-activity-sequence={sequencePosition}
      data-agent-tool-summary={toolSummary ? "true" : undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={
          toolSummary
            ? `${presentation.label}, ${presentation.status}`
            : undefined
        }
        className="group flex min-h-7 w-full items-center gap-2 rounded-md py-0.5 pr-1 text-left text-muted-foreground motion-colors hover:text-foreground"
      >
        <DisclosureLeadIcon open={open}>
          <ActivityIcon
            entries={entries}
            status={presentation.status}
            toolSummary={toolSummary}
          />
        </DisclosureLeadIcon>
        <span className="min-w-0 flex flex-1 items-baseline gap-2">
          <span
            className={cn(
              "shrink-0 font-normal motion-colors group-hover:text-foreground",
              live && !open && motionClasses.shimmer,
            )}
          >
            {presentation.label}
          </span>
          {presentation.secondary && (
            <span className="min-w-0 truncate font-mono text-[11px]">
              {presentation.secondary}
            </span>
          )}
        </span>
      </button>

      {open && (
        // The list of steps is capped, and an open step adds its own height to
        // the cap so its detail never scrolls inside a second scroller.
        <div
          className="mt-1 overflow-y-auto"
          style={{ maxHeight: `calc(25rem + ${openDetailHeight}px)` }}
          data-testid="agent-activity-details"
        >
          <StepDetailContext.Provider value={reportDetailHeight}>
            {/* The rail sits inside the scroller: step icons straddle it and
                would be clipped at the scroller's own edge. */}
            <div
              className={cn(
                "ml-2 pl-5",
                hasDetailedSteps && "border-l border-border/70",
              )}
            >
              {entries.map((entry, index) => (
                <ActivityStep
                  key={entry.id}
                  entry={entry}
                  active={active}
                  last={index === entries.length - 1}
                  showDetailedStep={hasDetailedSteps}
                />
              ))}
            </div>
          </StepDetailContext.Provider>
        </div>
      )}
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
        <ThoughtActivityStep content={entry.content} live={active && last} />
      </TimelineStep>
    );
  }

  if (entry.type === "subagent") {
    return (
      <TimelineStep
        icon={<Users className="size-3.5" />}
        last={last}
      >
        <SubagentActivityStep activity={entry.activity} />
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

function SubagentActivityStep({
  activity,
  showIcon = false,
}: {
  activity: Extract<
    AgentActivityEntry,
    { type: "subagent" }
  >["activity"];
  showIcon?: boolean;
}) {
  const running = isSubagentRunning(activity.status);
  const status: AgentToolStatus = running
    ? "running"
    : activity.status === "failed"
      ? "failed"
      : activity.status === "stopped"
        ? "stopped"
        : "completed";
  const [open, setOpen] = useState(status === "failed");
  const { label, summary } = describeSubagentActivity(activity);
  const canOpen =
    Boolean(activity.prompt) ||
    activity.receivers.length > 0 ||
    activity.events.length > 0;

  return (
    <div data-testid="agent-subagent-activity">
      <button
        type="button"
        onClick={() => canOpen && setOpen((current) => !current)}
        disabled={!canOpen}
        aria-expanded={canOpen ? open : undefined}
        className={cn(
          "group flex min-h-6 w-full items-start gap-2 rounded-md py-0.5 text-left text-muted-foreground motion-colors",
          canOpen && "cursor-pointer hover:text-foreground",
        )}
      >
        {showIcon && (
          <DisclosureLeadIcon open={open} interactive={canOpen}>
            <Users className="size-3.5 text-muted-foreground" />
          </DisclosureLeadIcon>
        )}
        <span className="min-w-0 flex flex-1 items-baseline gap-2">
          <span className="shrink-0 font-normal text-muted-foreground motion-colors group-hover:text-foreground">
            {label}
          </span>
          {summary && (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {summary}
            </span>
          )}
        </span>
        <ToolStatusIcon status={status} />
        {canOpen && !showIcon && (
          <ChevronRight
            className={cn(
              "mt-0.5 size-3 shrink-0 text-muted-foreground/60 motion-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>
      {open && (
        <StepDetail>
          {activity.prompt && (
            <CodeSurface label="Prompt" value={activity.prompt} />
          )}
          {activity.receivers.length > 0 && (
            <div className="overflow-hidden rounded-md border bg-muted/15">
              {activity.receivers.map((receiver) => (
                <div
                  key={receiver.threadId}
                  className="flex items-start gap-2 border-b px-3 py-2 text-[11px] last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {receiver.threadId}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {receiver.status}
                  </span>
                  {receiver.message && (
                    <span className="max-w-48 truncate text-muted-foreground">
                      {receiver.message}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {activity.events.length > 0 && (
            <div className="overflow-hidden rounded-md border bg-muted/15">
              <div className="border-b px-3 py-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                Activity
              </div>
              <div className="divide-y">
                {activity.events.map((event, index) => (
                  <div
                    key={index}
                    className="px-3 py-2 text-[11px] leading-5 whitespace-pre-wrap wrap-anywhere text-muted-foreground"
                  >
                    {event}
                  </div>
                ))}
              </div>
            </div>
          )}
        </StepDetail>
      )}
    </div>
  );
}

function ThoughtActivityStep({
  content,
  live,
}: {
  content: string;
  live: boolean;
}) {
  const [open, setOpen] = useState(false);
  const preview = agentThoughtPreview(content);

  return (
    <div data-testid="agent-thought-activity">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="group flex min-h-6 w-full cursor-pointer items-start gap-2 rounded-md py-0.5 text-left text-muted-foreground motion-colors hover:text-foreground"
      >
        <span className="min-w-0 flex flex-1 items-baseline gap-2">
          <span
            className={cn(
              "shrink-0 font-normal motion-colors group-hover:text-foreground",
              live && motionClasses.shimmer,
            )}
          >
            {live ? "Thinking" : "Thought"}
          </span>
          {!open && preview && (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground/70">
              {preview}
            </span>
          )}
        </span>
        <ChevronRight
          className={cn(
            "mt-0.5 size-3 shrink-0 text-muted-foreground/60 motion-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <StepDetail>
          <ThinkingContent content={content} />
        </StepDetail>
      )}
    </div>
  );
}

const StepDetailContext = createContext<
  ((id: string, height: number) => void) | null
>(null);

/** The summed height of the step details that are open inside one group. */
function useOpenDetailHeight() {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const report = useCallback((id: string, height: number) => {
    setHeights((current) => {
      if ((current[id] ?? 0) === height) return current;
      const next = { ...current };
      if (height > 0) next[id] = height;
      else delete next[id];
      return next;
    });
  }, []);
  const total = Object.values(heights).reduce((sum, height) => sum + height, 0);
  return [total, report] as const;
}

/** The body an open step shows under its row. */
function StepDetail({ children }: { children: ReactNode }) {
  const id = useId();
  const report = useContext(StepDetailContext);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !report) return;
    const measure = () => report(id, element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      report(id, 0);
    };
  }, [id, report]);
  return (
    <div ref={ref} className="space-y-2 pt-2 pb-1.5" data-agent-step-detail>
      {children}
    </div>
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
    <div className={cn("relative min-w-0", last ? "pb-1" : "pb-1.5")}>
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
  showIcon = false,
}: {
  tool: AgentToolActivity;
  active: boolean;
  showIcon?: boolean;
}) {
  const presentation = describeAgentTool(tool);
  const status = agentToolStatus(tool, active);
  const detail = toolDetail(tool, presentation.category);
  const [open, setOpen] = useState(status === "failed");
  const canOpen = detail !== null;
  const navigation = useAgentWorkspaceNavigation();
  const filePath =
    navigation &&
    presentation.summary &&
    (presentation.category === "read" ||
      presentation.category === "edit" ||
      presentation.category === "write") &&
    // Agents also read their own resources by URL; those are not files.
    !presentation.summary.includes("://")
      ? presentation.summary
      : null;

  return (
    <div className="group/step relative" data-testid="agent-tool-activity">
      <button
        type="button"
        onClick={() => canOpen && setOpen((current) => !current)}
        disabled={!canOpen}
        aria-expanded={canOpen ? open : undefined}
        aria-label={`${presentation.label}${presentation.summary ? `: ${presentation.summary}` : ""}, ${status}`}
        className={cn(
          "group flex min-h-6 w-full items-start gap-2 rounded-md py-0.5 text-left text-muted-foreground motion-colors",
          canOpen && "cursor-pointer hover:text-foreground",
        )}
      >
        {showIcon && (
          <DisclosureLeadIcon open={open} interactive={canOpen}>
            <ToolCategoryIcon
              category={presentation.category}
              className="size-3.5 text-muted-foreground"
            />
          </DisclosureLeadIcon>
        )}
        <span
          className={cn(
            "min-w-0 flex flex-1 items-baseline gap-2",
            filePath && "pr-6",
          )}
        >
          <span className="shrink-0 font-normal motion-colors group-hover:text-foreground">
            {toolStepLabel(presentation.category, status)}
          </span>
          {presentation.summary && (
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {presentation.summary}
            </span>
          )}
        </span>
        <ToolStatusIcon status={status} />
        {canOpen && !showIcon && (
          <ChevronRight
            className={cn(
              "mt-0.5 size-3 shrink-0 text-muted-foreground/60 motion-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>
      {filePath && navigation && (
        <button
          type="button"
          onClick={() => navigation.openFile({ path: filePath })}
          aria-label={`Open ${filePath}`}
          title="Open file"
          className={cn(
            "absolute top-0.5 flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 motion-colors hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/step:opacity-100 [@media(hover:none)]:opacity-100",
            status === "completed" ? "right-5" : "right-10",
          )}
        >
          <PanelRightOpen className="size-3.5" />
        </button>
      )}
      {open && detail && <StepDetail>{detail}</StepDetail>}
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

    if (
      !command &&
      !tool.output &&
      tool.terminalInputs.length === 0 &&
      notices.length === 0
    ) {
      return null;
    }
    return (
      <div className="overflow-hidden rounded-md border bg-muted/15">
        {command && (
          <pre className="max-h-72 overflow-y-auto px-3 py-2.5 font-mono text-[11px] leading-5 whitespace-pre-wrap wrap-anywhere text-foreground">
            <span className="select-none text-muted-foreground">$ </span>
            {command}
          </pre>
        )}
        {tool.output && (
          <pre className="max-h-72 overflow-auto border-t bg-background/50 px-3 py-2.5 font-mono text-[11px] leading-5 whitespace-pre-wrap wrap-anywhere text-muted-foreground">
            {tool.output.replace(/^\n+/, "")}
          </pre>
        )}
        {tool.terminalInputs.length > 0 && (
          <pre className="max-h-40 overflow-auto border-t px-3 py-2.5 font-mono text-[11px] leading-5 whitespace-pre-wrap wrap-anywhere text-muted-foreground">
            {tool.terminalInputs.map((input, index) => (
              <span key={index} className="block">
                <span className="select-none text-muted-foreground">
                  {"› "}
                </span>
                {input.replace(/\n$/u, "")}
              </span>
            ))}
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
    <>
      {patch && <DiffSurface value={patch} />}
      {content && <CodeSurface label="Content" value={content} />}
      {!patch && !content && input && (
        <CodeSurface label="Input" value={input} />
      )}
      {output && <CodeSurface label="Output" value={output} />}
    </>
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
        <AgentDiffLines value={value} />
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

function DisclosureLeadIcon({
  children,
  open,
  interactive = true,
}: {
  children: ReactNode;
  open: boolean;
  interactive?: boolean;
}) {
  return (
    <span className="relative mt-0.5 flex size-3.5 shrink-0 items-center justify-center">
      <span
        className={cn(
          "flex items-center justify-center",
          interactive &&
            "group-hover:invisible group-focus-visible:invisible",
          interactive && open && "invisible",
        )}
      >
        {children}
      </span>
      {interactive && (
        <ChevronRight
          className={cn(
            "absolute hidden size-3.5 text-foreground/70 motion-transform group-hover:block group-focus-visible:block",
            open && "block rotate-90",
          )}
        />
      )}
    </span>
  );
}

function ActivityIcon({
  entries,
  status,
  toolSummary,
}: {
  entries: AgentActivityEntry[];
  status: AgentToolStatus;
  toolSummary: boolean;
}) {
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
  if (toolSummary) {
    return <Wrench className="size-3.5 shrink-0 text-muted-foreground" />;
  }
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
  const categories = new Set(
    entries.flatMap((entry) =>
      entry.type === "tool" ? [describeAgentTool(entry.tool).category] : [],
    ),
  );
  if (categories.size === 0) {
    if (entries.some((entry) => entry.type === "subagent")) {
      return <Users className="size-3.5 shrink-0 text-muted-foreground" />;
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
      return null;
    case "failed":
      return <CircleAlert className={className} />;
    case "stopped":
      return <CircleX className={className} />;
  }
}
