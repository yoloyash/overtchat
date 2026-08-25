type UnknownRecord = Record<string, unknown>;

export type AgentToolCategory =
  | "shell"
  | "read"
  | "edit"
  | "write"
  | "search"
  | "fetch"
  | "other";

export type AgentToolActivity = {
  id: string;
  name: string;
  args: unknown;
  output: string;
  hasResult: boolean;
  partial: boolean;
  isError: boolean;
  direct: boolean;
  exitCode: number | null;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath: string | null;
  terminalInputs: string[];
};

export type AgentSubagentActivity = {
  id: string;
  action: string;
  prompt: string | null;
  status: string;
  receivers: Array<{
    threadId: string;
    status: string;
    message: string | null;
  }>;
  events: string[];
};

export type AgentActivityEntry =
  | {
      type: "thinking";
      id: string;
      content: string;
    }
  | {
      type: "tool";
      id: string;
      tool: AgentToolActivity;
    }
  | {
      type: "subagent";
      id: string;
      activity: AgentSubagentActivity;
    };

export type AgentErrorPresentation = {
  summary: string;
  details: string | null;
};

export type AgentTaskStatus = "pending" | "in_progress" | "completed";

export type AgentTask = {
  id: string;
  step: string;
  status: AgentTaskStatus;
};

export type AgentTaskListSnapshot = {
  id: string;
  explanation: string | null;
  tasks: AgentTask[];
};

export type AgentTranscriptItem =
  | {
      type: "message";
      key: string;
      message: unknown;
    }
  | {
      type: "assistant_text";
      key: string;
      text: string;
      messageId: string | null;
      actionable: boolean;
    }
  | {
      type: "assistant_error";
      key: string;
      error: AgentErrorPresentation;
    }
  | {
      type: "activity";
      key: string;
      entries: AgentActivityEntry[];
    }
  | {
      type: "turn_footer";
      key: string;
      text: string;
      durationMs: number | null;
      messageId: string | null;
    }
  | {
      type: "plan";
      key: string;
      text: string;
      explanation: string | null;
      actionable: boolean;
      steps: Array<{
        step: string;
        status: string;
      }>;
    }
  | {
      type: "task_list";
      key: string;
      snapshot: AgentTaskListSnapshot;
    };

export type AgentToolStatus =
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export type AgentToolPresentation = {
  category: AgentToolCategory;
  label: string;
  summary: string | null;
};

export type AgentActivityPresentation = {
  label: string;
  secondary: string | null;
  status: AgentToolStatus;
};

export type AgentActivitySequencePosition =
  | "single"
  | "first"
  | "middle"
  | "last";

/**
 * Activity stays individually addressable, but adjacent activity rows form one
 * visual sequence. Any conversational or turn-level item is a hard boundary.
 */
export function agentActivitySequencePosition(
  items: readonly AgentTranscriptItem[],
  index: number,
): AgentActivitySequencePosition | null {
  if (items[index]?.type !== "activity") return null;
  const hasPrevious = items[index - 1]?.type === "activity";
  const hasNext = items[index + 1]?.type === "activity";
  if (hasPrevious && hasNext) return "middle";
  if (hasPrevious) return "last";
  if (hasNext) return "first";
  return "single";
}

function isGroupableToolActivity(
  item: AgentTranscriptItem,
): item is Extract<AgentTranscriptItem, { type: "activity" }> {
  return (
    item.type === "activity" &&
    item.entries.length > 0 &&
    item.entries.every(
      (entry) =>
        entry.type === "tool" && normalizedToolName(entry.tool.name) !== "speak",
    )
  );
}

/**
 * Consecutive tool calls share one expandable summary in the transcript. The
 * raw entries remain intact inside that summary, and any non-tool item seals
 * the current run.
 */
export function groupAgentToolActivity(
  items: readonly AgentTranscriptItem[],
): AgentTranscriptItem[] {
  const grouped: AgentTranscriptItem[] = [];
  let pending: Array<Extract<AgentTranscriptItem, { type: "activity" }>> = [];

  const flush = () => {
    const first = pending[0];
    if (!first) return;
    grouped.push(
      pending.length === 1
        ? first
        : {
            ...first,
            entries: pending.flatMap((item) => item.entries),
          },
    );
    pending = [];
  };

  for (const item of items) {
    if (isGroupableToolActivity(item)) {
      pending.push(item);
      continue;
    }
    flush();
    grouped.push(item);
  }
  flush();
  return grouped;
}

function recordOf(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function normalizeTaskStatus(value: unknown): AgentTaskStatus {
  if (value === "completed") return "completed";
  if (value === "inProgress" || value === "in_progress") {
    return "in_progress";
  }
  return "pending";
}

function taskListSnapshot(
  value: unknown,
  fallbackId: string,
): AgentTaskListSnapshot | null {
  const part = recordOf(value);
  if (part?.type !== "taskList" || !Array.isArray(part.items)) return null;
  const id = typeof part.id === "string" ? part.id : fallbackId;
  return {
    id,
    explanation:
      typeof part.explanation === "string" ? part.explanation : null,
    tasks: part.items.flatMap((value, index) => {
      const task = recordOf(value);
      const step =
        typeof task?.step === "string"
          ? task.step
          : typeof task?.text === "string"
            ? task.text
            : null;
      return step
        ? [{
            id: typeof task?.id === "string" ? task.id : `${id}:${index}`,
            step,
            status: normalizeTaskStatus(task?.status),
          }]
        : [];
    }),
  };
}

export function latestAgentTaskList(
  messages: readonly unknown[],
): AgentTaskListSnapshot | null {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = recordOf(messages[messageIndex]);
    if (message?.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }
    for (
      let partIndex = message.content.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const snapshot = taskListSnapshot(
        message.content[partIndex],
        `task-list:${messageIndex}:${partIndex}`,
      );
      if (snapshot) return snapshot;
    }
  }
  return null;
}

function roleOf(message: unknown): string {
  return String(recordOf(message)?.role ?? "");
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

const MAX_ERROR_SUMMARY_LENGTH = 240;

export function presentAgentError(value: string): AgentErrorPresentation {
  const details = value.trim();
  const contextLimit =
    /maximum context length|context length.{0,80}(?:exceed|requested)|input_tokens/iu.test(
      details,
    );
  let summary = contextLimit
    ? "Context limit exceeded. Compact the conversation or reduce the maximum output tokens."
    : (details.split(/\r?\n/u).find((line) => line.trim())?.trim() ??
      "The agent command failed.");
  if (summary.length > MAX_ERROR_SUMMARY_LENGTH) {
    summary = `${summary.slice(0, MAX_ERROR_SUMMARY_LENGTH - 3).trimEnd()}...`;
  }
  return {
    summary,
    details: summary === details ? null : details,
  };
}

function messageIdentity(message: unknown, index: number): string {
  const record = recordOf(message);
  return String(
    record?.id ?? record?.toolCallId ?? record?.timestamp ?? index,
  );
}

function resultId(message: unknown): string | null {
  const record = recordOf(message);
  return roleOf(message) === "toolResult" &&
    typeof record?.toolCallId === "string"
    ? record.toolCallId
    : null;
}

function collectToolData(messages: unknown[]) {
  const callIds = new Set<string>();
  const results = new Map<string, UnknownRecord>();

  for (const message of messages) {
    const record = recordOf(message);
    if (!record) continue;
    if (roleOf(message) === "assistant" && Array.isArray(record.content)) {
      for (const part of record.content) {
        const content = recordOf(part);
        if (
          content?.type === "toolCall" &&
          typeof content.id === "string"
        ) {
          callIds.add(content.id);
        }
      }
    }
    const id = resultId(message);
    if (id) results.set(id, record);
  }

  return { callIds, results };
}

function toolFromCall(
  part: UnknownRecord,
  result: UnknownRecord | undefined,
  fallbackId: string,
): AgentToolActivity {
  const id = typeof part.id === "string" ? part.id : fallbackId;
  return {
    id,
    name:
      typeof part.name === "string"
        ? part.name
        : typeof result?.toolName === "string"
          ? result.toolName
          : "tool",
    args: part.arguments,
    output: result ? textOfContent(result.content) : "",
    hasResult: Boolean(result),
    partial: result?.overtchatPartial === true,
    isError: result?.isError === true,
    direct: false,
    exitCode: null,
    cancelled: false,
    truncated: false,
    fullOutputPath: null,
    terminalInputs: Array.isArray(part.terminalInputs)
      ? part.terminalInputs.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  };
}

function toolFromResult(
  result: UnknownRecord,
  fallbackId: string,
): AgentToolActivity {
  const id =
    typeof result.toolCallId === "string" ? result.toolCallId : fallbackId;
  return {
    id,
    name: typeof result.toolName === "string" ? result.toolName : "tool",
    args: undefined,
    output: textOfContent(result.content),
    hasResult: true,
    partial: result.overtchatPartial === true,
    isError: result.isError === true,
    direct: false,
    exitCode: null,
    cancelled: false,
    truncated: false,
    fullOutputPath: null,
    terminalInputs: [],
  };
}

function directShellTool(
  message: UnknownRecord,
  fallbackId: string,
): AgentToolActivity {
  return {
    id: fallbackId,
    name: "bash",
    args: {
      command: typeof message.command === "string" ? message.command : "",
    },
    output: typeof message.output === "string" ? message.output : "",
    hasResult: true,
    partial: false,
    isError:
      message.cancelled === true ||
      (typeof message.exitCode === "number" && message.exitCode !== 0),
    direct: true,
    exitCode:
      typeof message.exitCode === "number" ? message.exitCode : null,
    cancelled: message.cancelled === true,
    truncated: message.truncated === true,
    fullOutputPath:
      typeof message.fullOutputPath === "string"
        ? message.fullOutputPath
        : null,
    terminalInputs: [],
  };
}

export function projectAgentTranscript(
  messages: unknown[],
): AgentTranscriptItem[] {
  const items: AgentTranscriptItem[] = [];
  const { callIds, results } = collectToolData(messages);
  const footerMessageIds = new Set(
    messages.flatMap((message) => {
      const record = recordOf(message);
      return record?.role === "turnFooter" &&
        typeof record.messageId === "string"
        ? [record.messageId]
        : [];
    }),
  );

  const pushActivity = (entry: AgentActivityEntry) => {
    items.push({
      type: "activity",
      key: `activity:${entry.id}`,
      entries: [entry],
    });
  };

  messages.forEach((message, messageIndex) => {
    const record = recordOf(message);
    if (!record) return;
    const role = roleOf(message);
    const identity = messageIdentity(message, messageIndex);

    if (role === "assistant") {
      const content = Array.isArray(record.content) ? record.content : [];
      const messageId =
        typeof record.overtchatTurnBoundaryId === "string"
          ? record.overtchatTurnBoundaryId
          : typeof record.id === "string"
            ? record.id
            : null;
      const actionsOwnedByFooter =
        typeof record.overtchatTurnBoundaryId === "string";
      const lastTextIndex = content.findLastIndex((part) => {
        const candidate = recordOf(part);
        return (
          (candidate?.type === "text" || candidate?.type === "commentary") &&
          typeof candidate.text === "string" &&
          candidate.text.trim().length > 0
        );
      });
      content.forEach((part, partIndex) => {
        const partRecord = recordOf(part);
        if (!partRecord) return;
        const partIdentity =
          typeof partRecord.id === "string"
            ? partRecord.id
            : `${identity}:${partIndex}`;

        if (
          partRecord.type === "plan" &&
          typeof partRecord.text === "string"
        ) {
          items.push({
            type: "plan",
            key: `plan:${typeof partRecord.id === "string" ? partRecord.id : partIdentity}`,
            text: partRecord.text,
            explanation:
              typeof partRecord.explanation === "string"
                ? partRecord.explanation
                : null,
            actionable: partRecord.actionable === true,
            steps: Array.isArray(partRecord.steps)
              ? partRecord.steps.flatMap((value) => {
                  const step = recordOf(value);
                  return typeof step?.step === "string"
                    ? [
                        {
                          step: step.step,
                          status:
                            typeof step.status === "string"
                              ? step.status
                              : "pending",
                        },
                      ]
                    : [];
                })
              : [],
          });
          return;
        }

        const tasks = taskListSnapshot(partRecord, partIdentity);
        if (tasks) {
          if (tasks.tasks.length > 0) {
            items.push({
              type: "task_list",
              key: `task-list:${tasks.id}`,
              snapshot: tasks,
            });
          }
          return;
        }

        if (
          partRecord.type === "subagent" &&
          typeof partRecord.id === "string"
        ) {
          pushActivity({
            type: "subagent",
            id: `subagent:${partRecord.id}`,
            activity: {
              id: partRecord.id,
              action:
                typeof partRecord.action === "string"
                  ? partRecord.action
                  : "agent",
              prompt:
                typeof partRecord.prompt === "string"
                  ? partRecord.prompt
                  : null,
              status:
                typeof partRecord.status === "string"
                  ? partRecord.status
                  : "completed",
              receivers: Array.isArray(partRecord.receivers)
                ? partRecord.receivers.flatMap((value) => {
                    const receiver = recordOf(value);
                    return typeof receiver?.threadId === "string"
                      ? [
                          {
                            threadId: receiver.threadId,
                            status:
                              typeof receiver.status === "string"
                                ? receiver.status
                                : "unknown",
                            message:
                              typeof receiver.message === "string"
                                ? receiver.message
                                : null,
                          },
                        ]
                      : [];
                  })
                : [],
              events: Array.isArray(partRecord.events)
                ? partRecord.events.filter(
                    (value): value is string => typeof value === "string",
                  )
                : [],
            },
          });
          return;
        }

        if (
          partRecord.type === "commentary" &&
          typeof partRecord.text === "string" &&
          partRecord.text.trim()
        ) {
          items.push({
            type: "assistant_text",
            key: `assistant:${partIdentity}`,
            text: partRecord.text,
            messageId,
            actionable:
              partIndex === lastTextIndex &&
              messageId !== null &&
              !actionsOwnedByFooter &&
              !footerMessageIds.has(messageId),
          });
          return;
        }

        if (
          partRecord.type === "thinking" &&
          typeof partRecord.thinking === "string" &&
          partRecord.thinking.trim()
        ) {
          pushActivity({
            type: "thinking",
            id: `thinking:${partIdentity}`,
            content: partRecord.thinking,
          });
          return;
        }

        if (
          partRecord.type === "toolCall" &&
          typeof partRecord.name === "string"
        ) {
          const id =
            typeof partRecord.id === "string"
              ? partRecord.id
              : `tool:${partIdentity}`;
          pushActivity({
            type: "tool",
            id: `tool:${id}`,
            tool: toolFromCall(partRecord, results.get(id), id),
          });
          return;
        }

        if (
          partRecord.type === "text" &&
          typeof partRecord.text === "string" &&
          partRecord.text.trim()
        ) {
          items.push({
            type: "assistant_text",
            key: `assistant:${partIdentity}`,
            text: partRecord.text,
            messageId,
            actionable:
              partIndex === lastTextIndex &&
              messageId !== null &&
              !actionsOwnedByFooter &&
              !footerMessageIds.has(messageId),
          });
        }
      });

      if (
        typeof record.errorMessage === "string" &&
        record.errorMessage.trim()
      ) {
        items.push({
          type: "assistant_error",
          key: `assistant-error:${identity}`,
          error: presentAgentError(record.errorMessage),
        });
      }
      return;
    }

    if (role === "turnFooter") {
      if (
        typeof record.errorMessage === "string" &&
        record.errorMessage.trim()
      ) {
        items.push({
          type: "assistant_error",
          key: `assistant-error:${identity}`,
          error: presentAgentError(record.errorMessage),
        });
      }
      const durationMs = record.durationMs;
      items.push({
        type: "turn_footer",
        key: `turn-footer:${identity}`,
        text: typeof record.content === "string" ? record.content : "",
        durationMs:
          typeof durationMs === "number" &&
          Number.isFinite(durationMs) &&
          durationMs >= 0
            ? durationMs
            : null,
        messageId:
          typeof record.messageId === "string" ? record.messageId : null,
      });
      return;
    }

    if (role === "toolResult") {
      const id = resultId(message);
      if (!id || callIds.has(id)) return;
      pushActivity({
        type: "tool",
        id: `tool:${id}`,
        tool: toolFromResult(record, id),
      });
      return;
    }

    if (role === "bashExecution") {
      const id = `bash:${identity}`;
      pushActivity({
        type: "tool",
        id,
        tool: directShellTool(record, id),
      });
      return;
    }

    if (role === "custom" && record.display === false) return;

    items.push({
      type: "message",
      key: `${role || "message"}:${identity}:${messageIndex}`,
      message,
    });
  });
  return groupAgentToolActivity(items);
}

function normalizedToolName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return normalized.split("__").filter(Boolean).at(-1) ?? normalized;
}

function hasName(name: string, candidates: string[]): boolean {
  return candidates.some(
    (candidate) => name === candidate || name.endsWith(`_${candidate}`),
  );
}

function stringArgument(args: unknown, keys: string[]): string | null {
  const record = recordOf(args);
  if (!record) return null;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) {
      return record[key];
    }
  }
  return null;
}

function humanizeToolName(name: string): string {
  const normalized = name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._:/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Tool";
  return normalized
    .split(" ")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function describeAgentTool(
  tool: AgentToolActivity,
): AgentToolPresentation {
  const name = normalizedToolName(tool.name);
  if (hasName(name, ["bash", "shell", "terminal", "exec", "execute"])) {
    return {
      category: "shell",
      label: "Terminal",
      summary: stringArgument(tool.args, ["command", "cmd"]),
    };
  }
  if (hasName(name, ["read", "read_file", "readfile"])) {
    return {
      category: "read",
      label: "Read",
      summary: stringArgument(tool.args, ["path", "filePath", "file_path"]),
    };
  }
  if (
    hasName(name, [
      "edit",
      "edit_file",
      "apply_patch",
      "patch",
      "replace",
    ])
  ) {
    return {
      category: "edit",
      label: "Edit",
      summary: stringArgument(tool.args, ["path", "filePath", "file_path"]),
    };
  }
  if (hasName(name, ["write", "write_file", "create_file"])) {
    return {
      category: "write",
      label: "Write",
      summary: stringArgument(tool.args, ["path", "filePath", "file_path"]),
    };
  }
  if (
    hasName(name, [
      "search",
      "web_search",
      "websearch",
      "grep",
      "glob",
      "find",
      "list",
      "ls",
    ])
  ) {
    return {
      category: "search",
      label: "Search",
      summary: stringArgument(tool.args, [
        "query",
        "pattern",
        "path",
        "url",
      ]),
    };
  }
  if (hasName(name, ["fetch", "web_fetch", "webfetch", "fetch_url"])) {
    return {
      category: "fetch",
      label: "Fetch",
      summary: stringArgument(tool.args, ["url"]),
    };
  }
  return {
    category: "other",
    label: humanizeToolName(tool.name),
    summary: null,
  };
}

export function agentToolStatus(
  tool: AgentToolActivity,
  active: boolean,
): AgentToolStatus {
  if (tool.isError || tool.cancelled) return "failed";
  if (tool.partial) return "running";
  if (tool.hasResult) return "completed";
  return active ? "running" : "stopped";
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function naturalList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

export function describeAgentActivity(
  entries: AgentActivityEntry[],
  active: boolean,
): AgentActivityPresentation {
  const tools = entries.flatMap((entry) =>
    entry.type === "tool" ? [entry.tool] : [],
  );
  if (tools.length === 0) {
    const subagents = entries.filter((entry) => entry.type === "subagent");
    if (subagents.length > 0) {
      const running = subagents.some((entry) =>
        ["inProgress", "pendingInit", "running"].includes(
          entry.activity.status,
        ),
      );
      return {
        label: running
          ? `Running ${plural(subagents.length, "subagent")}`
          : `Used ${plural(subagents.length, "subagent")}`,
        secondary: null,
        status: running ? "running" : "completed",
      };
    }
    return {
      label: active ? "Thinking" : "Thoughts",
      secondary: null,
      status: active ? "running" : "completed",
    };
  }

  const statuses = tools.map((tool) => agentToolStatus(tool, active));
  const status: AgentToolStatus = statuses.includes("running")
    ? "running"
    : statuses.includes("failed")
      ? "failed"
      : statuses.includes("stopped")
        ? "stopped"
        : "completed";

  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();
  let commandCount = 0;
  let searchCount = 0;
  let otherToolCount = 0;
  for (const tool of tools) {
    const presentation = describeAgentTool(tool);
    const identity = presentation.summary?.trim() || `tool:${tool.id}`;
    switch (presentation.category) {
      case "edit":
      case "write":
        editedFiles.add(identity);
        break;
      case "shell":
        commandCount += 1;
        break;
      case "read":
        readFiles.add(identity);
        break;
      case "search":
        searchCount += 1;
        break;
      case "fetch":
      case "other":
        otherToolCount += 1;
        break;
    }
  }

  const summary = [
    editedFiles.size ? `edited ${plural(editedFiles.size, "file")}` : null,
    commandCount ? `ran ${plural(commandCount, "command")}` : null,
    readFiles.size ? `read ${plural(readFiles.size, "file")}` : null,
    searchCount ? `searched ${plural(searchCount, "time")}` : null,
    otherToolCount
      ? `used ${plural(otherToolCount, "other tool")}`
      : null,
  ].filter((part): part is string => part !== null);
  const failed = statuses.filter((candidate) => candidate === "failed").length;
  const stopped = statuses.filter((candidate) => candidate === "stopped").length;
  const suffix = failed
    ? `, ${plural(failed, "failed", "failed")}`
    : stopped
      ? `, ${plural(stopped, "stopped", "stopped")}`
      : "";

  return {
    label: `${capitalize(naturalList(summary))}${suffix}`,
    secondary: null,
    status,
  };
}

export function formatAgentToolDetail(tool: AgentToolActivity): string {
  const presentation = describeAgentTool(tool);
  if (presentation.category === "shell") {
    const command = presentation.summary ?? formatUnknown(tool.args);
    const sections = [command ? `$ ${command}` : ""];
    if (tool.output) sections.push(tool.output.replace(/^\n+/, ""));
    if (tool.cancelled) sections.push("Command cancelled.");
    else if (tool.exitCode !== null && tool.exitCode !== 0) {
      sections.push(`Command exited with code ${tool.exitCode}.`);
    }
    if (tool.truncated && tool.fullOutputPath) {
      sections.push(`Output truncated. Full output: ${tool.fullOutputPath}`);
    }
    return sections.filter(Boolean).join("\n\n");
  }

  const input = formatUnknown(tool.args);
  const sections = [
    input ? `Input\n${input}` : "",
    tool.output ? `Output\n${tool.output}` : "",
  ];
  return sections.filter(Boolean).join("\n\n");
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
