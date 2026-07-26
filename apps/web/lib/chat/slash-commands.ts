// A command is recognized only while the whole draft is a leading-slash token
// (plus an optional argument), so prose mentioning "/etc/hosts" never opens the
// menu and the menu closes as soon as the draft becomes a real message.

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
}

// `[^\S\n]` keeps newlines out of the separator, so a multi-line draft is prose.
const COMMAND_PATTERN = /^\/([a-z0-9-]*)(?:([^\S\n]+)([^\n]*))?$/i;

/** Returns `null` when the draft isn't a command invocation. */
export function parseSlashCommandQuery(value: string): SlashCommandQuery | null {
  // Tolerate leading whitespace a paste might add.
  const match = COMMAND_PATTERN.exec(value.replace(/^[^\S\n]+/, ""));
  if (!match) return null;
  const [, name, separator, argument] = match;
  return {
    name: name.toLowerCase(),
    argument: argument ?? "",
    hasArgument: separator !== undefined,
  };
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
  query: SlashCommandQuery,
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
