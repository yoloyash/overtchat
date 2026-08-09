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
