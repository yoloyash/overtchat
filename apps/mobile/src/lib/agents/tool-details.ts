import {
  describeAgentTool,
  type AgentToolActivity,
  type AgentToolCategory,
} from "@overtchat/shared/agent-presentation";
import { record, text } from "./model";

export type ToolSection = {
  label: string;
  value: string;
  kind: "code" | "diff" | "text";
};
export type ToolDetails = {
  category: AgentToolCategory;
  sections: ToolSection[];
};
const first = (args: Record<string, unknown>, keys: string[]) =>
  keys.map((key) => args[key]).find((value) => typeof value === "string") as
    | string
    | undefined;

// Strip terminal control sequences, keeping newlines and tabs readable.
export function readableToolText(value: string) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function label(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}
// Unknown tools still expose all supplied arguments, as labelled values rather
// than a JSON blob. Nested paths remain visible so context is never discarded.
export function argumentSections(
  value: unknown,
  prefix = "",
  depth = 0,
): ToolSection[] {
  if (value === undefined) return [];
  if (value === null || typeof value !== "object")
    return [
      {
        label: prefix || "Input",
        value: typeof value === "string" ? value : String(value),
        kind: "code",
      },
    ];
  if (depth > 8)
    return [
      {
        label: prefix || "Input",
        value: JSON.stringify(value, null, 2),
        kind: "code",
      },
    ];
  const entries = Object.entries(value);
  if (!entries.length)
    return [
      {
        label: prefix || "Input",
        value: Array.isArray(value) ? "Empty list" : "No values",
        kind: "text",
      },
    ];
  return entries.flatMap(([key, child]) =>
    argumentSections(
      child,
      [prefix, Array.isArray(value) ? `Item ${Number(key) + 1}` : label(key)]
        .filter(Boolean)
        .join(" · "),
      depth + 1,
    ),
  );
}

export function toolDetails(tool: AgentToolActivity): ToolDetails {
  const { category } = describeAgentTool(tool);
  const args = record(tool.args);
  const sections: ToolSection[] = [];
  const used = new Set<string>();
  function take(
    keys: string[],
    title: string,
    kind: ToolSection["kind"] = "code",
  ) {
    const value = first(args, keys);
    if (value !== undefined) {
      keys.forEach((key) => used.add(key));
      sections.push({ label: title, value, kind });
    }
  }
  if (category === "shell") take(["command", "cmd"], "Command");
  take(["filePath", "file_path", "path"], "Path");
  take(["cwd", "workdir", "workingDirectory"], "Working directory");
  take(["patch", "diff", "unifiedDiff", "unified_diff"], "Changes", "diff");
  take(["oldString", "old_string", "oldText", "old_text"], "Before");
  take(["newString", "new_string", "newText", "new_text"], "After");
  take(["content", "text", "fileText", "file_text"], "Content");
  const remaining = Object.fromEntries(
    Object.entries(args).filter(([key]) => !used.has(key)),
  );
  if (Object.keys(remaining).length)
    sections.push(...argumentSections(remaining));
  else if (typeof tool.args === "string" && tool.args)
    sections.push({ label: "Input", value: tool.args, kind: "code" });
  if (tool.output)
    sections.push({
      label: tool.isError ? "Error output" : "Output",
      value: readableToolText(tool.output),
      kind: "code",
    });
  if (tool.terminalInputs.length)
    sections.push({
      label: "Terminal input",
      value: tool.terminalInputs.join("\n"),
      kind: "code",
    });
  if (tool.exitCode !== null)
    sections.push({
      label: "Exit code",
      value: String(tool.exitCode),
      kind: "text",
    });
  if (tool.cancelled)
    sections.push({ label: "Status", value: "Cancelled", kind: "text" });
  if (tool.truncated)
    sections.push({
      label: "Output limit",
      value: tool.fullOutputPath
        ? `Output was truncated by the agent. Full output on the host: ${tool.fullOutputPath}`
        : "Output was truncated by the agent.",
      kind: "text",
    });
  return { category, sections };
}

export function approvalDetails(
  request: Record<string, unknown>,
): ToolDetails & {
  message: string;
  choices: {
    label: string;
    value: string;
    kind: "allow" | "always" | "deny";
  }[];
} {
  const detail = record(request.toolDetail);
  const sections: ToolSection[] = [];
  let category: AgentToolCategory = "other";
  let message = text(request.message);
  const choices: ReturnType<typeof approvalDetails>["choices"] = [];
  if (request.approvalKind === "tool") {
    choices.push({
      label: "Allow once",
      value: text(request.approveValue) || "Approve",
      kind: "allow",
    });
    if (request.alwaysValue)
      choices.push({
        label: "Allow always",
        value: text(request.alwaysValue),
        kind: "always",
      });
    choices.push({
      label: "Deny",
      value: text(request.denyValue) || "Deny",
      kind: "deny",
    });
    if (["shell", "edit", "write"].includes(text(detail.type)))
      category = detail.type as AgentToolCategory;
    const { type: _type, ...args } = detail;
    const raw = detail.type === "json" ? detail.value : args;
    const fake: AgentToolActivity = {
      id: "approval",
      name: category === "shell" ? "bash" : category,
      args: raw,
      output: "",
      hasResult: false,
      partial: false,
      isError: false,
      direct: false,
      exitCode: null,
      cancelled: false,
      truncated: false,
      fullOutputPath: null,
      terminalInputs: [],
    };
    sections.push(...toolDetails(fake).sections);
    if (
      message === `Command: ${detail.command}` ||
      message === `File: ${detail.filePath}` ||
      message === `Path: ${detail.filePath}`
    )
      message = "";
  } else if (
    text(request.id).startsWith("codex:") &&
    [
      "Approve command?",
      "Approve file changes?",
      "Approve network access?",
      "Approve additional permissions?",
    ].includes(text(request.title)) &&
    Array.isArray(request.options) &&
    request.options.join("|") === "Allow once|Allow for session|Deny"
  ) {
    // Codex currently sends these as select requests. Preserve its exact values.
    choices.push(
      { label: "Allow once", value: "Allow once", kind: "allow" },
      {
        label: "Allow for session",
        value: "Allow for session",
        kind: "always",
      },
      { label: "Deny", value: "Deny", kind: "deny" },
    );
    if (request.title === "Approve additional permissions?") {
      const prose: string[] = [];
      for (const block of message.split("\n\n")) {
        const match = /^(Network|Files): ([\s\S]*)$/.exec(block);
        if (!match) {
          prose.push(block);
          continue;
        }
        try {
          sections.push(...argumentSections(JSON.parse(match[2]), match[1]));
        } catch {
          sections.push({ label: match[1], value: match[2], kind: "code" });
        }
      }
      message = prose.join("\n\n");
    }
    const commandAt = message.search(/(?:^|\n\n)\$ /);
    if (commandAt >= 0) {
      const command = message.slice(commandAt).replace(/^\n\n/, "").slice(2);
      message = message.slice(0, commandAt);
      category = "shell";
      sections.push({ label: "Command", value: command, kind: "code" });
    }
  }
  if (detail.type === "edit" && Array.isArray(detail.changes)) {
    category = "edit";
    for (const candidate of detail.changes) {
      const change = record(candidate);
      const path = text(change.filePath);
      if (!path) continue;
      const destination = text(change.movePath);
      sections.push({
        label: destination ? `${path} → ${destination}` : path,
        value:
          text(change.patch) || "No change preview was provided for this file.",
        kind: text(change.patch) ? "diff" : "text",
      });
    }
  }
  return { category, sections, message, choices };
}
