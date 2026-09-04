import type {
  AgentModel,
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
        event.isTerminal !== false &&
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

function applyStateDefaults(
  models: AgentModel[],
  state: Record<string, unknown>,
): AgentModel[] {
  const stateModel = state.model;
  const defaultModelId =
    stateModel && typeof stateModel === "object"
      ? Reflect.get(stateModel, "id")
      : undefined;
  if (
    typeof defaultModelId !== "string" ||
    !models.some((model) => model.id === defaultModelId)
  ) {
    return models;
  }

  const stateThinkingLevel = state.thinkingLevel;
  return models.map((model) => {
    const updated = { ...model };
    delete updated.isDefault;
    if (model.id !== defaultModelId) return updated;

    updated.isDefault = true;
    if (
      typeof stateThinkingLevel === "string" &&
      model.thinkingOptions?.some(
        (option) => option.id === stateThinkingLevel,
      )
    ) {
      updated.defaultThinkingOptionId = stateThinkingLevel;
      updated.thinkingOptions = model.thinkingOptions.map((option) => {
        const next = { ...option };
        delete next.isDefault;
        if (option.id === stateThinkingLevel) next.isDefault = true;
        return next;
      });
    }
    return updated;
  });
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
    const state = await client.getState();
    const models = await client.getAvailableModels(120_000);
    return {
      provider: "omp",
      models: applyStateDefaults(models, state),
      modes: OMP_MODES,
      defaultModeId: "full",
    };
  } finally {
    await client.stop();
  }
}

export const ompProviderAdapter: AgentProviderAdapter = {
  provider: "omp",
  // OMP's live events preserve display chronology across async-result
  // continuations. Replacing them at settle time with its mutable model-context
  // snapshot can move already-rendered tool and custom-message rows.
  refreshMessagesAfterTerminal: false,
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
