import "server-only";
import type { AgentProviderAdapter } from "@/lib/agents/providers/types";
import { createPiRpcProviderAdapter } from "@/lib/agents/providers/pi-rpc";
import type { AgentProviderId } from "@/lib/agents/types";
import { AGENT_PROVIDER_IDS } from "@/lib/agents/types";

const adapters = Object.fromEntries(
  AGENT_PROVIDER_IDS.map((provider) => [
    provider,
    createPiRpcProviderAdapter(provider),
  ]),
) as Record<AgentProviderId, AgentProviderAdapter>;

export function agentProviderAdapter(
  provider: AgentProviderId,
): AgentProviderAdapter {
  return adapters[provider];
}
