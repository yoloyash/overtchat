import type {
  AgentProviderAdapter,
  AgentRuntimeEvent,
  AgentRuntimeEventClassifier,
  AgentSessionIdentity,
} from "@/lib/agents/providers/types";
import type {
  AgentSessionCommand,
  AgentSlashCommand,
} from "@/lib/agents/types";
import {
  mergeAgentSlashCommands,
  normalizeAgentSessionCommand,
} from "@/lib/agents/runtime/commands";
import { startCodexRuntime } from "@/lib/agents/codex/client";
import {
  probeCodexConnection,
  probeCodexTarget,
} from "@/lib/agents/codex/probe";
import { listCodexWorkspaceSessions } from "@/lib/agents/codex/sessions";

const CODEX_COMMANDS: readonly AgentSlashCommand[] = [
  {
    name: "new",
    description: "Start a new session",
    source: "builtin",
  },
  {
    name: "compact",
    description: "Compact conversation context",
    source: "builtin",
  },
  {
    name: "name",
    description: "Set the session name",
    source: "builtin",
    argumentHint: "<name>",
  },
  {
    name: "usage",
    description: "Show Codex plan usage and token activity",
    source: "builtin",
  },
];

class CodexEventClassifier implements AgentRuntimeEventClassifier {
  reset(): void {}

  classify(event: AgentRuntimeEvent) {
    return {
      started: event.type === "turn_start",
      terminal: event.type === "turn_end",
    };
  }
}

function sessionIdentity(
  state: Record<string, unknown>,
): AgentSessionIdentity {
  if (typeof state.sessionId !== "string" || !state.sessionId) {
    throw new Error("Codex did not return a thread ID.");
  }
  return {
    providerSessionId: state.sessionId,
    providerSessionPath:
      typeof state.sessionFile === "string" && state.sessionFile
        ? state.sessionFile
        : state.sessionId,
    sessionName:
      typeof state.sessionName === "string" && state.sessionName.trim()
        ? state.sessionName.trim()
        : null,
  };
}

function normalizeCommand(
  command: AgentSessionCommand,
  state: Record<string, unknown>,
): AgentSessionCommand {
  if (
    command.type === "prompt" &&
    !command.images?.length &&
    /^\/plan(?:[^\S\n]+([^\n]*))?$/iu.test(command.message.trim())
  ) {
    const argumentsText =
      /^\/plan(?:[^\S\n]+([^\n]*))?$/iu.exec(command.message.trim())?.[1]?.trim() ??
      "";
    if (argumentsText) throw new Error("Usage: /plan");
    const modes = Array.isArray(state.collaborationModes)
      ? state.collaborationModes
      : [];
    if (!modes.includes("default") || !modes.includes("plan")) {
      throw new Error("This Codex installation does not provide Plan mode.");
    }
    return {
      type: "set_collaboration_mode",
      mode: state.collaborationMode === "plan" ? "default" : "plan",
    };
  }
  if (
    command.type === "prompt" &&
    !command.images?.length &&
    /^\/usage(?:\s*)$/iu.test(command.message)
  ) {
    return { type: "show_usage" };
  }
  if (
    command.type === "prompt" &&
    !command.images?.length &&
    /^\/goal(?:[^\S\n]+([^\n]*))?$/iu.test(command.message)
  ) {
    if (state.goalsSupported !== true) {
      throw new Error("This Codex installation does not support durable goals.");
    }
    const argumentsText =
      /^\/goal(?:[^\S\n]+([^\n]*))?$/iu.exec(command.message.trim())?.[1]?.trim() ??
      "";
    if (!argumentsText) {
      throw new Error("Usage: /goal <objective>|pause|resume|clear");
    }
    const action = argumentsText.toLowerCase();
    if (["pause", "resume", "clear"].includes(action)) {
      return {
        type: "update_goal",
        action: action as "pause" | "resume" | "clear",
      };
    }
    if (argumentsText.length > 20_000) {
      throw new Error("Goal objectives must be 20,000 characters or less.");
    }
    return {
      type: "update_goal",
      action: "set",
      objective: argumentsText,
    };
  }
  const normalized = normalizeAgentSessionCommand(command, state);
  if (normalized.type === "set_auto_compaction") {
    throw new Error("Codex manages context compaction automatically.");
  }
  return normalized;
}

export const codexProviderAdapter: AgentProviderAdapter = {
  provider: "codex",
  startSession: startCodexRuntime,
  probeConnection: (draft) =>
    probeCodexConnection({ ...draft, provider: "codex" }),
  probeTarget: probeCodexTarget,
  listWorkspaceSessions: listCodexWorkspaceSessions,
  sessionIdentity,
  createEventClassifier: () => new CodexEventClassifier(),
  commandsFromEvent: (event) =>
    event.type === "available_commands_update" &&
    Array.isArray(event.commands)
      ? (event.commands as AgentSlashCommand[])
      : null,
  mergeCommands: (discovered) =>
    mergeAgentSlashCommands(CODEX_COMMANDS, discovered),
  normalizeCommand,
};
