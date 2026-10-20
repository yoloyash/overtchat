import { agentForkMessageId } from "@overtchat/agent-bridge";
import {
  describeAgentTool,
  projectAgentTranscript,
} from "./agent-presentation";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((part) => {
      const item = record(part);
      return item.type === "text" && typeof item.text === "string"
        ? [item.text]
        : [];
    })
    .join("\n")
    .trim();
}

function activityLine(label: string, summary?: string | null): string {
  const text = summary?.replace(/\s+/g, " ").trim();
  return `[${label}]${text ? ` ${text.length > 200 ? `${text.slice(0, 197)}...` : text}` : ""}`;
}

export function buildAgentForkContext(
  messages: readonly unknown[],
  messageId: string,
  title?: string,
): string {
  let boundary = -1;
  messages.forEach((message, index) => {
    const row = record(message);
    if (
      (row.role === "assistant" || row.role === "turnFooter") &&
      agentForkMessageId(message, index) === messageId
    )
      boundary = index;
  });
  if (boundary < 0)
    throw new Error("Selected assistant message is no longer available.");

  // Slice before projection so later tool results cannot enrich this checkpoint.
  const selected = messages.slice(0, boundary + 1).map((message) => {
    const row = record(message);
    return row.role === "assistant" && typeof row.content === "string"
      ? { ...row, content: [{ type: "text", text: row.content }] }
      : message;
  });
  const lines: string[] = [];
  const seenActivities = new Set<string>();
  for (const item of projectAgentTranscript(selected)) {
    if (item.type === "message") {
      const row = record(item.message);
      const text = textContent(row.content);
      if (row.role === "user" && text) lines.push(`[User] ${text}`);
    } else if (item.type === "assistant_text" || item.type === "plan") {
      if (item.text.trim()) lines.push(`[Assistant] ${item.text.trim()}`);
    } else if (item.type === "activity") {
      for (const entry of item.entries) {
        if (entry.type === "thinking" || seenActivities.has(entry.id)) continue;
        seenActivities.add(entry.id);
        if (entry.type === "subagent") {
          lines.push(activityLine("Task", entry.activity.prompt));
          const log = [
            ...entry.activity.events,
            ...entry.activity.receivers.flatMap((receiver) =>
              receiver.message ? [receiver.message] : [],
            ),
          ]
            .join("\n")
            .trim();
          if (log) lines.push(log);
        } else {
          const tool = entry.tool;
          if (tool.name.startsWith("mcp__") || tool.name.includes("/")) {
            lines.push(activityLine(tool.name));
          } else if (["agent", "task"].includes(tool.name.toLowerCase())) {
            const args = record(tool.args);
            lines.push(
              activityLine(
                typeof args.subagent_type === "string"
                  ? args.subagent_type
                  : "Task",
                typeof args.description === "string" ? args.description : null,
              ),
            );
            if (tool.output.trim()) lines.push(tool.output.trim());
          } else {
            const display = describeAgentTool(tool);
            lines.push(
              activityLine(
                display.category === "shell"
                  ? "Shell"
                  : display.category === "other"
                    ? tool.name
                    : display.label,
                display.summary,
              ),
            );
          }
        }
      }
    }
  }
  const text = [
    "# Conversation context",
    ...(title?.trim() ? [`Session: ${title.trim()}`] : []),
    "The following messages precede this fork.",
    lines.join("\n"),
    "--- End of prior conversation ---",
  ].join("\n\n");
  if (text.length > 180_000)
    throw new Error(
      "This conversation is too large to attach. Fork from an earlier response.",
    );
  return text;
}
