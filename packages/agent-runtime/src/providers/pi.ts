import type {
  AgentProviderCatalog,
  AgentSlashCommand,
} from "@overtchat/agent-bridge";
import {
  mergeAgentSlashCommands,
  normalizeAgentSessionCommand,
} from "@overtchat/agent-bridge";
import { startPi } from "@overtchat/agent-runtime/pi/client";
import { parsePiCommands } from "@overtchat/agent-runtime/pi/protocol";
import { probePiTarget } from "@overtchat/agent-runtime/pi/probe";
import { listPiWorkspaceSessions } from "@overtchat/agent-runtime/pi/sessions";
import { targetForConnectionDraft } from "@overtchat/agent-runtime/runtime/discovery";
import type { HostTarget } from "@overtchat/agent-runtime/runtime/process";
import type {
  AgentProviderAdapter,
  AgentRuntimeEvent,
  AgentRuntimeEventClassifier,
  AgentSessionIdentity,
  AgentSessionLaunch,
} from "@overtchat/agent-runtime/providers/types";

const COMMANDS: readonly AgentSlashCommand[] = [
  { name: "new", description: "Start a new session", source: "builtin" },
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

class PiEventClassifier implements AgentRuntimeEventClassifier {
  reset(): void {}

  classify(event: AgentRuntimeEvent) {
    const promptHandledWithoutRun =
      event.type === "prompt_result" && event.agentInvoked === false;
    return {
      started: event.type === "agent_start" || event.type === "turn_start",
      terminal: event.type === "agent_settled" || promptHandledWithoutRun,
    };
  }
}

function sessionIdentity(state: Record<string, unknown>): AgentSessionIdentity {
  if (typeof state.sessionFile !== "string" || !state.sessionFile) {
    throw new Error("Pi did not create a persistent session file.");
  }
  if (typeof state.sessionId !== "string" || !state.sessionId) {
    throw new Error("Pi did not return a session ID.");
  }
  return {
    providerSessionPath: state.sessionFile,
    providerSessionId: state.sessionId,
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
  const client = startPi(target, {
    executable: launch.executable,
    cwd: launch.cwd,
    noSession: true,
    extraArgs: [
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
    ],
  });
  try {
    await client.getState();
    return {
      provider: "pi",
      models: await client.getAvailableModels(120_000),
      modes: [],
      defaultModeId: null,
    };
  } finally {
    await client.stop();
  }
}

export const piProviderAdapter: AgentProviderAdapter = {
  provider: "pi",
  startSession(target, launch) {
    return startPi(target, {
      executable: launch.executable,
      cwd: launch.cwd,
      model: launch.model,
      thinkingOptionId: launch.thinkingOptionId,
      ...(launch.resume
        ? { sessionPath: launch.resume.providerSessionPath }
        : {}),
    });
  },
  probeConnection: (draft) =>
    probePiTarget(targetForConnectionDraft(draft), draft.executable),
  probeTarget: (target, executable) =>
    probePiTarget(target, executable),
  listWorkspaceSessions: (target, _executable, workspacePath) =>
    listPiWorkspaceSessions(target, workspacePath),
  fetchCatalog,
  sessionIdentity,
  createEventClassifier: () => new PiEventClassifier(),
  commandsFromEvent: (event) =>
    event.type === "available_commands_update" && Array.isArray(event.commands)
      ? parsePiCommands({ commands: event.commands })
      : null,
  mergeCommands: (discovered) => mergeAgentSlashCommands(COMMANDS, discovered),
  normalizeCommand: (command, state) =>
    normalizeAgentSessionCommand(command, state),
};
