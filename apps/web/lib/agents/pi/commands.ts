import type {
  AgentSessionCommand,
  AgentSlashCommand,
} from "@/lib/agents/types";

export const PI_BUILTIN_COMMANDS: readonly AgentSlashCommand[] = [
  {
    name: "new",
    description: "Start a new session",
    source: "builtin",
  },
  {
    name: "compact",
    description: "Compact conversation context",
    source: "builtin",
    argumentHint: "[instructions]",
  },
  {
    name: "autocompact",
    description: "Toggle automatic context compaction",
    source: "builtin",
    argumentHint: "[on|off|toggle]",
  },
  {
    name: "name",
    description: "Set the session name",
    source: "builtin",
    argumentHint: "<name>",
  },
];

export function mergePiSlashCommands(
  discovered: readonly AgentSlashCommand[],
): AgentSlashCommand[] {
  const commands = PI_BUILTIN_COMMANDS.map((command) => ({ ...command }));
  const names = new Set(commands.map((command) => command.name.toLowerCase()));
  for (const command of discovered) {
    const name = command.name.toLowerCase();
    if (names.has(name)) continue;
    names.add(name);
    commands.push({ ...command });
  }
  return commands;
}

export function piSlashCommandQuery(value: string): string | null {
  const match = /^\/([a-z0-9:-]*)$/iu.exec(value);
  return match ? match[1].toLowerCase() : null;
}

type PiSlashInvocation = {
  name: string;
  arguments: string;
};

function parseInvocation(value: string): PiSlashInvocation | null {
  const match = /^\/([a-z0-9:-]+)(?:[^\S\n]+([^\n]*))?$/iu.exec(
    value.trim(),
  );
  return match
    ? {
        name: match[1].toLowerCase(),
        arguments: (match[2] ?? "").trim(),
      }
    : null;
}

function compactCommand(argumentsText: string): AgentSessionCommand {
  if (argumentsText.length > 20_000) {
    throw new Error("Compact instructions must be 20,000 characters or less.");
  }
  return {
    type: "compact",
    ...(argumentsText ? { customInstructions: argumentsText } : {}),
  };
}

function nameCommand(argumentsText: string): AgentSessionCommand {
  if (!argumentsText) throw new Error("Usage: /name <name>");
  if (argumentsText.length > 120) {
    throw new Error("Session names must be 120 characters or less.");
  }
  return { type: "set_session_name", name: argumentsText };
}

function autoCompactCommand(
  argumentsText: string,
  state: Record<string, unknown>,
): AgentSessionCommand {
  const mode = argumentsText.toLowerCase() || "toggle";
  if (!["on", "off", "toggle"].includes(mode)) {
    throw new Error("Usage: /autocompact [on|off|toggle]");
  }
  if (mode === "on" || mode === "off") {
    return { type: "set_auto_compaction", enabled: mode === "on" };
  }
  if (typeof state.autoCompactionEnabled !== "boolean") {
    throw new Error(
      "Auto-compaction state is unavailable. Use /autocompact on or /autocompact off.",
    );
  }
  return {
    type: "set_auto_compaction",
    enabled: !state.autoCompactionEnabled,
  };
}

export function normalizePiSessionCommand(
  command: AgentSessionCommand,
  state: Record<string, unknown>,
): AgentSessionCommand {
  if (command.type !== "prompt") return command;
  const invocation = parseInvocation(command.message);
  if (!invocation) return command;

  switch (invocation.name) {
    case "compact":
      return compactCommand(invocation.arguments);
    case "autocompact":
      return autoCompactCommand(invocation.arguments, state);
    case "name":
      return nameCommand(invocation.arguments);
    case "new":
      if (invocation.arguments) throw new Error("Usage: /new");
      return { type: "new_session" };
    default:
      return command;
  }
}
