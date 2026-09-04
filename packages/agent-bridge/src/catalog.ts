import type {
  AgentMode,
  AgentProviderId,
  AgentRuntimeCapabilities,
} from "./agents";
import { AGENT_PROVIDER_IDS } from "./agents";

export type AgentProviderMetadata = {
  id: AgentProviderId;
  label: string;
  executable: string;
  capabilities: AgentRuntimeCapabilities;
};

export type AgentProviderCreationDefaults = {
  modes: readonly AgentMode[];
  defaultModeId: string | null;
};

const NO_CREATION_DEFAULTS: AgentProviderCreationDefaults = {
  modes: [],
  defaultModeId: null,
};

const OMP_CREATION_DEFAULTS: AgentProviderCreationDefaults = {
  modes: [
    {
      id: "full",
      label: "Full Access",
      description:
        "Launches OMP with yolo approval mode so tools run without prompts.",
      dangerous: true,
    },
    {
      id: "write",
      label: "Write Approval",
      description:
        "Launches OMP with write approval mode — reads are free, writes require approval.",
    },
    {
      id: "ask",
      label: "Always Ask",
      description:
        "Launches OMP with always-ask approval mode for write and exec tools.",
    },
  ],
  defaultModeId: "full",
};

export const AGENT_PROVIDERS: Record<
  AgentProviderId,
  AgentProviderMetadata
> = {
  pi: {
    id: "pi",
    label: "Pi",
    executable: "pi",
    capabilities: {
      steer: true,
      customCompactionInstructions: true,
    },
  },
  omp: {
    id: "omp",
    label: "Oh My Pi",
    executable: "omp",
    capabilities: {
      steer: true,
      customCompactionInstructions: true,
    },
  },
  codex: {
    id: "codex",
    label: "Codex",
    executable: "codex",
    capabilities: {
      steer: true,
      usage: true,
      editSentMessages: true,
      forkMessages: true,
    },
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    executable: "opencode",
    capabilities: {
      steer: true,
    },
  },
  claude: {
    id: "claude",
    label: "Claude Code",
    executable: "claude",
    capabilities: {
      steer: true,
    },
  },
};

export function agentProviderMetadata(
  provider: AgentProviderId,
): AgentProviderMetadata {
  return AGENT_PROVIDERS[provider];
}

/**
 * Launch settings that are part of a provider's stable CLI contract and can be
 * rendered before runtime catalog discovery completes.
 */
export function agentProviderCreationDefaults(
  provider: AgentProviderId,
): AgentProviderCreationDefaults {
  return provider === "omp" ? OMP_CREATION_DEFAULTS : NO_CREATION_DEFAULTS;
}

export function isAgentProviderId(value: string): value is AgentProviderId {
  return (AGENT_PROVIDER_IDS as readonly string[]).includes(value);
}
