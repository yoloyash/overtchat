/**
 * Claude Code subagents (the Task/Agent tool) project as the same `subagent`
 * transcript part Codex collab calls use, so every client renders both alike.
 * The part carries the launch and a bounded log of what the child did; the
 * child's own frames never enter the parent transcript.
 */

export const SUBAGENT_TOOL_NAMES = new Set(["task", "agent"]);

/** Keep the last events only; a child can run for thousands of frames. */
export const MAX_SUBAGENT_EVENTS = 200;
const MAX_TEXT_EVENT_CHARS = 4000;
const MAX_TOOL_EVENT_CHARS = 400;

export type SubagentStatus = "running" | "completed" | "failed" | "stopped";

export type SubagentPart = {
  type: "subagent";
  id: string;
  action: "task";
  prompt: string | null;
  status: SubagentStatus;
  receivers: never[];
  events: string[];
  title: string | null;
  agentType: string | null;
};

export function isSubagentTool(name: string): boolean {
  return SUBAGENT_TOOL_NAMES.has(name.toLowerCase());
}

function stringField(input: Record<string, unknown> | null, key: string): string | null {
  const value = input?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function clipEvent(text: string, limit = MAX_TEXT_EVENT_CHARS): string {
  return text.length > limit
    ? `${text.slice(0, limit)}\n… [${text.length - limit} characters truncated]`
    : text;
}

/** Build the part for a Task/Agent tool_use, keeping progress already logged. */
export function subagentLaunchPart(
  id: string,
  input: Record<string, unknown> | null,
  previous: Record<string, unknown> | null,
): SubagentPart {
  return {
    type: "subagent",
    id,
    action: "task",
    prompt: stringField(input, "prompt"),
    status: isSubagentStatus(previous?.status) ? previous.status : "running",
    receivers: [],
    events: Array.isArray(previous?.events)
      ? previous.events.filter((value): value is string => typeof value === "string")
      : [],
    title: stringField(input, "description") ??
      (typeof previous?.title === "string" ? previous.title : null),
    agentType: stringField(input, "subagent_type") ??
      (typeof previous?.agentType === "string" ? previous.agentType : null),
  };
}

export function isSubagentStatus(value: unknown): value is SubagentStatus {
  return value === "running" || value === "completed" ||
    value === "failed" || value === "stopped";
}

const PRIMARY_ARGUMENTS = [
  "command", "file_path", "notebook_path", "pattern", "query", "url", "path",
  "description", "prompt", "skill",
];

/** One line per child tool call: the tool and the argument that identifies it. */
export function summarizeChildToolUse(
  name: string,
  input: Record<string, unknown> | null,
): string {
  if (name.toLowerCase() === "bash" && stringField(input, "command")) {
    return clipEvent(`$ ${stringField(input, "command")}`, MAX_TOOL_EVENT_CHARS);
  }
  if (isSubagentTool(name)) {
    const title = stringField(input, "description");
    return clipEvent(title ? `Subagent: ${title}` : "Subagent", MAX_TOOL_EVENT_CHARS);
  }
  for (const key of PRIMARY_ARGUMENTS) {
    const value = stringField(input, key);
    if (value) return clipEvent(`${name} ${value.split("\n")[0]}`, MAX_TOOL_EVENT_CHARS);
  }
  return name;
}

export function appendSubagentEvents(
  events: readonly string[],
  additions: readonly string[],
): string[] {
  if (additions.length === 0) return [...events];
  return [...events, ...additions].slice(-MAX_SUBAGENT_EVENTS);
}

/** The SDK answers a backgrounded Task immediately with a launch notice. */
export function isBackgroundLaunchResult(text: string): boolean {
  return /^Async agent launched/u.test(text.trimStart());
}

export function isInterruptedResult(text: string): boolean {
  return /interrupted/iu.test(text.slice(0, 200));
}
