import {
  mergeAgentSlashCommands,
  normalizeAgentSessionCommand,
  type AgentSlashCommand,
} from "@overtchat/agent-bridge";
import { startHermesRuntime } from "../hermes/client";
import { probeHermesConnection, probeHermesTarget } from "../hermes/probe";
import { listHermesSessions } from "../hermes/sessions";
import type { AgentProviderAdapter } from "./types";

const COMMANDS: AgentSlashCommand[] = [
  { name: "new", description: "Start a new session", source: "builtin" },
  {
    name: "compact",
    description: "Compress conversation context",
    source: "builtin",
  },
];

export const hermesProviderAdapter: AgentProviderAdapter = {
  provider: "hermes",
  steering: "restart",
  startSession: startHermesRuntime,
  probeConnection: probeHermesConnection,
  probeTarget: probeHermesTarget,
  listWorkspaceSessions: listHermesSessions,
  async fetchCatalog(target, launch) {
    const client = startHermesRuntime(target, launch);
    try {
      const state = await client.getState();
      return {
        provider: "hermes",
        models: await client.getAvailableModels(),
        modes: Array.isArray(state.modes) ? state.modes : [],
        defaultModeId: typeof state.modeId === "string" ? state.modeId : null,
      };
    } finally {
      await client.stop();
    }
  },
  sessionIdentity(state) {
    if (typeof state.sessionId !== "string" || !state.sessionId)
      throw new Error("Hermes did not return a session ID.");
    return {
      providerSessionId: state.sessionId,
      providerSessionPath: state.sessionId,
      sessionName:
        typeof state.sessionName === "string" ? state.sessionName : null,
    };
  },
  createEventClassifier: () => ({
    reset() {},
    classify(event) {
      return {
        started:
          event.type === "turn_start" || event.type === "compaction_start",
        terminal: event.type === "turn_end" || event.type === "compaction_end",
      };
    },
  }),
  commandsFromEvent: (event) =>
    event.type === "commands_update" && Array.isArray(event.commands)
      ? (event.commands as AgentSlashCommand[])
      : null,
  mergeCommands: (commands) => mergeAgentSlashCommands(COMMANDS, commands),
  normalizeCommand: normalizeAgentSessionCommand,
};
