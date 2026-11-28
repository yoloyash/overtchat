import type { TFunction } from "i18next";
import {
  describeAgentTool,
  type AgentToolActivity,
  type AgentToolCategory,
} from "./agent-presentation";
import { agentApprovalChoices } from "./agent-interaction";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

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
  t: TFunction,
  prefix = "",
  depth = 0,
): ToolSection[] {
  if (value === undefined) return [];
  if (value === null || typeof value !== "object")
    return [
      {
        label: prefix || t("agents.activity.input"),
        value: typeof value === "string" ? value : String(value),
        kind: "code",
      },
    ];
  if (depth > 8)
    return [
      {
        label: prefix || t("agents.activity.input"),
        value: JSON.stringify(value, null, 2),
        kind: "code",
      },
    ];
  const entries = Object.entries(value);
  if (!entries.length)
    return [
      {
        label: prefix || t("agents.activity.input"),
        value: Array.isArray(value)
          ? t("agents.toolDetails.emptyList")
          : t("agents.toolDetails.noValues"),
        kind: "text",
      },
    ];
  return entries.flatMap(([key, child]) =>
    argumentSections(
      child,
      t,
      [
        prefix,
        Array.isArray(value)
          ? t("agents.toolDetails.itemIndex", { index: Number(key) + 1 })
          : label(key),
      ]
        .filter(Boolean)
        .join(" · "),
      depth + 1,
    ),
  );
}

export function toolDetails(tool: AgentToolActivity, t: TFunction): ToolDetails {
  const { category } = describeAgentTool(tool, t);
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
  if (category === "shell") take(["command", "cmd"], t("agents.toolDetails.command"));
  take(["filePath", "file_path", "path"], t("agents.toolDetails.path"));
  take(["cwd", "workdir", "workingDirectory"], t("agents.toolDetails.workingDirectory"));
  take(["patch", "diff", "unifiedDiff", "unified_diff"], t("agents.activity.changes"), "diff");
  take(["oldString", "old_string", "oldText", "old_text"], t("agents.toolDetails.before"));
  take(["newString", "new_string", "newText", "new_text"], t("agents.toolDetails.after"));
  take(["content", "text", "fileText", "file_text"], t("agents.activity.content"));
  const remaining = Object.fromEntries(
    Object.entries(args).filter(([key]) => !used.has(key)),
  );
  if (Object.keys(remaining).length)
    sections.push(...argumentSections(remaining, t));
  else if (typeof tool.args === "string" && tool.args)
    sections.push({ label: t("agents.activity.input"), value: tool.args, kind: "code" });
  if (tool.output)
    sections.push({
      label: tool.isError
        ? t("agents.toolDetails.errorOutput")
        : t("agents.activity.output"),
      value: readableToolText(tool.output),
      kind: "code",
    });
  if (tool.terminalInputs.length)
    sections.push({
      label: t("agents.toolDetails.terminalInput"),
      value: tool.terminalInputs.join("\n"),
      kind: "code",
    });
  if (tool.exitCode !== null)
    sections.push({
      label: t("agents.toolDetails.exitCode"),
      value: String(tool.exitCode),
      kind: "text",
    });
  if (tool.cancelled)
    sections.push({
      label: t("agents.toolDetails.status"),
      value: t("agents.toolDetails.cancelled"),
      kind: "text",
    });
  if (tool.truncated)
    sections.push({
      label: t("agents.toolDetails.outputLimit"),
      value: tool.fullOutputPath
        ? t("agents.toolDetails.truncatedWithPath", {
            path: tool.fullOutputPath,
          })
        : t("agents.toolDetails.truncated"),
      kind: "text",
    });
  return { category, sections };
}

export function approvalDetails(
  request: Record<string, unknown>,
  t: TFunction,
): ToolDetails & {
  title: string;
  message: string;
  choices: {
    label: string;
    value: string;
    kind: "allow" | "always" | "deny";
  }[];
} {
  let detail = record(request.toolDetail);
  // Recognize structured tool arguments even in older, generic JSON requests.
  // This also fixes already-pending approvals without restarting the agent.
  const input = record(detail.value);
  if (detail.type === "json" && typeof input.command === "string") {
    detail = { ...input, type: "shell" };
  } else if (
    detail.type === "json" &&
    typeof input.path === "string" &&
    typeof input.newText === "string"
  ) {
    const { tool: _tool, arguments: _arguments, path, ...rest } = input;
    detail = { ...rest, type: "edit", filePath: path };
  }
  const sections: ToolSection[] = [];
  let category: AgentToolCategory = "other";
  let message = text(request.message);
  const description = text(detail.description);
  if (description && !message.includes(description))
    message = [message, description].filter(Boolean).join("\n\n");
  const suppliedTitle = text(request.title);
  let title = suppliedTitle || t("agents.approval.permissionRequired");
  if (request.approvalKind === "tool") {
    const shortTitle = t(
      detail.type === "shell"
        ? "agents.approval.titles.shell"
        : detail.type === "edit"
          ? "agents.approval.titles.edit"
          : detail.type === "write"
            ? "agents.approval.titles.write"
            : "agents.approval.titles.other",
    );
    if (
      ["shell", "edit", "write"].includes(text(detail.type)) ||
      suppliedTitle.length > 100
    ) {
      title = shortTitle;
      // Keep warnings, but don't repeat a command/path or its known description.
      const redundant = [
        description,
        text(detail.command),
        `Command: ${detail.command}`,
        `${description}: ${detail.command}`,
        `Approve edit: ${detail.filePath}`,
        `File: ${detail.filePath}`,
        `Path: ${detail.filePath}`,
      ];
      if (suppliedTitle && !redundant.includes(suppliedTitle)) {
        if (suppliedTitle.length <= 100) title = suppliedTitle;
        else if (!message.includes(suppliedTitle))
          message = [message, suppliedTitle].filter(Boolean).join("\n\n");
      }
    }
  }
  const choices: ReturnType<typeof approvalDetails>["choices"] = [];
  if (request.approvalKind === "tool") {
    const suppliedChoices = agentApprovalChoices(request.approvalChoices);
    if (suppliedChoices.length) choices.push(...suppliedChoices);
    else {
      choices.push({
        label: t("agents.approval.choices.allowOnce"),
        value: text(request.approveValue) || "Approve",
        kind: "allow",
      });
      if (request.alwaysValue)
        choices.push({
          label:
            text(request.alwaysLabel) ||
            t("agents.approval.choices.allowAlways"),
          value: text(request.alwaysValue),
          kind: "always",
        });
      choices.push({
        label: t("agents.approval.choices.deny"),
        value: text(request.denyValue) || "Deny",
        kind: "deny",
      });
    }
    if (["shell", "edit", "write"].includes(text(detail.type)))
      category = detail.type as AgentToolCategory;
    const {
      type: _type,
      description: _description,
      changes: _changes,
      ...args
    } = detail;
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
    sections.push(...toolDetails(fake, t).sections);
    if (
      message === `Command: ${detail.command}` ||
      message === `File: ${detail.filePath}` ||
      message === `Path: ${detail.filePath}`
    )
      message = "";
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
          text(change.patch) || t("agents.approval.noChangePreview"),
        kind: text(change.patch) ? "diff" : "text",
      });
    }
  }
  return { category, sections, title, message, choices };
}
