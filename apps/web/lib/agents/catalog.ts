import type {
  AgentProviderId,
  AgentRuntimeCapabilities,
} from "@/lib/agents/types";
import { AGENT_PROVIDER_IDS } from "@/lib/agents/types";

export type AgentProviderMetadata = {
  id: AgentProviderId;
  label: string;
  executable: string;
  capabilities: AgentRuntimeCapabilities;
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
    capabilities: { steer: true, usage: true },
  },
};

export function agentProviderMetadata(
  provider: AgentProviderId,
): AgentProviderMetadata {
  return AGENT_PROVIDERS[provider];
}

export function isAgentProviderId(value: string): value is AgentProviderId {
  return (AGENT_PROVIDER_IDS as readonly string[]).includes(value);
}
