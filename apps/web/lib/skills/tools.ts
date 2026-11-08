import "server-only";
import { asSchema, tool, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  CALL_TOOL_TOOL_NAME,
  SKILL_TOOL_NAMES,
  VIEW_SKILL_TOOL_NAME,
} from "@overtchat/shared";
import { skillDocument } from "@/lib/skills/prompt";
import type { ChatSkill } from "@/lib/skills/registry";

/** The skill tools in deterministic provider order. */
export const SKILL_TOOL_ORDER = Object.freeze(SKILL_TOOL_NAMES);

/** Every tool the skills of a chat may run, by name. */
export function toolsOfSkills(
  skills: readonly ChatSkill[],
): Record<string, Tool> {
  return Object.assign({}, ...skills.map((skill) => skill.tools));
}

export interface CreateSkillToolsOptions {
  skills: readonly ChatSkill[];
  /** Whether a skill's text leaves room in the model's context. */
  fits: (skill: ChatSkill) => boolean;
}

/**
 * The two tools every chat with skills is given. `view_skill` loads one
 * skill's text into the conversation; `call_tool` runs a tool a skill
 * provides. The tool list itself never changes, whatever a chat loads.
 */
export function createSkillTools({
  skills,
  fits,
}: CreateSkillToolsOptions): ToolSet {
  const tools = toolsOfSkills(skills);
  return Object.freeze({
    [VIEW_SKILL_TOOL_NAME]: tool({
      description:
        "Read a skill's instructions and the definitions of its tools. Call it when a request needs a skill listed in <available_skills>.",
      inputSchema: z.object({
        id: z.string().trim().describe("Skill id from <available_skills>."),
      }),
      execute: async ({ id }) => {
        const skill = skills.find((candidate) => candidate.id === id);
        if (!skill) {
          return `Error: Skill "${id}" not found. Use an id from <available_skills>.`;
        }
        if (!fits(skill)) {
          return `Error: The ${skill.name} skill's instructions do not fit this model's remaining context. Answer without it, and say so if the user asked for it.`;
        }
        return skillDocument(skill);
      },
    }),

    [CALL_TOOL_TOOL_NAME]: tool({
      description:
        "Run a tool of a skill you have viewed. Use its exact name, and give its arguments as an object matching its definition. Use {} for a tool without arguments.",
      inputSchema: z.object({
        tool_name: z
          .string()
          .trim()
          .describe("Exact tool name from a viewed skill."),
        params: z
          .record(z.string(), z.unknown())
          .default({})
          .describe("The tool's arguments."),
      }),
      execute: async ({ tool_name: name, params }, options) => {
        const target: Tool | undefined = Object.hasOwn(tools, name)
          ? tools[name]
          : undefined;
        if (!target || !target.execute) {
          return `Error: Tool "${name}" is not available. View a skill from <available_skills> to see its tools.`;
        }
        const input = await validateInput(target, name, params);
        return target.execute(input, options);
      },
    }),
  });
}

/** A tool's arguments as its own schema accepts them, or a readable error. */
async function validateInput(
  target: Tool,
  name: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (!target.inputSchema) return params;
  const schema = asSchema(target.inputSchema);
  if (!schema.validate) return params;
  const result = await schema.validate(params);
  if (result.success) return result.value;
  throw new Error(
    `Invalid arguments for ${name}: ${validationIssues(result.error)}. Match the tool's definition.`,
  );
}

function issuesOf(value: unknown): { path?: unknown[]; message?: string }[] {
  return value !== null &&
    typeof value === "object" &&
    "issues" in value &&
    Array.isArray(value.issues)
    ? (value.issues as { path?: unknown[]; message?: string }[])
    : [];
}

function validationIssues(error: unknown): string {
  const issues = issuesOf(error).length
    ? issuesOf(error)
    : issuesOf(error instanceof Error ? error.cause : undefined);
  if (issues.length) {
    return issues
      .slice(0, 5)
      .map((issue) => {
        const path = (issue.path ?? [])
          .map((segment) => String(segment))
          .join(".");
        return path ? `${path}: ${issue.message ?? "invalid"}` : issue.message ?? "invalid";
      })
      .join("; ");
  }
  return error instanceof Error ? error.message : "invalid arguments";
}
