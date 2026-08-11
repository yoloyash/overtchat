import path from "node:path";
import type { AgentSlashCommand } from "@overtchat/agent-bridge";
import {
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";
import {
  recordOf,
  stringOf,
  type UnknownRecord,
} from "@overtchat/agent-runtime/codex/protocol";

const MAX_CUSTOM_PROMPTS = 100;
const PROMPT_PATH_MARKER = "OVERTCHAT_PROMPT_PATH";
const PROMPT_BODY_MARKER = "OVERTCHAT_PROMPT_BODY";
const PROMPT_END_MARKER = "OVERTCHAT_PROMPT_END";

export type CodexSkillCommand = AgentSlashCommand & {
  source: "skill";
  path: string;
};

export type CodexPromptCommand = AgentSlashCommand & {
  source: "prompt";
  template: string;
};

export type CodexDiscoveredCommand =
  | CodexSkillCommand
  | CodexPromptCommand;

export type CodexSlashInvocation = {
  name: string;
  arguments: string;
};

const CUSTOM_PROMPT_SCRIPT = [
  'dir="${CODEX_HOME:-"$HOME/.codex"}/prompts"',
  '[ -d "$dir" ] || exit 0',
  `find "$dir" -maxdepth 1 -type f -name '*.md' -exec sh -c '`,
  "  for file do",
  `    echo "${PROMPT_PATH_MARKER}"`,
  '    printf "%s" "$file" | od -An -tx1 -v',
  `    echo "${PROMPT_BODY_MARKER}"`,
  '    od -An -tx1 -v "$file"',
  `    echo "${PROMPT_END_MARKER}"`,
  "  done",
  "' sh {} +",
].join("\n");

export function parseCodexSlashInvocation(
  value: string,
): CodexSlashInvocation | null {
  const match = /^\/([a-z0-9:_-]+)(?:[^\S\n]+([^\n]*))?$/iu.exec(
    value.trim(),
  );
  return match
    ? {
        name: match[1],
        arguments: (match[2] ?? "").trim(),
      }
    : null;
}

export function parseCodexSkills(value: unknown): CodexSkillCommand[] {
  const response = recordOf(value);
  const entries = Array.isArray(response?.data) ? response.data : [];
  const skills = new Map<string, CodexSkillCommand>();
  for (const entry of entries) {
    const entryRecord = recordOf(entry);
    const list: unknown[] = Array.isArray(entryRecord?.skills)
      ? entryRecord.skills
      : [];
    for (const candidate of list) {
      const skill = recordOf(candidate);
      const name = stringOf(skill, "name");
      const skillPath = stringOf(skill, "path");
      if (!name || !skillPath || skill?.enabled === false) continue;
      const key = name.toLowerCase();
      if (skills.has(key)) continue;
      skills.set(key, {
        name,
        description:
          stringOf(skill, "shortDescription") ??
          stringOf(skill, "description") ??
          "Codex skill",
        source: "skill",
        path: skillPath,
      });
    }
  }
  return [...skills.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export async function listCodexCustomPrompts(
  target: HostTarget,
): Promise<CodexPromptCommand[]> {
  const result = await executeOnHost(
    target,
    {
      command: "sh",
    },
    {
      timeoutMs: 15_000,
      stdin: CUSTOM_PROMPT_SCRIPT,
    },
  );
  const records = parseCustomPromptOutput(result.stdout);
  const prompts: CodexPromptCommand[] = [];
  for (const { filePath, markdown } of records) {
    if (prompts.length >= MAX_CUSTOM_PROMPTS) break;
    const basename = path.posix.basename(filePath);
    if (!basename.endsWith(".md")) continue;
    const name = basename.slice(0, -3);
    if (!name) continue;
    const parsed = parseFrontMatter(markdown);
    prompts.push({
      name: `prompts:${name}`,
      description: parsed.frontMatter.description ?? "Custom prompt",
      source: "prompt",
      ...(parsed.frontMatter["argument-hint"] ||
      parsed.frontMatter.argument_hint
        ? {
            argumentHint:
              parsed.frontMatter["argument-hint"] ??
              parsed.frontMatter.argument_hint,
          }
        : {}),
      template: parsed.body,
    });
  }
  return prompts.sort((left, right) => left.name.localeCompare(right.name));
}

function parseCustomPromptOutput(
  output: string,
): Array<{ filePath: string; markdown: string }> {
  const records: Array<{ filePath: string; markdown: string }> = [];
  const lines = output.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== PROMPT_PATH_MARKER) continue;
    const pathHex: string[] = [];
    const bodyHex: string[] = [];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() !== PROMPT_BODY_MARKER
    ) {
      pathHex.push(lines[index]);
      index += 1;
    }
    if (index >= lines.length) break;
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() !== PROMPT_END_MARKER
    ) {
      bodyHex.push(lines[index]);
      index += 1;
    }
    const filePath = decodeHex(pathHex.join(""));
    const markdown = decodeHex(bodyHex.join(""));
    if (filePath !== null && markdown !== null) {
      records.push({ filePath, markdown });
    }
  }
  return records;
}

function decodeHex(value: string): string | null {
  const compact = value.replace(/\s/gu, "");
  if (
    compact.length === 0 ||
    compact.length % 2 !== 0 ||
    !/^[0-9a-f]+$/iu.test(compact)
  ) {
    return null;
  }
  return Buffer.from(compact, "hex").toString("utf8");
}

export function expandCodexCustomPrompt(
  template: string,
  argumentsText: string,
): string {
  const trimmed = argumentsText.trim();
  const tokens = tokenizeArguments(trimmed);
  const positional: string[] = [];
  const named = new Map<string, string>();
  for (const token of tokens) {
    const separator = token.indexOf("=");
    if (separator > 0) {
      named.set(token.slice(0, separator), token.slice(separator + 1));
    } else {
      positional.push(token);
    }
  }

  const dollarPlaceholder = "__OVERTCHAT_CODEX_DOLLAR__";
  let expanded = template.replaceAll("$$", dollarPlaceholder);
  expanded = expanded.replaceAll("$ARGUMENTS", trimmed);
  for (let index = 1; index <= 9; index += 1) {
    expanded = expanded.replaceAll(`$${index}`, positional[index - 1] ?? "");
  }
  for (const [name, value] of [...named.entries()].sort(
    ([left], [right]) => right.length - left.length,
  )) {
    expanded = expanded.replace(
      new RegExp(`\\$${escapeRegExp(name)}\\b`, "gu"),
      value,
    );
  }
  return expanded.replaceAll(dollarPlaceholder, "$");
}

function parseFrontMatter(markdown: string): {
  frontMatter: Record<string, string>;
  body: string;
} {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { frontMatter: {}, body: markdown };
  }
  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (end < 0) return { frontMatter: {}, body: markdown };
  const frontMatter: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/gu, "");
    if (key && value) frontMatter[key] = value;
  }
  return {
    frontMatter,
    body: lines.slice(end + 1).join("\n"),
  };
}

function tokenizeArguments(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) {
        quote = null;
      } else if (character === "\\" && index + 1 < value.length) {
        current += decodeEscapedCharacter(value[++index]);
      } else {
        current += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/u.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function decodeEscapedCharacter(value: string): string {
  if (value === "n") return "\n";
  if (value === "t") return "\t";
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function commandMap(
  commands: readonly CodexDiscoveredCommand[],
): Map<string, CodexDiscoveredCommand> {
  return new Map(
    commands.map((command) => [command.name.toLowerCase(), command]),
  );
}

export function publicCommands(
  commands: readonly CodexDiscoveredCommand[],
): AgentSlashCommand[] {
  return commands.map(({ name, description, source, argumentHint }) => ({
    name,
    description,
    source,
    ...(argumentHint ? { argumentHint } : {}),
  }));
}

export function skillInput(
  command: CodexSkillCommand,
  argumentsText: string,
): UnknownRecord[] {
  const text = argumentsText
    ? `$${command.name} ${argumentsText}`
    : `$${command.name}`;
  return [
    { type: "skill", name: command.name, path: command.path },
    { type: "text", text, text_elements: [] },
  ];
}
