import type {
  AgentProviderCatalog,
  AgentSlashCommand,
} from "@overtchat/agent-bridge";
import {
  mergeAgentSlashCommands,
  normalizeAgentSessionCommand,
} from "@overtchat/agent-bridge";
import {
  fetchOpenCodeCatalog,
  listOpenCodeSessions,
  startOpenCodeRuntime,
} from "@overtchat/agent-runtime/opencode/client";
import { openCodeSessionMetadata } from "@overtchat/agent-runtime/opencode/protocol";
import {
  probeOpenCodeConnection,
  probeOpenCodeTarget,
} from "@overtchat/agent-runtime/opencode/probe";
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
    source: "builtin",
    argumentHint: "<name>",
  },
];

class OpenCodeEventClassifier implements AgentRuntimeEventClassifier {
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
    throw new Error("OpenCode did not return a session ID.");
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
  const catalog = await fetchOpenCodeCatalog(
    target,
    launch.executable,
    launch.cwd,
  );
  return {
    provider: "opencode",
    ...catalog,
  };
}

export const openCodeProviderAdapter: AgentProviderAdapter = {
  provider: "opencode",
  startSession(target, launch) {
    return startOpenCodeRuntime(target, {
      executable: launch.executable,
      cwd: launch.cwd,
      model: launch.model,
      thinkingOptionId: launch.thinkingOptionId,
      modeId: launch.modeId,
      resumeSessionId: launch.resume?.providerSessionId,
    });
  },
  probeConnection: probeOpenCodeConnection,
  probeTarget: probeOpenCodeTarget,
  async listWorkspaceSessions(target, executable, workspacePath) {
    const sessions = await listOpenCodeSessions(
      target,
      executable,
      workspacePath,
    );
    return sessions.map(({ session, messages }) =>
      openCodeSessionMetadata(session, messages),
    );
  },
  fetchCatalog,
  sessionIdentity,
  createEventClassifier: () => new OpenCodeEventClassifier(),
  commandsFromEvent: () => null,
  mergeCommands: (discovered) => mergeAgentSlashCommands(COMMANDS, discovered),
  normalizeCommand: (command, state) =>
    normalizeAgentSessionCommand(command, state),
};
