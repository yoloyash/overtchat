import { agentProviderMetadata } from "@/lib/agents/catalog";
import {
  mergeAgentSlashCommands,
  normalizeAgentSessionCommand,
} from "@/lib/agents/runtime/commands";
import { targetForConnectionDraft } from "@/lib/agents/runtime/discovery";
import type { HostTarget } from "@/lib/agents/runtime/process";
import type {
  AgentProviderAdapter,
  AgentRuntimeEvent,
  AgentRuntimeEventClassification,
  AgentRuntimeEventClassifier,
  AgentSessionIdentity,
  AgentSessionLaunch,
} from "@/lib/agents/providers/types";
import type {
  AgentSlashCommand,
} from "@/lib/agents/types";
import { startPiRpc } from "@/lib/agents/pi/client";
import { parsePiCommands } from "@/lib/agents/pi/protocol";
import { probeAgentTarget } from "@/lib/agents/pi/probe";
import { listAgentWorkspaceSessions } from "@/lib/agents/pi/sessions";

const OVERTCHAT_SESSION_COMMANDS: readonly AgentSlashCommand[] = [
  {
    name: "new",
    description: "Start a new session",
    source: "builtin",
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

type PiRpcProviderId = "pi" | "omp";

const PI_BUILTIN_COMMANDS: readonly AgentSlashCommand[] = [
  OVERTCHAT_SESSION_COMMANDS[0],
  {
    name: "compact",
    description: "Compact conversation context",
    source: "builtin",
    argumentHint: "[instructions]",
  },
  ...OVERTCHAT_SESSION_COMMANDS.slice(1),
];

function builtinCommands(
  provider: PiRpcProviderId,
): readonly AgentSlashCommand[] {
  return provider === "pi"
    ? PI_BUILTIN_COMMANDS
    : OVERTCHAT_SESSION_COMMANDS;
}

function messageRole(message: unknown): string | null {
  return message && typeof message === "object" &&
    typeof Reflect.get(message, "role") === "string"
    ? (Reflect.get(message, "role") as string)
    : null;
}

class PiRpcEventClassifier implements AgentRuntimeEventClassifier {
  private ompRunSawAssistant = false;

  constructor(private readonly provider: PiRpcProviderId) {}

  reset(): void {
    this.ompRunSawAssistant = false;
  }

  classify(event: AgentRuntimeEvent): AgentRuntimeEventClassification {
    const started =
      event.type === "agent_start" || event.type === "turn_start";
    if (
      this.provider === "omp" &&
      event.type === "agent_start"
    ) {
      this.ompRunSawAssistant = false;
    }
    if (
      this.provider === "omp" &&
      ["message_start", "message_update", "message_end"].includes(
        event.type,
      ) &&
      messageRole(event.message) === "assistant"
    ) {
      this.ompRunSawAssistant = true;
    }
    const ompAssistantEnd =
      this.provider === "omp" &&
      event.type === "agent_end" &&
      (this.ompRunSawAssistant ||
        (Array.isArray(event.messages) &&
          event.messages.some(
            (message) => messageRole(message) === "assistant",
          )));
    const providerTerminal =
      (this.provider === "pi" && event.type === "agent_settled") ||
      ompAssistantEnd;
    const promptHandledWithoutRun =
      event.type === "prompt_result" && event.agentInvoked === false;
    if (providerTerminal || promptHandledWithoutRun) this.reset();
    return {
      started,
      terminal: providerTerminal || promptHandledWithoutRun,
    };
  }
}

function sessionIdentity(
  provider: PiRpcProviderId,
  state: Record<string, unknown>,
): AgentSessionIdentity {
  const label = agentProviderMetadata(provider).label;
  const sessionFile = state.sessionFile;
  const sessionId = state.sessionId;
  if (typeof sessionFile !== "string" || !sessionFile) {
    throw new Error(`${label} did not create a persistent session file.`);
  }
  if (typeof sessionId !== "string" || !sessionId) {
    throw new Error(`${label} did not return a session ID.`);
  }
  return {
    providerSessionPath: sessionFile,
    providerSessionId: sessionId,
    sessionName:
      typeof state.sessionName === "string" && state.sessionName.trim()
        ? state.sessionName.trim()
        : null,
  };
}

export function createPiRpcProviderAdapter(
  provider: PiRpcProviderId,
): AgentProviderAdapter {
  const mergeCommands = (
    discovered: readonly AgentSlashCommand[],
  ): AgentSlashCommand[] =>
    mergeAgentSlashCommands(builtinCommands(provider), discovered);

  return {
    provider,
    startSession(target: HostTarget, launch: AgentSessionLaunch) {
      return startPiRpc(target, {
        provider,
        executable: launch.executable,
        cwd: launch.cwd,
        ...(launch.resume
          ? { sessionPath: launch.resume.providerSessionPath }
          : {}),
      });
    },
    probeConnection: (draft) =>
      probeAgentTarget(
        targetForConnectionDraft(draft),
        provider,
        draft.executable,
      ),
    probeTarget: (target, executable) =>
      probeAgentTarget(target, provider, executable),
    listWorkspaceSessions: (target, _executable, workspacePath) =>
      listAgentWorkspaceSessions(provider, target, workspacePath),
    sessionIdentity: (state) => sessionIdentity(provider, state),
    createEventClassifier: () => new PiRpcEventClassifier(provider),
    commandsFromEvent: (event) => {
      if (
        event.type !== "available_commands_update" ||
        !Array.isArray(event.commands)
      ) {
        return null;
      }
      return mergeCommands(parsePiCommands({ commands: event.commands }));
    },
    mergeCommands,
    normalizeCommand: (command, state) =>
      normalizeAgentSessionCommand(command, state),
  };
}
