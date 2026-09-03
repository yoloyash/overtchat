"use client";

import { writeText as clipboardWriteText } from "clipboard-polyfill";
import { useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import { useStickToBottom } from "use-stick-to-bottom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Info,
  ListChecks,
  Minimize2,
  Play,
  Terminal,
  GitBranch,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  STREAMDOWN_PLUGINS,
} from "@/lib/chat/markdown";
import { remarkAgentLinks } from "@/lib/agents/links";
import {
  agentActivitySequencePosition,
  describeAgentActivity,
  presentAgentError,
  projectAgentTranscript,
  type AgentActivitySequencePosition,
  type AgentErrorPresentation,
  type AgentTranscriptItem,
} from "@/lib/agents/presentation";
import { cn } from "@/lib/utils";
import {
  AgentActivityGroup,
  AgentRunIndicator,
  formatAgentElapsed,
  type AgentRunActivity,
} from "./AgentActivity";
import { AgentTaskProgressCard } from "./AgentTaskList";
import { AgentLinkIcon } from "./AgentLinkIcon";
import { AgentWorkspaceLink } from "./AgentWorkspaceLink";

export type { AgentRunActivity } from "./AgentActivity";

type UnknownRecord = Record<string, unknown>;

const AGENT_REMARK_PLUGINS = [
  ...STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  remarkAgentLinks,
];

const AGENT_MARKDOWN_ALLOWED_TAGS = {
  "agent-link-icon": ["kind"],
  "agent-workspace-link": ["path", "linestart", "lineend"],
};

const AGENT_MARKDOWN_COMPONENTS = {
  "agent-link-icon": AgentLinkIcon,
  "agent-workspace-link": AgentWorkspaceLink,
};

const AGENT_MARKDOWN_CLASSES = cn(
  "font-sans space-y-3 text-[15px] leading-relaxed",
  "[&_[data-streamdown=link]]:inline-flex [&_[data-streamdown=link]]:max-w-full [&_[data-streamdown=link]]:items-baseline",
  "[&_[data-streamdown=link]]:font-medium [&_[data-streamdown=link]]:text-primary [&_[data-streamdown=link]]:no-underline",
  "[&_[data-streamdown=link]]:motion-colors [&_[data-streamdown=link]]:hover:underline",
);

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
  canEditMessages,
  canForkMessages,
  actionsDisabled,
  suppressScrollButton,
  onEditMessage,
  onForkMessage,
  onImplementPlan,
}: {
  providerLabel: string;
  messages: unknown[];
  streaming: boolean;
  activity: AgentRunActivity | null;
  activityStartedAt: number | null;
  error?: string;
  workspaceName: string;
  canEditMessages: boolean;
  canForkMessages: boolean;
  actionsDisabled: boolean;
  suppressScrollButton: boolean;
  onEditMessage: (messageId: string) => void;
  onForkMessage: (messageId: string) => void;
  onImplementPlan: (plan: string) => void;
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
  const trailingItem = transcript.at(-1);
  const activityAlreadyVisible =
    activity === "working" &&
    streaming &&
    trailingItem?.type === "activity" &&
    describeAgentActivity(trailingItem.entries, true).status === "running";

  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden"
      data-testid="agent-message-list"
    >
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
            <div className="flex flex-col">
              {transcript.map((item, index) => {
                const previous = transcript[index - 1];
                const sequencePosition = agentActivitySequencePosition(
                  transcript,
                  index,
                );
                const compact =
                  previous &&
                  (item.type === "activity" ||
                    previous.type === "activity" ||
                    item.type === "turn_footer");
                return (
                  <div
                    key={item.key}
                    className={cn(
                      index > 0 && (compact ? "mt-3" : "mt-6"),
                      (sequencePosition === "middle" ||
                        sequencePosition === "last") &&
                        "mt-0",
                      item.type === "turn_footer" && "mt-2",
                    )}
                  >
                    <AgentTranscriptRow
                      item={item}
                      active={streaming && index === transcript.length - 1}
                      canEditMessages={canEditMessages}
                      canForkMessages={canForkMessages}
                      actionsDisabled={actionsDisabled}
                      onEditMessage={onEditMessage}
                      onForkMessage={onForkMessage}
                      onImplementPlan={onImplementPlan}
                      activitySequencePosition={sequencePosition}
                    />
                  </div>
                );
              })}
              {activity && !activityAlreadyVisible && (
                <AgentRunIndicator
                  activity={activity}
                  startedAt={activityStartedAt}
                  providerLabel={providerLabel}
                />
              )}
              {error && (
                <AgentErrorNotice error={presentAgentError(error)} />
              )}
            </div>
          )}
        </div>
      </div>

      {!isAtBottom && !suppressScrollButton && (
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

function AgentTranscriptRow({
  item,
  active,
  canEditMessages,
  canForkMessages,
  actionsDisabled,
  onEditMessage,
  onForkMessage,
  onImplementPlan,
  activitySequencePosition,
}: {
  item: AgentTranscriptItem;
  active: boolean;
  canEditMessages: boolean;
  canForkMessages: boolean;
  actionsDisabled: boolean;
  onEditMessage: (messageId: string) => void;
  onForkMessage: (messageId: string) => void;
  onImplementPlan: (plan: string) => void;
  activitySequencePosition: AgentActivitySequencePosition | null;
}) {
  if (item.type === "message") {
    return (
      <AgentMessage
        message={item.message}
        canEdit={canEditMessages}
        actionsDisabled={actionsDisabled}
        onEditMessage={onEditMessage}
      />
    );
  }
  if (item.type === "assistant_text") {
    return (
      <div className="group/assistant relative text-sm leading-relaxed">
        <Markdown streaming={active}>{item.text}</Markdown>
        {canForkMessages && item.actionable && item.messageId && (
          <MessageAction
            label="Fork from this response"
            className="-bottom-6 left-0"
            disabled={actionsDisabled}
            onClick={() => onForkMessage(item.messageId!)}
          >
            <GitBranch />
          </MessageAction>
        )}
      </div>
    );
  }
  if (item.type === "assistant_error") {
    return <AgentErrorNotice error={item.error} />;
  }
  if (item.type === "notification") {
    return <AgentNotificationNotice notification={item.notification} />;
  }
  if (item.type === "turn_footer") {
    return (
      <AgentTurnFooter
        item={item}
        canFork={canForkMessages}
        actionsDisabled={actionsDisabled}
        onForkMessage={onForkMessage}
      />
    );
  }
  if (item.type === "plan") {
    return (
      <AgentPlanCard
        item={item}
        disabled={actionsDisabled || active}
        onImplement={() => onImplementPlan(item.text)}
      />
    );
  }
  if (item.type === "task_list") {
    return <AgentTaskProgressCard snapshot={item.snapshot} />;
  }
  return (
    <AgentActivityGroup
      entries={item.entries}
      active={active}
      sequencePosition={activitySequencePosition ?? "single"}
    />
  );
}

function AgentNotificationNotice({
  notification,
}: {
  notification: Extract<
    AgentTranscriptItem,
    { type: "notification" }
  >["notification"];
}) {
  const warning = notification.level === "warning";
  const error = notification.level === "error";
  const Icon = warning || error ? AlertTriangle : Info;
  return (
    <div
      className="flex items-start gap-2 py-1 text-sm text-muted-foreground"
      role={error ? "alert" : "status"}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          warning && "text-amber-500",
          error && "text-destructive",
        )}
      />
      <span className="min-w-0 flex-1 text-foreground/90">
        {notification.message}
      </span>
    </div>
  );
}

function AgentTurnFooter({
  item,
  canFork,
  actionsDisabled,
  onForkMessage,
}: {
  item: Extract<AgentTranscriptItem, { type: "turn_footer" }>;
  canFork: boolean;
  actionsDisabled: boolean;
  onForkMessage: (messageId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const showFork = canFork && item.messageId !== null;

  if (!item.text && !showFork && item.durationMs === null) return null;

  function copyTurn() {
    void clipboardWriteText(item.text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_200);
      })
      .catch(() => {
        toast.error({
          title: "Failed to copy",
          description: "Clipboard access was denied by the browser.",
        });
      });
  }

  return (
    <div
      className="flex min-h-7 items-center gap-1 text-xs text-muted-foreground"
      data-testid="agent-turn-footer"
    >
      {item.text && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          aria-label={copied ? "Copied response" : "Copy response"}
          title={copied ? "Copied" : "Copy response"}
          disabled={actionsDisabled}
          onClick={copyTurn}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      )}
      {showFork && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          aria-label="Fork from this response"
          title="Fork from this response"
          disabled={actionsDisabled}
          onClick={() => onForkMessage(item.messageId!)}
        >
          <GitBranch />
        </Button>
      )}
      {item.durationMs !== null && (
        <span className="ml-1 tabular-nums">
          Worked for {formatAgentElapsed(item.durationMs)}
        </span>
      )}
    </div>
  );
}

function AgentPlanCard({
  item,
  disabled,
  onImplement,
}: {
  item: Extract<AgentTranscriptItem, { type: "plan" }>;
  disabled: boolean;
  onImplement: () => void;
}) {
  return (
    <section
      className="overflow-hidden rounded-lg border bg-muted/15"
      data-testid="agent-plan-card"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ListChecks className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Plan</h3>
      </div>
      <div className="space-y-3 px-3 py-3 text-sm">
        {item.explanation && (
          <p className="text-muted-foreground">{item.explanation}</p>
        )}
        {item.text ? (
          <Markdown>{item.text}</Markdown>
        ) : item.steps.length > 0 ? (
          <ol className="space-y-2">
            {item.steps.map((step, index) => (
              <li key={`${step.step}:${index}`} className="flex gap-2">
                <span className="text-muted-foreground tabular-nums">
                  {index + 1}.
                </span>
                <span className="min-w-0 flex-1">{step.step}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {item.actionable && (
          <div className="flex justify-end border-t pt-3">
            <Button
              type="button"
              size="sm"
              disabled={disabled}
              onClick={onImplement}
            >
              <Play />
              Implement plan
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function AgentErrorNotice({ error }: { error: AgentErrorPresentation }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-destructive/30 bg-destructive/5 text-sm">
      <div className="flex items-start gap-2.5 px-3 py-2.5" role="alert">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <p className="min-w-0 flex-1 break-words">{error.summary}</p>
        {error.details && (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground motion-colors hover:text-foreground"
          >
            Details
            <ChevronDown
              className={cn(
                "size-3 motion-transform",
                open && "rotate-180",
              )}
            />
          </button>
        )}
      </div>
      {open && error.details && (
        <pre className="max-h-64 overflow-auto border-t bg-background/40 px-3 py-2.5 font-mono text-xs leading-5 whitespace-pre-wrap wrap-anywhere text-muted-foreground">
          {error.details}
        </pre>
      )}
    </div>
  );
}

function AgentMessage({
  message,
  canEdit,
  actionsDisabled,
  onEditMessage,
}: {
  message: unknown;
  canEdit: boolean;
  actionsDisabled: boolean;
  onEditMessage: (messageId: string) => void;
}) {
  const record = recordOf(message);
  if (!record) return null;
  const role = roleOf(message);
  if (role === "user") {
    return (
      <UserMessage
        content={contentOf(message)}
        messageId={typeof record.id === "string" ? record.id : null}
        canEdit={canEdit}
        actionsDisabled={actionsDisabled}
        onEditMessage={onEditMessage}
      />
    );
  }
  if (role === "compactionSummary" || role === "branchSummary") {
    return <SummaryMessage message={record} role={role} />;
  }
  if (role === "custom") {
    if (record.display === false) return null;
    const text = textOfContent(record.content);
    return text ? (
      <div className="flex items-start gap-2 py-1 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1 text-foreground/90">
          <Markdown>{text}</Markdown>
        </div>
      </div>
    ) : null;
  }
  return null;
}

function UserMessage({
  content,
  messageId,
  canEdit,
  actionsDisabled,
  onEditMessage,
}: {
  content: unknown;
  messageId: string | null;
  canEdit: boolean;
  actionsDisabled: boolean;
  onEditMessage: (messageId: string) => void;
}) {
  const text = textOfContent(content);
  const images = Array.isArray(content)
    ? content.flatMap((part) => {
        const record = recordOf(part);
        if (record?.type !== "image" || typeof record.mimeType !== "string") {
          return [];
        }
        const src =
          typeof record.url === "string"
            ? record.url
            : typeof record.data === "string"
              ? `data:${record.mimeType};base64,${record.data}`
              : null;
        if (!src) return [];
        return [
          {
            src,
            alt:
              typeof record.filename === "string"
                ? record.filename
                : "Attached image",
          },
        ];
      })
    : [];
  return (
    <div className="group/user relative flex flex-col items-end gap-2">
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
        <div className="relative min-w-0 max-w-[80%]">
          <div className="rounded-2xl bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap wrap-anywhere text-secondary-foreground">
            {text}
          </div>
          {canEdit && messageId && (
            <MessageAction
              label="Edit from this message"
              className="right-full bottom-0 mr-1"
              disabled={actionsDisabled}
              onClick={() => onEditMessage(messageId)}
            >
              <Pencil />
            </MessageAction>
          )}
        </div>
      )}
    </div>
  );
}

function MessageAction({
  label,
  className,
  disabled,
  onClick,
  children,
}: {
  label: string;
  className: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        "absolute size-6 text-muted-foreground opacity-60 motion-opacity hover:text-foreground sm:opacity-0 sm:group-hover/user:opacity-100 sm:group-hover/assistant:opacity-100 sm:focus:opacity-100",
        className,
      )}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
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
      className={AGENT_MARKDOWN_CLASSES}
      plugins={STREAMDOWN_PLUGINS}
      remarkPlugins={AGENT_REMARK_PLUGINS}
      allowedTags={AGENT_MARKDOWN_ALLOWED_TAGS}
      components={AGENT_MARKDOWN_COMPONENTS}
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
