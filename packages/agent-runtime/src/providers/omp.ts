import type {
  AgentProviderCatalog,
  AgentSlashCommand,
} from "@overtchat/agent-bridge";
import {
  mergeAgentSlashCommands,
  normalizeAgentSessionCommand,
} from "@overtchat/agent-bridge";
import { startOmp } from "@overtchat/agent-runtime/omp/client";
import { OMP_MODES } from "@overtchat/agent-runtime/omp/config";
import { parseOmpCommands } from "@overtchat/agent-runtime/omp/protocol";
import { probeOmpTarget } from "@overtchat/agent-runtime/omp/probe";
import { listOmpWorkspaceSessions } from "@overtchat/agent-runtime/omp/sessions";
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

function messageRole(message: unknown): string | null {
  return message && typeof message === "object" &&
    typeof Reflect.get(message, "role") === "string"
    ? (Reflect.get(message, "role") as string)
    : null;
}

class OmpEventClassifier implements AgentRuntimeEventClassifier {
  private sawAssistant = false;

  reset(): void {
    this.sawAssistant = false;
  }

  classify(event: AgentRuntimeEvent) {
    if (event.type === "agent_start") this.sawAssistant = false;
    if (
      ["message_start", "message_update", "message_end"].includes(event.type) &&
      messageRole(event.message) === "assistant"
    ) {
      this.sawAssistant = true;
    }
    const terminal =
      (event.type === "agent_end" &&
        (this.sawAssistant ||
          (Array.isArray(event.messages) &&
            event.messages.some((message) => messageRole(message) === "assistant")))) ||
      (event.type === "prompt_result" && event.agentInvoked === false);
    if (terminal) this.reset();
    return {
      started: event.type === "agent_start" || event.type === "turn_start",
      terminal,
    };
  }
}

function sessionIdentity(state: Record<string, unknown>): AgentSessionIdentity {
  if (typeof state.sessionFile !== "string" || !state.sessionFile) {
    throw new Error("Oh My Pi did not create a persistent session file.");
  }
  if (typeof state.sessionId !== "string" || !state.sessionId) {
    throw new Error("Oh My Pi did not return a session ID.");
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
  const client = startOmp(target, {
    executable: launch.executable,
    cwd: launch.cwd,
    noSession: true,
    modeId: "full",
    extraArgs: ["--no-extensions", "--no-skills", "--no-rules"],
  });
  try {
    await client.getState();
    return {
      provider: "omp",
      models: await client.getAvailableModels(120_000),
      modes: OMP_MODES,
      defaultModeId: "full",
    };
  } finally {
    await client.stop();
  }
}

export const ompProviderAdapter: AgentProviderAdapter = {
  provider: "omp",
  startSession(target, launch) {
    return startOmp(target, {
      executable: launch.executable,
      cwd: launch.cwd,
      model: launch.model,
      thinkingOptionId: launch.thinkingOptionId,
      modeId: launch.modeId ?? "full",
      ...(launch.resume
        ? { sessionPath: launch.resume.providerSessionPath }
        : {}),
    });
  },
  probeConnection: (draft) =>
    probeOmpTarget(targetForConnectionDraft(draft), draft.executable),
  probeTarget: (target, executable) =>
    probeOmpTarget(target, executable),
  listWorkspaceSessions: (target, _executable, workspacePath) =>
    listOmpWorkspaceSessions(target, workspacePath),
  fetchCatalog,
  sessionIdentity,
  createEventClassifier: () => new OmpEventClassifier(),
  commandsFromEvent: (event) =>
    event.type === "available_commands_update" && Array.isArray(event.commands)
      ? parseOmpCommands({ commands: event.commands })
      : null,
  mergeCommands: (discovered) => mergeAgentSlashCommands(COMMANDS, discovered),
  normalizeCommand: (command, state) =>
    normalizeAgentSessionCommand(command, state),
};
