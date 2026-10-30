import type {
  AgentRuntimeSnapshot,
  AgentRuntimeStatus,
  AgentSessionAttention,
  AgentTurnSummary,
} from "@overtchat/agent-bridge";
import { AGENT_STATUS_TEXT_LIMIT } from "@overtchat/agent-bridge";
import { approvalDetails } from "@overtchat/shared/agent-tool-details";

type PendingInteraction = NonNullable<AgentRuntimeSnapshot["pendingInteraction"]>;

/** Collapses whitespace and clips text to the status limit. */
export function statusText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > AGENT_STATUS_TEXT_LIMIT
    ? `${text.slice(0, AGENT_STATUS_TEXT_LIMIT - 1).trimEnd()}…`
    : text;
}

/** Reduces assistant markdown to the prose a reader sees first. */
export function previewText(markdown: string): string {
  return statusText(
    markdown
      .replace(/```[^\n]*\n?/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
      .replace(/(?<!\w)(\*\*|__|\*|_|~~)(?=\S)([^\n]*?\S)\1(?!\w)/g, "$2")
      .replace(/`/g, ""),
  );
}

function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = Reflect.get(message, "content");
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part) =>
        part &&
        typeof part === "object" &&
        Reflect.get(part, "type") === "text" &&
        typeof Reflect.get(part, "text") === "string",
    )
    .map((part) => Reflect.get(part, "text") as string)
    .join("\n");
}

/** The error of an assistant message its provider ended with an error. */
export function assistantMessageError(message: unknown): string | undefined {
  if (
    !message ||
    typeof message !== "object" ||
    Reflect.get(message, "role") !== "assistant" ||
    Reflect.get(message, "stopReason") !== "error"
  ) {
    return undefined;
  }
  const error = Reflect.get(message, "errorMessage");
  return typeof error === "string" && error.trim() ? error : "The model request failed.";
}

/** Preview of the newest assistant message that has visible text. */
export function lastAssistantPreview(messages: readonly unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      !message ||
      typeof message !== "object" ||
      Reflect.get(message, "role") !== "assistant"
    ) {
      continue;
    }
    const preview = previewText(messageText(message));
    if (preview) return preview;
  }
  return undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Summarizes a pending request for lists and notifications. */
export function sessionAttention(
  request: PendingInteraction,
  requestedAt: number,
): AgentSessionAttention {
  if (request.approvalKind === "tool") {
    const details = approvalDetails(request);
    const command = details.sections.find((section) => section.label === "Command")?.value;
    const detail = command
      ? shellCommand(command)
      : (details.sections.find((section) => section.label === "Path")?.value ??
        changedFiles(request.toolDetail));
    return {
      kind: "approval",
      id: request.id,
      requestedAt,
      title: statusText(details.title.replace(/\?$/, "")),
      ...optionalDetail(detail || details.message),
    };
  }
  return {
    kind: "question",
    id: request.id,
    requestedAt,
    title: statusText(text(request.title)) || "Needs your input",
    ...optionalDetail(text(request.message)),
  };
}

/** Unwraps the `zsh -lc "…"` style wrapper some providers report. */
export function shellCommand(command: string): string {
  const wrapped = /^(?:\S*\/)?(?:ba|z)?sh -l?c (["'])([\s\S]*)\1$/u.exec(command.trim());
  if (!wrapped) return command;
  const [, quote, inner] = wrapped;
  return quote === '"' ? inner!.replace(/\\(["\\$`])/gu, "$1") : inner!;
}

/** Names the files of a multi-file edit approval. */
function changedFiles(toolDetail: unknown): string | undefined {
  const changes: unknown = toolDetail && typeof toolDetail === "object"
    ? Reflect.get(toolDetail, "changes")
    : undefined;
  if (!Array.isArray(changes)) return undefined;
  const paths = changes
    .map((change) =>
      change && typeof change === "object" ? text(Reflect.get(change, "filePath")) : "",
    )
    .filter(Boolean);
  if (!paths.length) return undefined;
  return paths.length === 1
    ? paths[0]
    : `${paths[0]} and ${paths.length - 1} more`;
}

function optionalDetail(value: string | undefined): { detail?: string } {
  const detail = value ? statusText(value) : "";
  return detail ? { detail } : {};
}

type TurnObservation = {
  status: AgentRuntimeStatus;
  startedAt: number | null;
  error: string | undefined;
};

/**
 * Derives turn outcomes from runtime status transitions. The turn's own error
 * is recorded while it runs: settling the turn clears the runtime error, and
 * the runtime error can belong to another command.
 */
export class AgentTurnTracker {
  private status: AgentRuntimeStatus;
  private startedAt: number | null;
  private error: string | undefined;
  private failed = false;
  private replyError: string | undefined;
  private stopRequested = false;
  private summary: AgentTurnSummary | undefined;

  constructor(status: AgentRuntimeStatus, startedAt: number | null) {
    this.status = status;
    this.startedAt = status === "running" ? startedAt : null;
  }

  get lastTurn(): AgentTurnSummary | undefined {
    return this.summary;
  }

  /** A provider reported the active turn as failed without a runtime error. */
  markFailed(): void {
    if (this.status === "running") this.failed = true;
  }

  /**
   * The turn's own command failed. Kept until the turn ends, because settling
   * the turn clears the runtime error. Other commands failing mid-turn (a
   * steer, a compaction, a state refresh) leave the turn to end on its own.
   */
  observeError(error: string): void {
    if (this.status === "running") this.error = error;
  }

  /**
   * Records a finished assistant message. Providers can retry or fall back to
   * another model within a turn, so only the latest reply's error counts.
   */
  observeReply(message: unknown): void {
    if (
      this.status !== "running" ||
      !message ||
      typeof message !== "object" ||
      Reflect.get(message, "role") !== "assistant"
    ) {
      return;
    }
    this.replyError = assistantMessageError(message);
  }

  /** The user asked to stop; a turn ending before `cancelStop` was stopped. */
  requestStop(): void {
    if (this.status === "running") this.stopRequested = true;
  }

  cancelStop(): void {
    this.stopRequested = false;
  }

  /** Returns true when the observation ended a turn. */
  observe(
    observation: TurnObservation,
    messages: () => readonly unknown[],
    now = Date.now(),
  ): boolean {
    const previous = this.status;
    this.status = observation.status;
    if (observation.status === "running") {
      if (previous !== "running") {
        this.startedAt = observation.startedAt ?? now;
        this.error = undefined;
        this.failed = false;
        this.replyError = undefined;
        this.stopRequested = false;
      }
      return false;
    }
    if (previous !== "running") return false;
    // Only an exit's error is the turn's; another command may have left one.
    const error =
      this.error ??
      (observation.status === "exited" ? observation.error : undefined) ??
      this.replyError;
    const preview = lastAssistantPreview(messages());
    this.summary = {
      outcome: this.stopRequested
        ? "stopped"
        : error || this.failed || observation.status === "exited"
          ? "failed"
          : "completed",
      startedAt: this.startedAt,
      endedAt: now,
      ...(preview ? { preview } : {}),
      ...(error && !this.stopRequested ? { error: statusText(error) } : {}),
    };
    this.startedAt = null;
    this.error = undefined;
    this.failed = false;
    this.replyError = undefined;
    this.stopRequested = false;
    return true;
  }
}
