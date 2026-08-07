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
    };

export type AgentErrorPresentation = {
  summary: string;
  details: string | null;
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

function recordOf(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
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
  };
}

export function projectAgentTranscript(
  messages: unknown[],
): AgentTranscriptItem[] {
  const items: AgentTranscriptItem[] = [];
  const pendingActivity: AgentActivityEntry[] = [];
  const { callIds, results } = collectToolData(messages);

  const flushActivity = () => {
    if (pendingActivity.length === 0) return;
    items.push({
      type: "activity",
      key: `activity:${pendingActivity[0].id}`,
      entries: pendingActivity.splice(0),
    });
  };

  messages.forEach((message, messageIndex) => {
    const record = recordOf(message);
    if (!record) return;
    const role = roleOf(message);
    const identity = messageIdentity(message, messageIndex);

    if (role === "assistant") {
      const content = Array.isArray(record.content) ? record.content : [];
      content.forEach((part, partIndex) => {
        const partRecord = recordOf(part);
        if (!partRecord) return;
        const partIdentity = `${identity}:${partIndex}`;

        if (
          partRecord.type === "thinking" &&
          typeof partRecord.thinking === "string" &&
          partRecord.thinking.trim()
        ) {
          pendingActivity.push({
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
          pendingActivity.push({
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
          flushActivity();
          items.push({
            type: "assistant_text",
            key: `assistant:${partIdentity}`,
            text: partRecord.text,
          });
        }
      });

      if (
        typeof record.errorMessage === "string" &&
        record.errorMessage.trim()
      ) {
        flushActivity();
        items.push({
          type: "assistant_error",
          key: `assistant-error:${identity}`,
          error: presentAgentError(record.errorMessage),
        });
      }
      return;
    }

    if (role === "toolResult") {
      const id = resultId(message);
      if (!id || callIds.has(id)) return;
      pendingActivity.push({
        type: "tool",
        id: `tool:${id}`,
        tool: toolFromResult(record, id),
      });
      return;
    }

    if (role === "bashExecution") {
      const id = `bash:${identity}`;
      pendingActivity.push({
        type: "tool",
        id,
        tool: directShellTool(record, id),
      });
      return;
    }

    if (role === "custom" && record.display === false) return;

    flushActivity();
    items.push({
      type: "message",
      key: `${role || "message"}:${identity}:${messageIndex}`,
      message,
    });
  });

  flushActivity();
  return items;
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

function singleActivityLabel(
  presentation: AgentToolPresentation,
  status: AgentToolStatus,
): string {
  if (status === "failed") {
    return presentation.category === "shell"
      ? "Command failed"
      : `${presentation.label} failed`;
  }
  if (status === "stopped") {
    return presentation.category === "shell"
      ? "Command stopped"
      : `${presentation.label} stopped`;
  }
  if (status === "running") {
    switch (presentation.category) {
      case "shell":
        return "Running command";
      case "read":
        return "Reading file";
      case "edit":
        return "Editing file";
      case "write":
        return "Writing file";
      case "search":
        return "Searching";
      case "fetch":
        return "Fetching page";
      case "other":
        return `Running ${presentation.label}`;
    }
  }
  switch (presentation.category) {
    case "shell":
      return "Ran command";
    case "read":
      return "Read file";
    case "edit":
      return "Edited file";
    case "write":
      return "Wrote file";
    case "search":
      return "Searched";
    case "fetch":
      return "Fetched page";
    case "other":
      return `Used ${presentation.label}`;
  }
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
    return {
      label: active ? "Thinking" : "Thoughts",
      secondary: null,
      status: active ? "running" : "completed",
    };
  }

  const statuses = tools.map((tool) => agentToolStatus(tool, active));
  const status: AgentToolStatus = statuses.includes("failed")
    ? "failed"
    : statuses.includes("running")
      ? "running"
      : statuses.includes("stopped")
        ? "stopped"
        : "completed";

  if (tools.length === 1) {
    const presentation = describeAgentTool(tools[0]);
    return {
      label: singleActivityLabel(presentation, status),
      secondary: presentation.summary,
      status,
    };
  }

  if (status === "running") {
    const runningTools = statuses.filter(
      (candidate) => candidate === "running",
    ).length;
    return {
      label: `Running ${plural(runningTools, "tool")}`,
      secondary: null,
      status,
    };
  }

  const counts: Record<AgentToolCategory, number> = {
    shell: 0,
    read: 0,
    edit: 0,
    write: 0,
    search: 0,
    fetch: 0,
    other: 0,
  };
  for (const tool of tools) counts[describeAgentTool(tool).category] += 1;

  const summary = [
    counts.shell ? `ran ${plural(counts.shell, "command")}` : null,
    counts.read ? `read ${plural(counts.read, "file")}` : null,
    counts.edit ? `edited ${plural(counts.edit, "file")}` : null,
    counts.write ? `wrote ${plural(counts.write, "file")}` : null,
    counts.search ? `made ${plural(counts.search, "search", "searches")}` : null,
    counts.fetch ? `fetched ${plural(counts.fetch, "page")}` : null,
    counts.other ? `used ${plural(counts.other, "other tool")}` : null,
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
