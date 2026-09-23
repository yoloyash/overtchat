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
  GitBranch,
  ListChecks,
  Minimize2,
  Play,
  Terminal,
  Loader2,
  Square,
  Volume2,
} from "lucide-react";
import { stripMarkdown } from "@/lib/chat/message";
import { motionClasses } from "@/lib/motion";
import type { useSpeech } from "@/lib/useSpeech";
import { Button } from "@/components/ui/button";
import {
  MessageActions,
  MessageActionButton,
} from "@/components/chat/MessageActions";
import { toast } from "@/components/ui/toast";
import {
  STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  STREAMDOWN_PLUGINS,
} from "@/lib/chat/markdown";
import { remarkAgentLinks } from "@/lib/agents/links";
import {
  agentActivitySequencePosition,
  agentActiveTurnStart,
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
import { AgentForkMenu } from "./AgentForkMenu";
import { AgentRewindMenu } from "./AgentRewindMenu";
import type { AgentRewindMode } from "@overtchat/agent-bridge";
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
  speech,
  providerLabel,
  question,
  messages,
  streaming,
  activity,
  activityStartedAt,
  error,
  workspaceName,
  rewindOptions,
  canForkMessages,
  actionsDisabled,
  suppressScrollButton,
  onRewindMessage,
  onForkMessage,
  onImplementPlan,
}: {
  speech: ReturnType<typeof useSpeech>;
  providerLabel: string;
  question?: React.ReactNode;
  messages: unknown[];
  streaming: boolean;
  activity: AgentRunActivity | null;
  activityStartedAt: number | null;
  error?: string;
  workspaceName: string;
  rewindOptions: Array<{ mode: AgentRewindMode; label: string }>;
  canForkMessages: boolean;
  actionsDisabled: boolean;
  suppressScrollButton: boolean;
  onRewindMessage: (messageId: string, mode: AgentRewindMode) => Promise<void>;
  onForkMessage: (messageId: string, chooseWorkspace?: boolean) => void;
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
  const footerMessageIds = useMemo(
    () => new Set(
      transcript.flatMap((item) =>
        item.type === "turn_footer" && item.messageId ? [item.messageId] : [],
      ),
    ),
    [transcript],
  );
  const transcriptGroups = useMemo(() => {
    const groups: Array<Array<{ item: AgentTranscriptItem; index: number }>> = [];
    transcript.forEach((item, index) => {
      const previousGroup = groups.at(-1);
      const previousItem = previousGroup?.at(-1)?.item;
      if (
        previousGroup &&
        item.type === "turn_footer" &&
        item.messageId !== null &&
        previousItem?.type === "assistant_text" &&
        previousItem.messageId === item.messageId
      ) {
        previousGroup.push({ item, index });
      } else {
        groups.push([{ item, index }]);
      }
    });
    return groups;
  }, [transcript]);
  const trailingItem = transcript.at(-1);
  const activeTurnStart = agentActiveTurnStart(transcript, streaming);
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
          {messages.length === 0 && !error && !activity && !question ? (
            <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
              <Terminal className="size-6 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{workspaceName}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                New {providerLabel} session
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              {transcriptGroups.map((group) => (
                <div className="group flex flex-col" key={group[0].item.key}>
                  {group.map(({ item, index }) => {
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
                          speech={speech}
                          item={item}
                          active={streaming && index === transcript.length - 1}
                          turnActive={index >= activeTurnStart}
                          hasTurnFooter={
                            item.type === "assistant_text" &&
                            item.messageId !== null &&
                            footerMessageIds.has(item.messageId)
                          }
                          rewindOptions={rewindOptions}
                          canForkMessages={canForkMessages}
                          actionsDisabled={actionsDisabled}
                          onRewindMessage={onRewindMessage}
                          onForkMessage={onForkMessage}
                          onImplementPlan={onImplementPlan}
                          activitySequencePosition={sequencePosition}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
              {activity && !question && !activityAlreadyVisible && (
                <AgentRunIndicator
                  activity={activity}
                  startedAt={activityStartedAt}
                  providerLabel={providerLabel}
                />
              )}
              {question && <div className="mt-4">{question}</div>}
              {error && <AgentErrorNotice error={presentAgentError(error)} />}
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
  speech,
  item,
  active,
  turnActive,
  hasTurnFooter,
  rewindOptions,
  canForkMessages,
  actionsDisabled,
  onRewindMessage,
  onForkMessage,
  onImplementPlan,
  activitySequencePosition,
}: {
  speech: ReturnType<typeof useSpeech>;
  item: AgentTranscriptItem;
  active: boolean;
  turnActive: boolean;
  hasTurnFooter: boolean;
  rewindOptions: Array<{ mode: AgentRewindMode; label: string }>;
  canForkMessages: boolean;
  actionsDisabled: boolean;
  onRewindMessage: (messageId: string, mode: AgentRewindMode) => Promise<void>;
  onForkMessage: (messageId: string, chooseWorkspace?: boolean) => void;
  onImplementPlan: (plan: string) => void;
  activitySequencePosition: AgentActivitySequencePosition | null;
}) {
  if (item.type === "message") {
    return (
      <AgentMessage
        message={item.message}
        rewindOptions={rewindOptions}
        actionsDisabled={actionsDisabled}
        onRewindMessage={onRewindMessage}
      />
    );
  }
  if (item.type === "assistant_text") {
    return (
      <div className="group/assistant relative text-sm leading-relaxed">
        <Markdown streaming={active}>{item.text}</Markdown>
        {!hasTurnFooter && (
          <div className="mt-2">
            <MessageActions show={!turnActive}>
              <AgentCopyButton text={item.text} disabled={actionsDisabled} />
              <AgentSpeakButton id={item.key} text={item.text} speech={speech} />
              {canForkMessages && item.actionable && item.messageId && (
                <AgentForkMenu
                  disabled={actionsDisabled}
                  onFork={(chooseWorkspace) =>
                    onForkMessage(item.messageId!, chooseWorkspace)
                  }
                />
              )}
            </MessageActions>
          </div>
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
        speech={speech}
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
        speech={speech}
        active={turnActive}
        item={item}
        disabled={actionsDisabled || turnActive}
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
  speech,
  item,
  canFork,
  actionsDisabled,
  onForkMessage,
}: {
  speech: ReturnType<typeof useSpeech>;
  item: Extract<AgentTranscriptItem, { type: "turn_footer" }>;
  canFork: boolean;
  actionsDisabled: boolean;
  onForkMessage: (messageId: string, chooseWorkspace?: boolean) => void;
}) {
  const showFork = canFork && item.messageId !== null;

  if (!item.text && !showFork && item.durationMs === null) return null;

  return (
    <div
      className="flex min-h-7 items-center gap-1 text-xs text-muted-foreground"
      data-testid="agent-turn-footer"
    >
      <MessageActions show={!!item.text || showFork}>
        {item.text && (
          <>
            <AgentCopyButton text={item.text} disabled={actionsDisabled} />
            <AgentSpeakButton id={item.key} text={item.text} speech={speech} />
          </>
        )}
        {showFork && (
          <AgentForkMenu
            disabled={actionsDisabled}
            onFork={(chooseWorkspace) =>
              onForkMessage(item.messageId!, chooseWorkspace)
            }
          />
        )}
      </MessageActions>
      {item.durationMs !== null && (
        <span className="ml-1 tabular-nums">
          Worked for {formatAgentElapsed(item.durationMs)}
        </span>
      )}
    </div>
  );
}

function AgentPlanCard({
  speech,
  active,
  item,
  disabled,
  onImplement,
}: {
  speech: ReturnType<typeof useSpeech>;
  active: boolean;
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
        {!active && (
          <div className="mt-1">
            <AgentSpeakButton id={item.key} text={item.text} speech={speech} />
          </div>
        )}
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

function AgentSpeakButton({
  id,
  text,
  speech,
}: {
  id: string;
  text: string;
  speech: ReturnType<typeof useSpeech>;
}) {
  const spokenText = useMemo(() => stripMarkdown(text), [text]);
  if (!spokenText) return null;
  const active = speech.activeId === id;
  const loading = active && speech.status === "loading";
  const tooLong = spokenText.length > 5_000;
  const label = active
    ? loading ? "Cancel loading speech" : "Stop reading"
    : tooLong ? "Read aloud supports up to 5,000 characters" : "Read aloud";
  return (
    <MessageActionButton
      label={label}
      disabled={!active && tooLong}
      onClick={() => void speech.play(id, spokenText)}
      icon={loading ? (
        <Loader2 className={cn("size-3.5", motionClasses.spinner)} />
      ) : active ? (
        <Square className="size-3.5" />
      ) : (
        <Volume2 className="size-3.5" />
      )}
    />
  );
}

function AgentCopyButton({ text, disabled }: { text: string; disabled: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <MessageActionButton
      label={copied ? "Copied response" : "Copy response"}
      icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      disabled={disabled}
      onClick={() => {
        void clipboardWriteText(text)
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
      }}
    />
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
  rewindOptions,
  actionsDisabled,
  onRewindMessage,
}: {
  message: unknown;
  rewindOptions: Array<{ mode: AgentRewindMode; label: string }>;
  actionsDisabled: boolean;
  onRewindMessage: (messageId: string, mode: AgentRewindMode) => Promise<void>;
}) {
  const record = recordOf(message);
  if (!record) return null;
  const role = roleOf(message);
  if (role === "user") {
    return (
      <UserMessage
        content={contentOf(message)}
        messageId={
          record.overtchatRewindable !== false && typeof record.id === "string"
            ? record.id
            : null
        }
        rewindOptions={rewindOptions}
        actionsDisabled={actionsDisabled}
        onRewindMessage={onRewindMessage}
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
  rewindOptions,
  actionsDisabled,
  onRewindMessage,
}: {
  content: unknown;
  messageId: string | null;
  rewindOptions: Array<{ mode: AgentRewindMode; label: string }>;
  actionsDisabled: boolean;
  onRewindMessage: (messageId: string, mode: AgentRewindMode) => Promise<void>;
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
      {(text || images.length > 0) && (
        <div className="relative min-w-0 max-w-[80%]">
          {text && (
            <div className="rounded-2xl bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap wrap-anywhere text-secondary-foreground">
              {text}
            </div>
          )}
          {messageId && !messageId.startsWith("submission:") && (
            <div className="absolute right-full bottom-0 mr-1 opacity-0 motion-opacity group-hover/user:opacity-100 group-focus-within/user:opacity-100 has-[[data-popup-open]]:opacity-100 [@media(hover:none)]:opacity-100">
              <AgentRewindMenu
                options={rewindOptions}
                disabled={actionsDisabled}
                onRewind={(mode) => onRewindMessage(messageId, mode)}
              />
            </div>
          )}
        </div>
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
