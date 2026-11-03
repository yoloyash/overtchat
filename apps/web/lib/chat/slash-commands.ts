// A command is recognized in two forms. The whole draft can be a leading-slash
// token plus an optional argument, which is how `/model gpt` filters models and
// `/search what's new` runs search with the question left in the box. Or the
// word ending at the caret can be a slash token inside a longer draft, the way
// an @-mention works, so "find me /sea" offers search without clearing the
// sentence. Both forms require the slash to start a word, so "/etc/hosts" and
// "and/or" never open the menu.

import type { ComponentType } from "react";

export interface SlashCommandToggleState {
  active: boolean;
  /** Disables the row and replaces its description when set. */
  unavailableReason?: string;
}

export interface SlashCommand {
  /** Name without the leading slash, e.g. `"search"`. */
  name: string;
  title: string;
  description: string;
  group: SlashCommandGroup;
  icon: ComponentType<{ className?: string }>;
  /** Extra terms the filter should match. */
  keywords?: readonly string[];
  /**
   * Set when the command opens a nested picker instead of running immediately.
   * The trailing argument becomes the picker's query.
   */
  submenu?: "model";
  toggle?: SlashCommandToggleState;
  shortcut?: readonly string[];
  /** Handled by the composer, which owns the file input and recorder. */
  action?: "attach" | "dictate";
  run?: () => void;
}

export type SlashCommandGroup = "actions" | "navigate";

export const SLASH_COMMAND_GROUP_LABELS: Record<SlashCommandGroup, string> = {
  actions: "Actions",
  navigate: "Navigate",
};

export const SLASH_COMMAND_GROUP_ORDER: readonly SlashCommandGroup[] = [
  "actions",
  "navigate",
];

export interface SlashCommandQuery {
  /** Name typed so far, lowercased. */
  name: string;
  /** Text after the first whitespace run, verbatim. */
  argument: string;
  hasArgument: boolean;
  /**
   * Draft offsets of the invocation, from the slash through the argument. The
   * composer replaces this span when a command runs so surrounding prose stays.
   */
  start: number;
  end: number;
  /** True for the inline form: a token inside a longer draft. */
  inline: boolean;
}

export interface ParseSlashCommandOptions {
  /** Caret offset. Enables the inline form, which reads the word ending here. */
  caret?: number;
  /**
   * Names allowed to take an argument inline, i.e. the submenu commands. Any
   * other inline token followed by a space is prose, so "use /new to start"
   * sends as text rather than running `/new`.
   */
  argumentNames?: readonly string[];
}

// `[^\S\n]` keeps newlines out of the separator, so a multi-line draft is prose.
const COMMAND_PATTERN = /^\/([a-z0-9-]*)(?:([^\S\n]+)([^\n]*))?$/i;

/** Returns `null` when the draft isn't a command invocation. */
export function parseSlashCommandQuery(
  value: string,
  options: ParseSlashCommandOptions = {},
): SlashCommandQuery | null {
  // Tolerate leading whitespace a paste might add.
  const leading = /^[^\S\n]*/.exec(value)?.[0].length ?? 0;
  const whole = COMMAND_PATTERN.exec(value.slice(leading));
  if (whole) {
    const [, name, separator, argument] = whole;
    return {
      name: name.toLowerCase(),
      argument: argument ?? "",
      hasArgument: separator !== undefined,
      start: leading,
      end: value.length,
      inline: false,
    };
  }
  if (options.caret === undefined) return null;
  return parseInlineQuery(value, options.caret, options.argumentNames ?? []);
}

function parseInlineQuery(
  value: string,
  caret: number,
  argumentNames: readonly string[],
): SlashCommandQuery | null {
  const before = value.slice(0, caret);
  // Walk back to the last slash that starts a word. A slash inside a word, as
  // in a path or "and/or", is skipped rather than treated as a boundary.
  let index = before.lastIndexOf("/");
  while (index > 0 && !/\s/.test(before[index - 1])) {
    index = before.lastIndexOf("/", index - 1);
  }
  if (index < 0) return null;
  const match = COMMAND_PATTERN.exec(before.slice(index));
  if (!match) return null;
  const [, rawName, separator, argument] = match;
  const name = rawName.toLowerCase();
  if (separator !== undefined && !argumentNames.includes(name)) return null;
  return {
    name,
    argument: argument ?? "",
    hasArgument: separator !== undefined,
    start: index,
    end: caret,
    inline: true,
  };
}

/**
 * The draft with the invocation span replaced by `text`, plus where the caret
 * lands. Removing an inline token leaves its two neighbouring spaces touching,
 * so one is dropped.
 */
export function replaceSlashCommandSpan(
  value: string,
  query: Pick<SlashCommandQuery, "start" | "end">,
  text: string,
): { value: string; caret: number } {
  const before = value.slice(0, query.start);
  let after = value.slice(query.end);
  if (!text && after.startsWith(" ") && (before === "" || before.endsWith(" "))) {
    after = after.slice(1);
  }
  return { value: before + text + after, caret: before.length + text.length };
}

function matches(command: SlashCommand, name: string): boolean {
  if (!name) return true;
  if (command.name.startsWith(name)) return true;
  return (command.keywords ?? []).some((keyword) =>
    keyword.toLowerCase().startsWith(name),
  );
}

/** Prefix-matches name and keywords, preserving declaration order. */
export function filterSlashCommands(
  commands: readonly SlashCommand[],
  name: string,
): SlashCommand[] {
  return commands.filter((command) => matches(command, name));
}

/**
 * The command a draft resolves to, or `null` when ambiguous or unknown. Lets
 * Enter run a fully typed command even with the menu closed.
 */
export function resolveSlashCommand(
  commands: readonly SlashCommand[],
  query: Pick<SlashCommandQuery, "name">,
): SlashCommand | null {
  if (!query.name) return null;
  const exact = commands.find((command) => command.name === query.name);
  if (exact) return exact;
  const candidates = filterSlashCommands(commands, query.name);
  return candidates.length === 1 ? candidates[0] : null;
}

export function isSlashCommandAvailable(command: SlashCommand): boolean {
  return !command.toggle?.unavailableReason;
}

/** Mirrors `ModelPicker`'s substring match so both surfaces rank alike. */
export function filterSlashCommandModels<
  T extends { label: string; model: string; displayProvider: string },
>(models: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...models];
  return models.filter((model) =>
    [model.label, model.model, model.displayProvider]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}

export interface SlashCommandGroupView {
  group: SlashCommandGroup;
  label: string;
  commands: SlashCommand[];
}

/** Groups commands for rendering, dropping empty groups. */
export function groupSlashCommands(
  commands: readonly SlashCommand[],
): SlashCommandGroupView[] {
  return SLASH_COMMAND_GROUP_ORDER.flatMap((group) => {
    const inGroup = commands.filter((command) => command.group === group);
    if (inGroup.length === 0) return [];
    return [
      { group, label: SLASH_COMMAND_GROUP_LABELS[group], commands: inGroup },
    ];
  });
}
