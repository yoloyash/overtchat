import type {
  AgentProviderCatalog,
  AgentSlashCommand,
} from "@overtchat/agent-bridge";
import {
  mergeAgentSlashCommands,
  normalizeAgentSessionCommand,
} from "@overtchat/agent-bridge";
import { startClaudeRuntime } from "@overtchat/agent-runtime/claude/client";
import {
  probeClaudeConnection,
  probeClaudeTarget,
} from "@overtchat/agent-runtime/claude/probe";
import { listClaudeWorkspaceSessions } from "@overtchat/agent-runtime/claude/sessions";
import type {
  AgentProviderAdapter,
  AgentRuntimeEvent,
  AgentRuntimeEventClassifier,
  AgentSessionIdentity,
  AgentSessionLaunch,
} from "@overtchat/agent-runtime/providers/types";
import type { HostTarget } from "@overtchat/agent-runtime/runtime/process";

const COMMANDS: readonly AgentSlashCommand[] = [
  { name: "new", description: "Start a new session", source: "builtin" },
  {
    name: "compact",
    description: "Compact conversation context",
    source: "builtin",
  },
  {
    name: "name",
    description: "Set the session name",
    argumentHint: "<name>",
    source: "builtin",
  },
];

class ClaudeEventClassifier implements AgentRuntimeEventClassifier {
  reset(): void {}

  classify(event: AgentRuntimeEvent) {
    return {
      started: event.type === "turn_start" || event.type === "compaction_start",
      terminal: event.type === "turn_end" || event.type === "compaction_end",
    };
  }
}

function sessionIdentity(state: Record<string, unknown>): AgentSessionIdentity {
  if (typeof state.sessionId !== "string" || !state.sessionId) {
    throw new Error("Claude Code did not return a session ID.");
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

async function fetchCatalog(
  target: HostTarget,
  launch: Omit<AgentSessionLaunch, "resume">,
): Promise<AgentProviderCatalog> {
  const client = startClaudeRuntime(target, launch);
  try {
    const [models, state] = await Promise.all([
      client.getAvailableModels(),
      client.getState(),
    ]);
    const modes = Array.isArray(state.modes) ? state.modes : [];
    return {
      provider: "claude",
      models,
      modes: modes as AgentProviderCatalog["modes"],
      defaultModeId:
        modes.some(
          (mode) =>
            mode && typeof mode === "object" && Reflect.get(mode, "id") === "auto",
        )
          ? "auto"
          : "default",
    };
  } finally {
    await client.stop();
  }
}

export const claudeProviderAdapter: AgentProviderAdapter = {
  provider: "claude",
  startSession: startClaudeRuntime,
  probeConnection: probeClaudeConnection,
  probeTarget: probeClaudeTarget,
  listWorkspaceSessions: (target, _executable, workspacePath) =>
    listClaudeWorkspaceSessions(target, workspacePath),
  fetchCatalog,
  sessionIdentity,
  createEventClassifier: () => new ClaudeEventClassifier(),
  commandsFromEvent: (event) =>
    event.type === "available_commands_update" && Array.isArray(event.commands)
      ? (event.commands as AgentSlashCommand[])
      : null,
  mergeCommands: (discovered) => mergeAgentSlashCommands(COMMANDS, discovered),
  normalizeCommand: (command, state) => {
    const normalized = normalizeAgentSessionCommand(command, state);
    if (normalized.type === "set_auto_compaction") {
      throw new Error("Claude Code manages context compaction automatically.");
    }
    return normalized;
  },
};
